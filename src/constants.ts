export const TOOL_NAME = "goal";
export const REALTIME_CHANNEL = "session-goal";
export const SKILL_NAME = "session-goal";

export const ACTIONS = ["set", "update", "clear", "list"] as const;
export type GoalAction = (typeof ACTIONS)[number];

export const TEXT_MAX = 500;
export const CRITERION_MAX = 240;
export const MAX_CRITERIA = 20;
