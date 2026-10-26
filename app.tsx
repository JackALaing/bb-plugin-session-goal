import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  definePluginApp,
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./src/rpc";
import { REALTIME_CHANNEL } from "./src/constants";
import "./app.css";

interface UiCriterion {
  text: string;
  done: boolean;
}

interface UiGoal {
  text: string;
  successCriteria: UiCriterion[];
  status: "active" | "complete" | "blocked" | "paused";
  evidence: string | null;
  blockedReason: string | null;
  source: "plugin" | "native";
  nativeStatus: string | null;
  continuationCount: number;
  createdAt: number;
  updatedAt: number;
}

interface UiSnapshot {
  threadId: string;
  updatedAt: number;
  goal: UiGoal | null;
}

const EXPAND_STORAGE_KEY = "bb-plugin-session-goal:expanded";

function readStoredExpanded(defaultValue = true): boolean {
  try {
    const value = sessionStorage.getItem(EXPAND_STORAGE_KEY);
    if (value === "0") return false;
    if (value === "1") return true;
  } catch {
    // ignore
  }
  return defaultValue;
}

function writeStoredExpanded(expanded: boolean) {
  try {
    sessionStorage.setItem(EXPAND_STORAGE_KEY, expanded ? "1" : "0");
  } catch {
    // ignore
  }
}

function payloadThreadId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const threadId = (payload as { threadId?: unknown }).threadId;
  return typeof threadId === "string" ? threadId : null;
}

function criteriaMeta(criteria: UiCriterion[]): string {
  if (criteria.length === 0) return "";
  const done = criteria.filter((c) => c.done).length;
  return `${done} of ${criteria.length}`;
}

function statusLabel(status: UiGoal["status"]): string {
  switch (status) {
    case "complete":
      return "Done";
    case "blocked":
      return "Blocked";
    case "paused":
      return "Paused";
    default:
      return "In progress";
  }
}

/** Short, human footer — no agent jargon. */
function footerCopy(goal: UiGoal): string {
  switch (goal.status) {
    case "complete":
      return goal.evidence ? goal.evidence : "Marked done";
    case "blocked":
      return goal.blockedReason
        ? `Waiting: ${goal.blockedReason}`
        : "Waiting on something outside this thread";
    case "paused":
      return "Paused — resume when you want work to continue";
    default: {
      const open = goal.successCriteria.filter((c) => !c.done).length;
      if (goal.successCriteria.length === 0) {
        return "What success looks like for this chat";
      }
      if (open === 0) {
        return "All checks done — mark complete when you’re satisfied";
      }
      return open === 1
        ? "1 check still open"
        : `${open} checks still open`;
    }
  }
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className="goal-banner-chevron"
      data-open={open ? "true" : "false"}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        d="M4.5 6.25 8 9.75l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TargetGlyph() {
  return (
    <svg
      className="goal-banner-target"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="5.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle
        cx="8"
        cy="8"
        r="2.35"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="8" cy="8" r="0.85" fill="currentColor" />
    </svg>
  );
}

function CheckBoxGlyph({ done }: { done: boolean }) {
  return (
    <svg
      className="goal-criterion-box"
      data-done={done ? "true" : "false"}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <rect
        x="2.25"
        y="2.25"
        width="11.5"
        height="11.5"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      {done ? (
        <path
          d="M4.75 8.25 7 10.5l4.25-4.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PencilGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M10.5 2.75 13.25 5.5 5.75 13H3v-2.75L10.5 2.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GoalBannerForThread({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  const [snapshot, setSnapshot] = useState<UiSnapshot | null>(null);
  const [expanded, setExpanded] = useState(() => readStoredExpanded(true));
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const headingId = `session-goal-heading-${threadId}`;

  const applyResult = useCallback(
    (result: { snapshot: UiSnapshot | null; error: string | null }) => {
      setSnapshot(result.snapshot);
      setActionError(result.error);
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      const result = await rpc.call("getGoal", { threadId });
      applyResult(result as { snapshot: UiSnapshot | null; error: string | null });
    } catch {
      // Keep last good snapshot on transient RPC errors.
    }
  }, [rpc, threadId, applyResult]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime(
    REALTIME_CHANNEL,
    useCallback(
      (payload) => {
        if (payloadThreadId(payload) === threadId) {
          void load();
        }
      },
      [load, threadId],
    ),
  );

  useEffect(() => {
    const reconnected =
      connection === "connected" && previousConnection.current !== "connected";
    previousConnection.current = connection;
    if (reconnected) void load();
  }, [connection, load]);

  useEffect(() => {
    writeStoredExpanded(expanded);
  }, [expanded]);

  useEffect(() => {
    if (editing) {
      editRef.current?.focus();
      editRef.current?.select();
    }
  }, [editing]);

  const run = useCallback(
    async (fn: () => Promise<{ snapshot: UiSnapshot | null; error: string | null }>) => {
      setBusy(true);
      setActionError(null);
      try {
        const result = await fn();
        applyResult(result);
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Something went wrong",
        );
      } finally {
        setBusy(false);
      }
    },
    [applyResult],
  );

  const goal = snapshot?.goal ?? null;
  if (!goal) return null;
  const goalText = goal.text;

  const criteria = goal.successCriteria;
  const criteriaCount = criteria.length;
  const meta = criteriaMeta(criteria);
  const status = goal.status;

  function toggleExpanded() {
    if (editing) return;
    setExpanded((value) => !value);
  }

  function startEdit() {
    setDraftText(goalText);
    setEditing(true);
    setExpanded(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraftText("");
  }

  async function saveEdit(event?: FormEvent) {
    event?.preventDefault();
    const text = draftText.trim();
    if (!text || text === goalText) {
      cancelEdit();
      return;
    }
    await run(() => rpc.call("updateGoal", { threadId, text }));
    setEditing(false);
  }

  function onEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveEdit();
    }
  }

  return (
    <section
      className="goal-banner"
      data-status={status}
      data-source={goal.source}
      aria-label="Session goal"
      aria-labelledby={headingId}
      data-open={expanded ? "true" : "false"}
      data-thread-id={threadId}
      data-busy={busy ? "true" : "false"}
    >
      <div className="goal-banner-header-row">
        <button
          type="button"
          className="goal-banner-header"
          aria-expanded={expanded}
          aria-controls={`session-goal-body-${threadId}`}
          onClick={toggleExpanded}
          disabled={editing}
        >
          <span className="goal-banner-kicker">
            <TargetGlyph />
            Goal
          </span>
          <span className="goal-banner-status" data-status={status}>
            {statusLabel(status)}
          </span>
          {meta ? <span className="goal-banner-meta">{meta}</span> : null}
          {!editing ? (
            expanded ? (
              <span id={headingId} className="goal-banner-title">
                {goal.text}
              </span>
            ) : (
              <span id={headingId} className="goal-banner-preview">
                {goal.text}
              </span>
            )
          ) : (
            <span id={headingId} className="goal-banner-title goal-banner-title-muted">
              Editing…
            </span>
          )}
        </button>
        <div className="goal-banner-actions">
          {!editing ? (
            <button
              type="button"
              className="goal-banner-icon-btn"
              title="Edit goal"
              aria-label="Edit goal"
              disabled={busy}
              onClick={startEdit}
            >
              <PencilGlyph />
            </button>
          ) : null}
          <button
            type="button"
            className="goal-banner-icon-btn"
            title="Dismiss goal"
            aria-label="Dismiss goal"
            disabled={busy}
            onClick={() => {
              if (
                typeof window !== "undefined" &&
                !window.confirm("Dismiss this goal?")
              ) {
                return;
              }
              void run(() => rpc.call("dismissGoal", { threadId }));
            }}
          >
            <CloseGlyph />
          </button>
          <button
            type="button"
            className="goal-banner-icon-btn"
            title={expanded ? "Collapse" : "Expand"}
            aria-label={expanded ? "Collapse goal" : "Expand goal"}
            aria-expanded={expanded}
            disabled={editing}
            onClick={toggleExpanded}
          >
            <Chevron open={expanded} />
          </button>
        </div>
      </div>

      <div
        id={`session-goal-body-${threadId}`}
        className="goal-banner-body"
        data-open={expanded || editing ? "true" : "false"}
      >
        <div className="goal-banner-body-inner">
          {editing ? (
            <form className="goal-banner-edit" onSubmit={(e) => void saveEdit(e)}>
              <label className="goal-banner-edit-label" htmlFor={`goal-edit-${threadId}`}>
                What does success look like?
              </label>
              <textarea
                id={`goal-edit-${threadId}`}
                ref={editRef}
                className="goal-banner-edit-input"
                value={draftText}
                maxLength={500}
                rows={2}
                disabled={busy}
                onChange={(e) => setDraftText(e.target.value)}
                onKeyDown={onEditKeyDown}
              />
              <div className="goal-banner-edit-actions">
                <button
                  type="button"
                  className="goal-banner-text-btn"
                  disabled={busy}
                  onClick={cancelEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="goal-banner-text-btn goal-banner-text-btn-primary"
                  disabled={busy || !draftText.trim()}
                >
                  Save
                </button>
              </div>
            </form>
          ) : (
            <p className="goal-banner-why">{goal.text}</p>
          )}

          {!editing && criteriaCount > 0 ? (
            <ul className="goal-banner-criteria" role="list">
              {criteria.map((criterion) => (
                <li
                  key={criterion.text}
                  className="goal-criterion"
                  data-done={criterion.done ? "true" : "false"}
                >
                  <button
                    type="button"
                    className="goal-criterion-toggle"
                    disabled={busy || status === "complete"}
                    aria-pressed={criterion.done}
                    aria-label={
                      criterion.done
                        ? `Mark “${criterion.text}” not done`
                        : `Mark “${criterion.text}” done`
                    }
                    onClick={() =>
                      void run(() =>
                        rpc.call("toggleCriterion", {
                          threadId,
                          text: criterion.text,
                        }),
                      )
                    }
                  >
                    <span className="goal-criterion-glyph" aria-hidden="true">
                      <CheckBoxGlyph done={criterion.done} />
                    </span>
                    <span className="goal-criterion-text">{criterion.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {!editing && criteriaCount === 0 && status === "active" ? (
            <div className="goal-banner-empty">
              No checklist yet — edit the goal or ask the agent to add checks.
            </div>
          ) : null}

          {status === "blocked" && goal.blockedReason ? (
            <p className="goal-banner-blocked">{goal.blockedReason}</p>
          ) : null}

          {actionError ? (
            <p className="goal-banner-error" role="alert">
              {actionError}
            </p>
          ) : null}

          {!editing ? (
            <div className="goal-banner-footer">
              <span className="goal-banner-footer-hint">{footerCopy(goal)}</span>
              <div className="goal-banner-footer-actions">
                {status === "active" || status === "blocked" ? (
                  <>
                    <button
                      type="button"
                      className="goal-banner-text-btn"
                      disabled={busy}
                      onClick={() =>
                        void run(() => rpc.call("pauseGoal", { threadId }))
                      }
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      className="goal-banner-text-btn goal-banner-text-btn-primary"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          rpc.call("completeGoal", { threadId }),
                        )
                      }
                    >
                      Mark done
                    </button>
                  </>
                ) : null}
                {status === "paused" ? (
                  <button
                    type="button"
                    className="goal-banner-text-btn goal-banner-text-btn-primary"
                    disabled={busy}
                    onClick={() =>
                      void run(() => rpc.call("resumeGoal", { threadId }))
                    }
                  >
                    Resume
                  </button>
                ) : null}
                {status === "complete" ? (
                  <button
                    type="button"
                    className="goal-banner-text-btn"
                    disabled={busy}
                    onClick={() =>
                      void run(() => rpc.call("dismissGoal", { threadId }))
                    }
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function GoalBanner() {
  const composerView = useComposer();
  if (composerView.scope.kind !== "thread") return null;
  return (
    <GoalBannerForThread
      key={composerView.scope.threadId}
      threadId={composerView.scope.threadId}
    />
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "session-goal",
    scopes: ["thread"],
    banners: [{ id: "goal-card", chrome: "bare", component: GoalBanner }],
  });
});
