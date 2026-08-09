import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  definePluginApp,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@bb/plugin-sdk/app";
import type { rpcContract } from "./src/rpc";
import { REALTIME_CHANNEL } from "./src/constants";
import "./app.css";

interface UiGoal {
  text: string;
  successCriteria: string[];
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
    // ignore quota / private mode
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

function criteriaLabel(count: number): string {
  if (count === 0) return "No criteria";
  if (count === 1) return "1 criterion";
  return `${count} criteria`;
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

function CheckBoxGlyph() {
  return (
    <svg
      className="goal-criterion-box"
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
    </svg>
  );
}

function GoalBannerForThread({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  const [snapshot, setSnapshot] = useState<UiSnapshot | null>(null);
  const [expanded, setExpanded] = useState(() => readStoredExpanded(true));
  const headingId = `session-goal-heading-${threadId}`;

  const load = useCallback(async () => {
    try {
      const result = await rpc.call("getGoal", { threadId });
      setSnapshot(result.snapshot as UiSnapshot | null);
    } catch {
      // Keep last good snapshot on transient RPC errors.
    }
  }, [rpc, threadId]);

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

  const goal = snapshot?.goal ?? null;
  if (!goal) return null;

  const criteria = goal.successCriteria;
  const criteriaCount = criteria.length;
  const meta = criteriaLabel(criteriaCount);

  function toggleExpanded() {
    setExpanded((value) => !value);
  }

  return (
    <section
      className="goal-banner"
      aria-label="Session goal"
      aria-labelledby={headingId}
      data-open={expanded ? "true" : "false"}
      data-thread-id={threadId}
    >
      <div className="goal-banner-header-row">
        <button
          type="button"
          className="goal-banner-header"
          aria-expanded={expanded}
          aria-controls={`session-goal-body-${threadId}`}
          onClick={toggleExpanded}
        >
          <span className="goal-banner-kicker">
            <TargetGlyph />
            Goal
          </span>
          <span className="goal-banner-meta">{meta}</span>
          {expanded ? (
            <span id={headingId} className="goal-banner-title">
              {goal.text}
            </span>
          ) : (
            <span id={headingId} className="goal-banner-preview">
              {goal.text}
            </span>
          )}
        </button>
        <div className="goal-banner-actions">
          <button
            type="button"
            className="goal-banner-icon-btn"
            title={expanded ? "Collapse goal" : "Expand goal"}
            aria-label={expanded ? "Collapse session goal" : "Expand session goal"}
            aria-expanded={expanded}
            onClick={toggleExpanded}
          >
            <Chevron open={expanded} />
          </button>
        </div>
      </div>

      <div
        id={`session-goal-body-${threadId}`}
        className="goal-banner-body"
        data-open={expanded ? "true" : "false"}
      >
        <div className="goal-banner-body-inner">
          <p className="goal-banner-why">{goal.text}</p>
          {criteriaCount > 0 ? (
            <ul className="goal-banner-criteria" role="list">
              {criteria.map((criterion, index) => (
                <li key={`${index}:${criterion}`} className="goal-criterion">
                  <span className="goal-criterion-glyph" aria-hidden="true">
                    <CheckBoxGlyph />
                  </span>
                  <span className="goal-criterion-text">{criterion}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="goal-banner-empty">
              Add concrete success criteria with the{" "}
              <code className="goal-banner-code">goal</code> tool.
            </div>
          )}
          <div className="goal-banner-footer">
            <span className="goal-banner-footer-hint">
              Why for this thread · use todo for steps
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function GoalBanner() {
  const composerView = useComposerView();
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
