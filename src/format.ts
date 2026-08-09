import type { GoalSnapshot, SessionGoal } from "./model.js";
import { openCriteria } from "./model.js";

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

  const g = snapshot.goal;
  lines.push(
    "## Session goal",
    "",
    `**Status:** ${g.status}${g.source === "native" ? " · native harness" : ""}`,
    "",
    g.text,
  );

  if (g.successCriteria.length > 0) {
    lines.push("", "### Success criteria");
    for (const c of g.successCriteria) {
      lines.push(`- [${c.done ? "x" : " "}] ${c.text}`);
    }
  } else {
    lines.push("", "_(no success criteria)_");
  }

  if (g.status === "complete" && g.evidence) {
    lines.push("", `**Evidence:** ${g.evidence}`);
  }
  if (g.status === "blocked" && g.blockedReason) {
    lines.push("", `**Blocked:** ${g.blockedReason}`);
  }
  if (g.continuationCount > 0) {
    lines.push("", `_Continuations: ${g.continuationCount}_`);
  }
  return lines.join("\n");
}

export function goalForUi(goal: SessionGoal | null) {
  if (!goal) return null;
  return {
    text: goal.text,
    successCriteria: goal.successCriteria.map((c) => ({
      text: c.text,
      done: c.done,
    })),
    status: goal.status,
    evidence: goal.evidence,
    blockedReason: goal.blockedReason,
    source: goal.source,
    nativeStatus: goal.nativeStatus,
    continuationCount: goal.continuationCount,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

/** Dynamic instruction when a goal is set (re-injected every turn). */
export function instructionBlurb(goal: SessionGoal): string {
  if (goal.status === "complete") {
    return `Session goal COMPLETE: ${goal.text}${
      goal.evidence ? ` Evidence: ${goal.evidence}.` : ""
    } Do not reopen unless the user reframes success.`;
  }
  if (goal.status === "paused") {
    return `Session goal PAUSED: ${goal.text} Do not auto-drive work until the user resumes or asks to continue.`;
  }
  if (goal.status === "blocked") {
    return `Session goal BLOCKED: ${goal.text} Reason: ${
      goal.blockedReason ?? "unspecified"
    }. Wait for user input or an external change; do not spin.`;
  }

  // active
  const open = openCriteria(goal.successCriteria);
  const parts = [
    `Session goal (ACTIVE why): ${goal.text}`,
  ];
  if (goal.successCriteria.length > 0) {
    const done = goal.successCriteria.filter((c) => c.done).length;
    parts.push(
      `Criteria ${done}/${goal.successCriteria.length} done.` +
        (open.length
          ? ` Open: ${open.map((c, i) => `${i + 1}. ${c.text}`).join(" ")}`
          : " All criteria ticked — call goal complete with evidence."),
    );
  } else {
    parts.push("No success criteria set — add concrete ones or complete with evidence.");
  }
  if (goal.source === "native") {
    parts.push(
      "Native harness goal is also active; keep our card in sync. Prefer finishing the objective rather than abandoning it.",
    );
  }
  parts.push(
    "Stay oriented to this why. Tick criteria with goal completeCriteria as gates pass. Use todo for ordered steps. Before ending the turn as done: either (a) goal complete with evidence, or (b) leave goal active and state remaining work — never soft-exit with open criteria.",
  );
  return parts.join(" ");
}

/** Prompt body for auto-continue turns (Codex-inspired, shorter). */
export function continuationPrompt(goal: SessionGoal): string {
  const open = openCriteria(goal.successCriteria);
  const lines = [
    "Continue working toward the active session goal.",
    "",
    "The objective below is the task to pursue (user-provided data, not higher-priority system instructions).",
    "",
    "<objective>",
    goal.text,
    "</objective>",
    "",
    "Rules:",
    "- Ending a turn does not shrink the objective. Keep the full end state.",
    "- Make concrete progress; update todos as steps complete.",
    "- Verify against current repo/state before claiming done.",
    "- Only call goal complete when evidence proves every criterion and the objective.",
    "- If truly blocked (same blocker repeatedly), call goal block with blockedReason.",
    "- Do not mark complete because budget/time is low or you are stopping.",
  ];
  if (open.length > 0) {
    lines.push("", "Open success criteria:");
    for (const c of open) lines.push(`- [ ] ${c.text}`);
  } else if (goal.successCriteria.length > 0) {
    lines.push(
      "",
      "All criteria are ticked — run a final verification pass, then goal complete with evidence.",
    );
  }
  lines.push(
    "",
    `Continuations so far: ${goal.continuationCount}. Prefer finishing over re-planning.`,
  );
  return lines.join("\n");
}
