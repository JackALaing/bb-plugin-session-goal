import {
  CRITERION_MAX,
  MAX_CRITERIA,
  TEXT_MAX,
} from "./constants.js";

export interface SessionGoal {
  text: string;
  successCriteria: string[];
  createdAt: number;
  updatedAt: number;
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

export function normalizeCriteria(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const text = clampText(entry, CRITERION_MAX);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_CRITERIA) break;
  }
  return out;
}

export function normalizeGoal(raw: unknown, now = Date.now()): SessionGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const text =
    typeof row.text === "string" ? clampText(row.text, TEXT_MAX) : "";
  if (!text) return null;
  return {
    text,
    successCriteria: normalizeCriteria(row.successCriteria),
    createdAt: typeof row.createdAt === "number" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : now,
  };
}

export function makeGoal(
  text: string,
  successCriteria: readonly string[] | undefined,
  now: number,
  previous?: SessionGoal | null,
): SessionGoal | { error: string } {
  const clamped = clampText(text, TEXT_MAX);
  if (!clamped) return { error: "Goal text is required." };
  return {
    text: clamped,
    successCriteria: normalizeCriteria(successCriteria ?? []),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

export function patchGoal(
  current: SessionGoal,
  patch: {
    text?: string;
    successCriteria?: string[];
    addCriteria?: string[];
    removeCriteria?: string[];
  },
  now: number,
): SessionGoal | { error: string } {
  let text = current.text;
  if (patch.text !== undefined) {
    const next = clampText(patch.text, TEXT_MAX);
    if (!next) return { error: "Goal text cannot be empty." };
    text = next;
  }

  let successCriteria = current.successCriteria;
  if (patch.successCriteria !== undefined) {
    successCriteria = normalizeCriteria(patch.successCriteria);
  } else {
    if (patch.addCriteria?.length) {
      successCriteria = normalizeCriteria([
        ...successCriteria,
        ...patch.addCriteria,
      ]);
    }
    if (patch.removeCriteria?.length) {
      const remove = new Set(
        patch.removeCriteria.map((c) => c.trim()).filter(Boolean),
      );
      successCriteria = successCriteria.filter((c) => !remove.has(c));
    }
  }

  return {
    text,
    successCriteria,
    createdAt: current.createdAt,
    updatedAt: now,
  };
}
