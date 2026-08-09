import type { PluginAgentToolResult } from "@bb/plugin-sdk";
import { formatGoalMarkdown } from "./format.js";
import { emptySnapshot, makeGoal, patchGoal } from "./model.js";
import type { GoalStore } from "./store.js";
import { type GoalToolInput, goalToolInputSchema } from "./schemas.js";

export interface GoalToolContext {
  threadId: string;
  store: GoalStore;
  publish: (threadId: string) => void;
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
  return "list";
}

export function executeGoalTool(
  rawInput: unknown,
  ctx: GoalToolContext,
): PluginAgentToolResult {
  const parsed = goalToolInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(`Invalid goal input: ${parsed.error.message}`);
  }
  const input = parsed.data;
  const action = resolveAction(input);
  const now = Date.now();
  const current = ctx.store.get(ctx.threadId);

  switch (action) {
    case "list": {
      return ok(current);
    }

    case "clear": {
      if (!current.goal) {
        return ok(current, { note: "No goal was set." });
      }
      const cleared = ctx.store.clear(ctx.threadId, now);
      ctx.publish(ctx.threadId);
      return ok(cleared, { changes: ["cleared goal"] });
    }

    case "set": {
      if (!input.text) {
        return err('action "set" requires `text`.');
      }
      const goal = makeGoal(
        input.text,
        input.successCriteria,
        now,
        current.goal,
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
        ],
      });
    }

    case "update": {
      if (!current.goal) {
        if (input.text) {
          // Convenience: update with text on empty → set
          const goal = makeGoal(input.text, input.successCriteria, now, null);
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
        !input.removeCriteria?.length
      ) {
        return err(
          'action "update" needs `text`, `successCriteria`, `addCriteria`, and/or `removeCriteria`.',
        );
      }

      const goal = patchGoal(
        current.goal,
        {
          text: input.text,
          successCriteria: input.successCriteria,
          addCriteria: input.addCriteria,
          removeCriteria: input.removeCriteria,
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
      if (input.removeCriteria?.length) {
        changes.push(`removed criteria matches`);
      }

      const snapshot = ctx.store.save({
        threadId: ctx.threadId,
        updatedAt: now,
        goal,
      });
      ctx.publish(ctx.threadId);
      return ok(snapshot, { changes });
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
