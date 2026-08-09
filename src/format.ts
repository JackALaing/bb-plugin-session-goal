import type { GoalSnapshot, SessionGoal } from "./model.js";

export function formatGoalMarkdown(
  snapshot: GoalSnapshot,
  extras?: { changes?: string[]; note?: string },
): string {
  const lines: string[] = [];
  if (extras?.note) lines.push(extras.note, "");
  if (extras?.changes?.length) {
    lines.push(`Changes: ${extras.changes.join("; ")}`, "");
  }

  if (!snapshot.goal) {
    lines.push("## Session goal", "", "_(no goal set)_");
    return lines.join("\n");
  }

  lines.push("## Session goal", "", snapshot.goal.text);
  if (snapshot.goal.successCriteria.length > 0) {
    lines.push("", "### Success criteria");
    for (const criterion of snapshot.goal.successCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
  } else {
    lines.push("", "_(no success criteria)_");
  }
  return lines.join("\n");
}

export function goalForUi(goal: SessionGoal | null) {
  if (!goal) return null;
  return {
    text: goal.text,
    successCriteria: goal.successCriteria,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

/** Thin dynamic instruction when a goal is set (not UI). Goal=why; todo=steps. */
export function instructionBlurb(goal: SessionGoal): string {
  const lines = [`Session goal (why): ${goal.text}`];
  if (goal.successCriteria.length > 0) {
    lines.push(
      `Success criteria: ${goal.successCriteria.map((c, i) => `${i + 1}. ${c}`).join(" ")}`,
    );
  }
  lines.push(
    "Stay oriented to this why. Update with `goal` if the user reframes success; use `todo` for ordered steps (not for restating the goal).",
  );
  return lines.join(" ");
}
