import type { PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { formatGoalMarkdown } from "./format.js";
import {
  allCriteriaDone,
  emptySnapshot,
  makeGoal,
  openCriteria,
  patchGoal,
  setGoalStatus,
} from "./model.js";
import type { GoalStore } from "./store.js";
import { type GoalToolInput, goalToolInputSchema } from "./schemas.js";

export interface OpenTodoGate {
  available: boolean;
  open: number;
}

export interface GoalToolContext {
  threadId: string;
  store: GoalStore;
  publish: (threadId: string) => void;
  /** When true, refuse complete while todo plugin reports open items (unless force). */
  requireTodosClear: boolean;
  /** Async optional: open todo counts for complete gate. */
  getOpenTodos?: () => Promise<OpenTodoGate>;
  /** Clear native harness goal when clearing/completing. */
  onClearNative?: () => Promise<void>;
}

function err(message: string): PluginAgentToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function ok(
  snapshot: ReturnType<GoalStore["get"]>,
  extras?: { changes?: string[]; note?: string },
): PluginAgentToolResult {
  return {
    content: [{ type: "text", text: formatGoalMarkdown(snapshot, extras) }],
  };
}

function resolveAction(
  input: GoalToolInput,
): NonNullable<GoalToolInput["action"]> {
  if (input.action) return input.action;
  if (input.text || input.successCriteria) return "set";
  if (input.completeCriteria?.length) return "completeCriteria";
  if (input.uncompleteCriteria?.length) return "uncompleteCriteria";
  return "list";
}

function criterionTexts(
  list: GoalToolInput["successCriteria"],
): string[] | undefined {
  if (!list?.length) return undefined;
  return list.map((c) => (typeof c === "string" ? c : c.text));
}

export async function executeGoalTool(
  rawInput: unknown,
  ctx: GoalToolContext,
): Promise<PluginAgentToolResult> {
  const parsed = goalToolInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(`Invalid goal input: ${parsed.error.message}`);
  }
  const input = parsed.data;
  const action = resolveAction(input);
  const now = Date.now();
  const current = ctx.store.get(ctx.threadId);

  switch (action) {
    case "list":
      return ok(current);

    case "clear": {
      if (!current.goal) {
        return ok(current, { note: "No goal was set." });
      }
      await ctx.onClearNative?.();
      const cleared = ctx.store.clear(ctx.threadId, now);
      ctx.publish(ctx.threadId);
      return ok(cleared, { changes: ["cleared goal"] });
    }

    case "set": {
      if (!input.text) {
        return err('action "set" requires `text`.');
      }
      // set replaces criteria (empty list when omitted)
      const goal = makeGoal(
        input.text,
        input.successCriteria ?? [],
        now,
        current.goal
          ? { ...current.goal, successCriteria: [] }
          : null,
      );
      if ("error" in goal) return err(goal.error);
      const snapshot = ctx.store.save({
        threadId: ctx.threadId,
        updatedAt: now,
        goal,
      });
      ctx.publish(ctx.threadId);
      return ok(snapshot, {
        changes: [
          current.goal ? "replaced goal" : "set goal",
          goal.successCriteria.length
            ? `${goal.successCriteria.length} criteria`
            : "no criteria",
          "status active",
        ],
      });
    }

    case "update": {
      if (!current.goal) {
        if (input.text) {
          const goal = makeGoal(
            input.text,
            input.successCriteria ?? [],
            now,
            null,
          );
          if ("error" in goal) return err(goal.error);
          const snapshot = ctx.store.save({
            threadId: ctx.threadId,
            updatedAt: now,
            goal,
          });
          ctx.publish(ctx.threadId);
          return ok(snapshot, {
            changes: ["set goal (was empty)"],
            note: "No prior goal; treated update as set.",
          });
        }
        return err('No goal set. Use action "set" with `text` first.');
      }

      if (
        input.text === undefined &&
        input.successCriteria === undefined &&
        !input.addCriteria?.length &&
        !input.removeCriteria?.length &&
        !input.completeCriteria?.length &&
        !input.uncompleteCriteria?.length
      ) {
        return err(
          'action "update" needs `text`, `successCriteria`, `addCriteria`, `removeCriteria`, `completeCriteria`, and/or `uncompleteCriteria`.',
        );
      }

      const goal = patchGoal(
        current.goal,
        {
          text: input.text,
          successCriteria: input.successCriteria,
          addCriteria: input.addCriteria,
          removeCriteria: input.removeCriteria,
          completeCriteria: input.completeCriteria,
          uncompleteCriteria: input.uncompleteCriteria,
        },
        now,
      );
      if ("error" in goal) return err(goal.error);

      const changes: string[] = [];
      if (input.text !== undefined) changes.push("updated text");
      if (input.successCriteria !== undefined) {
        changes.push(`replaced criteria (${goal.successCriteria.length})`);
      }
      if (input.addCriteria?.length) {
        changes.push(`added ${input.addCriteria.length} criteria`);
      }
      if (input.removeCriteria?.length) changes.push("removed criteria matches");
      if (input.completeCriteria?.length) changes.push("ticked criteria");
      if (input.uncompleteCriteria?.length) changes.push("unticked criteria");
      if (goal.status === "active" && current.goal.status !== "active") {
        changes.push("re-opened to active");
      }

      const snapshot = ctx.store.save({
        threadId: ctx.threadId,
        updatedAt: now,
        goal,
      });
      ctx.publish(ctx.threadId);
      return ok(snapshot, { changes });
    }

    case "completeCriteria":
    case "uncompleteCriteria": {
      if (!current.goal) {
        return err("No goal set.");
      }
      const list =
        action === "completeCriteria"
          ? input.completeCriteria
          : input.uncompleteCriteria;
      const texts = list?.length ? list : criterionTexts(input.successCriteria);
      if (!texts?.length) {
        return err(
          `action "${action}" requires completeCriteria/uncompleteCriteria (or successCriteria texts).`,
        );
      }
      const goal = patchGoal(
        current.goal,
        action === "completeCriteria"
          ? { completeCriteria: texts }
          : { uncompleteCriteria: texts },
        now,
      );
      if ("error" in goal) return err(goal.error);
      const snapshot = ctx.store.save({
        threadId: ctx.threadId,
        updatedAt: now,
        goal,
      });
      ctx.publish(ctx.threadId);
      const open = openCriteria(goal.successCriteria).length;
      return ok(snapshot, {
        changes: [
          action === "completeCriteria" ? "ticked criteria" : "unticked criteria",
          `${open} open criteria remaining`,
        ],
      });
    }

    case "complete": {
      if (!current.goal) {
        return err('No goal set. Use action "set" first.');
      }
      if (current.goal.status === "complete") {
        return ok(current, { note: "Goal already complete." });
      }
      const force = input.force === true;
      if (!force && !allCriteriaDone(current.goal.successCriteria)) {
        const open = openCriteria(current.goal.successCriteria);
        return err(
          `Cannot complete: ${open.length} open criteria remain (${open
            .map((c) => c.text)
            .join("; ")}). Tick them with completeCriteria, or pass force:true.`,
        );
      }
      if (ctx.requireTodosClear && ctx.getOpenTodos && !force) {
        const todos = await ctx.getOpenTodos();
        if (todos.available && todos.open > 0) {
          return err(
            `Cannot complete: todo plugin reports ${todos.open} open item(s). Finish or cancel them, or pass force:true.`,
          );
        }
      }
      if (!input.evidence && !force) {
        return err(
          'action "complete" requires `evidence` (what proves the objective). Or pass force:true.',
        );
      }

      const goal = setGoalStatus(current.goal, "complete", now, {
        evidence: input.evidence,
      });
      if ("error" in goal) return err(goal.error);
      await ctx.onClearNative?.();
      const snapshot = ctx.store.save({
        threadId: ctx.threadId,
        updatedAt: now,
        goal,
      });
      ctx.publish(ctx.threadId);
      return ok(snapshot, {
        changes: ["status complete"],
        note: "Goal marked complete. Do not reopen unless the user reframes success.",
      });
    }

    case "block": {
      if (!current.goal) return err("No goal set.");
      const goal = setGoalStatus(current.goal, "blocked", now, {
        blockedReason: input.blockedReason,
      });
      if ("error" in goal) return err(goal.error);
      const snapshot = ctx.store.save({
        threadId: ctx.threadId,
        updatedAt: now,
        goal,
      });
      ctx.publish(ctx.threadId);
      return ok(snapshot, { changes: ["status blocked"] });
    }

    case "pause": {
      if (!current.goal) return err("No goal set.");
      const goal = setGoalStatus(current.goal, "paused", now);
      if ("error" in goal) return err(goal.error);
      const snapshot = ctx.store.save({
        threadId: ctx.threadId,
        updatedAt: now,
        goal,
      });
      ctx.publish(ctx.threadId);
      return ok(snapshot, { changes: ["status paused"] });
    }

    case "resume": {
      if (!current.goal) return err("No goal set.");
      const goal = setGoalStatus(current.goal, "active", now);
      if ("error" in goal) return err(goal.error);
      const resumed = {
        ...goal,
        continuationCount: 0,
        lastContinuationAt: null as number | null,
      };
      const snapshot = ctx.store.save({
        threadId: ctx.threadId,
        updatedAt: now,
        goal: resumed,
      });
      ctx.publish(ctx.threadId);
      return ok(snapshot, {
        changes: ["status active", "continuation counter reset"],
      });
    }

    default: {
      const _exhaustive: never = action;
      return err(`Unknown action: ${String(_exhaustive)}`);
    }
  }
}

/** Test helper: empty snapshot without store. */
export function emptyGoalSnapshot(threadId: string, now = Date.now()) {
  return emptySnapshot(threadId, now);
}
