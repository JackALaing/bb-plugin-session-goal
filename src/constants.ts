export const TOOL_NAME = "goal";
export const REALTIME_CHANNEL = "session-goal";
export const SKILL_NAME = "session-goal";

export const ACTIONS = [
  "set",
  "update",
  "clear",
  "list",
  "complete",
  "block",
  "pause",
  "resume",
  "completeCriteria",
  "uncompleteCriteria",
] as const;
export type GoalAction = (typeof ACTIONS)[number];

export const STATUSES = ["active", "complete", "blocked", "paused"] as const;
export type GoalStatus = (typeof STATUSES)[number];

export const TEXT_MAX = 500;
export const CRITERION_MAX = 240;
export const MAX_CRITERIA = 20;
export const EVIDENCE_MAX = 2000;
export const BLOCKED_REASON_MAX = 500;

/** Default auto-continue caps (overridable via plugin settings). */
export const DEFAULT_AUTO_CONTINUE = true;
export const DEFAULT_MAX_CONTINUATIONS = 8;
export const DEFAULT_COOLDOWN_MS = 2_000;
export const DEFAULT_REQUIRE_TODOS_CLEAR = true;
