import {
  CRITERION_MAX,
  EVIDENCE_MAX,
  MAX_CRITERIA,
  STATUSES,
  TEXT_MAX,
  type GoalStatus,
} from "./constants.js";

export interface GoalCriterion {
  text: string;
  done: boolean;
}

export type GoalSource = "plugin" | "native";

export interface SessionGoal {
  text: string;
  successCriteria: GoalCriterion[];
  status: GoalStatus;
  /** Optional proof when status is complete. */
  evidence: string | null;
  /** Optional reason when status is blocked. */
  blockedReason: string | null;
  createdAt: number;
  updatedAt: number;
  /** Auto-continue counter for this goal instance. */
  continuationCount: number;
  lastContinuationAt: number | null;
  /** Where the objective last came from. */
  source: GoalSource;
  /** Last observed native harness status string, if any. */
  nativeStatus: string | null;
}

export interface GoalSnapshot {
  threadId: string;
  updatedAt: number;
  goal: SessionGoal | null;
}

export function emptySnapshot(
  threadId: string,
  now = Date.now(),
): GoalSnapshot {
  return { threadId, updatedAt: now, goal: null };
}

function clampText(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
}

export function isGoalStatus(value: unknown): value is GoalStatus {
  return (
    typeof value === "string" &&
    (STATUSES as readonly string[]).includes(value)
  );
}

/** Accept string[] or {text,done}[] or mixed. */
export function normalizeCriteria(raw: unknown): GoalCriterion[] {
  if (!Array.isArray(raw)) return [];
  const out: GoalCriterion[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    let text = "";
    let done = false;
    if (typeof entry === "string") {
      text = clampText(entry, CRITERION_MAX);
    } else if (entry && typeof entry === "object") {
      const row = entry as Record<string, unknown>;
      if (typeof row.text === "string") {
        text = clampText(row.text, CRITERION_MAX);
      } else if (typeof row.criterion === "string") {
        text = clampText(row.criterion, CRITERION_MAX);
      }
      done = row.done === true || row.completed === true;
    }
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, done });
    if (out.length >= MAX_CRITERIA) break;
  }
  return out;
}

export function criteriaTexts(criteria: readonly GoalCriterion[]): string[] {
  return criteria.map((c) => c.text);
}

export function openCriteria(criteria: readonly GoalCriterion[]): GoalCriterion[] {
  return criteria.filter((c) => !c.done);
}

export function allCriteriaDone(criteria: readonly GoalCriterion[]): boolean {
  return criteria.length === 0 || criteria.every((c) => c.done);
}

export function normalizeGoal(raw: unknown, now = Date.now()): SessionGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const text =
    typeof row.text === "string"
      ? clampText(row.text, TEXT_MAX)
      : typeof row.objective === "string"
        ? clampText(row.objective, TEXT_MAX)
        : "";
  if (!text) return null;

  const status: GoalStatus = isGoalStatus(row.status) ? row.status : "active";
  const evidence =
    typeof row.evidence === "string"
      ? clampText(row.evidence, EVIDENCE_MAX) || null
      : null;
  const blockedReason =
    typeof row.blockedReason === "string"
      ? clampText(row.blockedReason, 500) || null
      : null;

  return {
    text,
    successCriteria: normalizeCriteria(row.successCriteria),
    status,
    evidence,
    blockedReason,
    createdAt: typeof row.createdAt === "number" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : now,
    continuationCount:
      typeof row.continuationCount === "number" && row.continuationCount >= 0
        ? Math.floor(row.continuationCount)
        : 0,
    lastContinuationAt:
      typeof row.lastContinuationAt === "number" ? row.lastContinuationAt : null,
    source: row.source === "native" ? "native" : "plugin",
    nativeStatus:
      typeof row.nativeStatus === "string" ? row.nativeStatus : null,
  };
}

export function makeGoal(
  text: string,
  successCriteria: unknown,
  now: number,
  previous?: SessionGoal | null,
): SessionGoal | { error: string } {
  const clamped = clampText(text, TEXT_MAX);
  if (!clamped) return { error: "Goal text is required." };

  let criteria: GoalCriterion[];
  if (successCriteria === undefined && previous) {
    // Preserve prior criteria (including done flags) when set only replaces text.
    criteria = previous.successCriteria;
  } else {
    criteria = normalizeCriteria(successCriteria ?? []);
  }

  return {
    text: clamped,
    successCriteria: criteria,
    status: "active",
    evidence: null,
    blockedReason: null,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    continuationCount: 0,
    lastContinuationAt: null,
    source: "plugin",
    nativeStatus: null,
  };
}

export function patchGoal(
  current: SessionGoal,
  patch: {
    text?: string;
    successCriteria?: unknown;
    addCriteria?: string[];
    removeCriteria?: string[];
    completeCriteria?: string[];
    uncompleteCriteria?: string[];
  },
  now: number,
): SessionGoal | { error: string } {
  let text = current.text;
  if (patch.text !== undefined) {
    const next = clampText(patch.text, TEXT_MAX);
    if (!next) return { error: "Goal text cannot be empty." };
    text = next;
  }

  let successCriteria = current.successCriteria.map((c) => ({ ...c }));

  if (patch.successCriteria !== undefined) {
    // Full replace — done flags reset unless objects with done are passed.
    successCriteria = normalizeCriteria(patch.successCriteria);
  } else {
    if (patch.addCriteria?.length) {
      const existing = new Set(successCriteria.map((c) => c.text));
      for (const raw of patch.addCriteria) {
        const t = clampText(raw, CRITERION_MAX);
        if (!t || existing.has(t)) continue;
        existing.add(t);
        successCriteria.push({ text: t, done: false });
        if (successCriteria.length >= MAX_CRITERIA) break;
      }
    }
    if (patch.removeCriteria?.length) {
      const remove = new Set(
        patch.removeCriteria.map((c) => c.trim()).filter(Boolean),
      );
      successCriteria = successCriteria.filter((c) => !remove.has(c.text));
    }
    if (patch.completeCriteria?.length) {
      const mark = new Set(
        patch.completeCriteria.map((c) => c.trim()).filter(Boolean),
      );
      successCriteria = successCriteria.map((c) =>
        mark.has(c.text) ? { ...c, done: true } : c,
      );
    }
    if (patch.uncompleteCriteria?.length) {
      const mark = new Set(
        patch.uncompleteCriteria.map((c) => c.trim()).filter(Boolean),
      );
      successCriteria = successCriteria.map((c) =>
        mark.has(c.text) ? { ...c, done: false } : c,
      );
    }
  }

  return {
    ...current,
    text,
    successCriteria,
    updatedAt: now,
    // Editing criteria/text while complete/blocked re-opens the goal.
    status:
      current.status === "complete" || current.status === "blocked"
        ? "active"
        : current.status,
    evidence: current.status === "complete" ? current.evidence : null,
    blockedReason: current.status === "blocked" ? current.blockedReason : null,
    source: current.source === "native" ? "native" : "plugin",
  };
}

export function setGoalStatus(
  current: SessionGoal,
  status: GoalStatus,
  now: number,
  extras?: { evidence?: string; blockedReason?: string },
): SessionGoal | { error: string } {
  if (status === "complete") {
    const evidence =
      extras?.evidence !== undefined
        ? clampText(extras.evidence, EVIDENCE_MAX) || null
        : current.evidence;
    return {
      ...current,
      status: "complete",
      evidence,
      blockedReason: null,
      updatedAt: now,
    };
  }
  if (status === "blocked") {
    const reason = extras?.blockedReason
      ? clampText(extras.blockedReason, 500)
      : "";
    if (!reason) {
      return { error: 'action "block" requires `blockedReason`.' };
    }
    return {
      ...current,
      status: "blocked",
      blockedReason: reason,
      evidence: null,
      updatedAt: now,
    };
  }
  if (status === "paused") {
    return {
      ...current,
      status: "paused",
      updatedAt: now,
    };
  }
  // resume → active
  return {
    ...current,
    status: "active",
    blockedReason: null,
    evidence: null,
    updatedAt: now,
  };
}

export function recordContinuation(
  current: SessionGoal,
  now: number,
): SessionGoal {
  return {
    ...current,
    continuationCount: current.continuationCount + 1,
    lastContinuationAt: now,
    updatedAt: now,
  };
}

/** Map Codex/native timeline goal status into plugin status. */
export function mapNativeStatus(native: string): GoalStatus {
  switch (native) {
    case "complete":
      return "complete";
    case "paused":
    case "usageLimited":
    case "usage_limited":
    case "budgetLimited":
    case "budget_limited":
      return "paused";
    case "blocked":
      return "blocked";
    case "active":
    default:
      return "active";
  }
}

export function applyNativeSnapshot(
  previous: SessionGoal | null,
  native: {
    objective: string;
    status: string;
  },
  now: number,
): SessionGoal {
  const text = clampText(native.objective, TEXT_MAX) || previous?.text || "";
  const status = mapNativeStatus(native.status);
  if (previous) {
    return {
      ...previous,
      text: text || previous.text,
      status,
      source: "native",
      nativeStatus: native.status,
      updatedAt: now,
      evidence: status === "complete" ? previous.evidence : null,
      blockedReason: status === "blocked" ? previous.blockedReason : null,
    };
  }
  return {
    text: text || "Native harness goal",
    successCriteria: [],
    status,
    evidence: null,
    blockedReason: null,
    createdAt: now,
    updatedAt: now,
    continuationCount: 0,
    lastContinuationAt: null,
    source: "native",
    nativeStatus: native.status,
  };
}
