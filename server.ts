import { type BbPluginApi } from "@bb/plugin-sdk";
import {
  DEFAULT_AUTO_CONTINUE,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_MAX_CONTINUATIONS,
  DEFAULT_REQUIRE_TODOS_CLEAR,
  REALTIME_CHANNEL,
  SKILL_NAME,
  TOOL_NAME,
} from "./src/constants.js";
import { maybeAutoContinue, normalizeContinueSettings } from "./src/continue.js";
import { goalForUi, instructionBlurb } from "./src/format.js";
import {
  allCriteriaDone,
  patchGoal,
  setGoalStatus,
} from "./src/model.js";
import { clearNativeGoal, syncNativeGoal } from "./src/native.js";
import { rpcContract } from "./src/rpc.js";
import {
  TOOL_DESCRIPTION,
  TOOL_INSTRUCTIONS,
  goalToolInputSchema,
} from "./src/schemas.js";
import { openGoalStore } from "./src/store.js";
import { executeGoalTool } from "./src/tool.js";
import { readOpenTodos } from "./src/todos.js";

export { rpcContract } from "./src/rpc.js";

export default async function plugin(bb: BbPluginApi) {
  const store = openGoalStore(bb);

  const settings = bb.settings.define({
    autoContinue: {
      type: "boolean",
      label: "Auto-continue active goals",
      default: DEFAULT_AUTO_CONTINUE,
      description:
        "When a goal is still active after a turn ends, start another turn with a continuation prompt (skipped when the native harness already owns the goal, e.g. Codex).",
    },
    maxContinuations: {
      type: "string",
      label: "Max auto-continuations",
      default: String(DEFAULT_MAX_CONTINUATIONS),
      description: "Per goal instance (0 disables). Resume resets the counter.",
    },
    cooldownMs: {
      type: "string",
      label: "Continuation cooldown (ms)",
      default: String(DEFAULT_COOLDOWN_MS),
      description: "Minimum time between auto-continues for the same thread.",
    },
    requireTodosClear: {
      type: "boolean",
      label: "Require todos clear on complete",
      default: DEFAULT_REQUIRE_TODOS_CLEAR,
      description:
        "When the todo plugin is installed, refuse goal complete while open todos remain (unless force).",
    },
  });

  const parseMax = (raw: string | undefined, fallback: number) => {
    const n = Number.parseInt(String(raw ?? ""), 10);
    return Number.isFinite(n) ? n : fallback;
  };

  const readContinueSettings = async () => {
    const s = await settings.get();
    return normalizeContinueSettings({
      autoContinue: s.autoContinue,
      maxContinuations: parseMax(s.maxContinuations, DEFAULT_MAX_CONTINUATIONS),
      cooldownMs: parseMax(s.cooldownMs, DEFAULT_COOLDOWN_MS),
    });
  };

  const publish = (threadId: string) => {
    try {
      bb.realtime.publish(REALTIME_CHANNEL, {
        threadId,
        kind: "goal-changed",
      });
    } catch (error) {
      bb.log.warn(
        `realtime publish failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const toUi = (threadId: string, error: string | null = null) => {
    const snap = store.get(threadId);
    if (!snap.goal) {
      return { snapshot: null, error };
    }
    return {
      snapshot: {
        threadId: snap.threadId,
        updatedAt: snap.updatedAt,
        goal: goalForUi(snap.goal),
      },
      error,
    };
  };

  const clearNative = async (threadId: string) => {
    const result = await clearNativeGoal(bb, threadId);
    if (result.attempted && !result.ok) {
      bb.log.warn(
        `native clearGoal failed for ${threadId}: ${result.error ?? "unknown"}`,
      );
    }
  };

  bb.rpc.register(rpcContract, {
    async getGoal({ threadId }) {
      await syncNativeGoal(bb, store, threadId, publish);
      return toUi(threadId);
    },

    async dismissGoal({ threadId }) {
      const current = store.get(threadId);
      if (!current.goal) {
        return toUi(threadId);
      }
      await clearNative(threadId);
      store.clear(threadId, Date.now());
      publish(threadId);
      return toUi(threadId);
    },

    async updateGoal({ threadId, text, successCriteria }) {
      const current = store.get(threadId);
      if (!current.goal) {
        return toUi(threadId, "No goal to update.");
      }
      if (text === undefined && successCriteria === undefined) {
        return toUi(threadId, "Nothing to update.");
      }
      const now = Date.now();
      const next = patchGoal(
        current.goal,
        {
          text,
          successCriteria: successCriteria?.map((c) => ({
            text: c.text,
            done: c.done === true,
          })),
        },
        now,
      );
      if ("error" in next) {
        return toUi(threadId, next.error);
      }
      store.save({ threadId, updatedAt: now, goal: next });
      publish(threadId);
      return toUi(threadId);
    },

    async toggleCriterion({ threadId, text }) {
      const current = store.get(threadId);
      if (!current.goal) {
        return toUi(threadId, "No goal set.");
      }
      const match = current.goal.successCriteria.find((c) => c.text === text);
      if (!match) {
        return toUi(threadId, "Criterion not found.");
      }
      const now = Date.now();
      const next = patchGoal(
        current.goal,
        match.done
          ? { uncompleteCriteria: [text] }
          : { completeCriteria: [text] },
        now,
      );
      if ("error" in next) {
        return toUi(threadId, next.error);
      }
      store.save({ threadId, updatedAt: now, goal: next });
      publish(threadId);
      return toUi(threadId);
    },

    async completeGoal({ threadId, evidence }) {
      const current = store.get(threadId);
      if (!current.goal) {
        return toUi(threadId, "No goal set.");
      }
      if (current.goal.status === "complete") {
        return toUi(threadId);
      }
      // UI complete is user-asserted: allow open criteria with a note in evidence default.
      const now = Date.now();
      const openLeft = !allCriteriaDone(current.goal.successCriteria);
      const goal = setGoalStatus(current.goal, "complete", now, {
        evidence:
          evidence?.trim() ||
          (openLeft
            ? "Marked complete from the UI"
            : "Marked complete from the UI"),
      });
      if ("error" in goal) {
        return toUi(threadId, goal.error);
      }
      // Tick remaining criteria when user marks done from UI
      const finalized = {
        ...goal,
        successCriteria: goal.successCriteria.map((c) => ({
          ...c,
          done: true,
        })),
      };
      await clearNative(threadId);
      store.save({ threadId, updatedAt: now, goal: finalized });
      publish(threadId);
      return toUi(threadId);
    },

    async pauseGoal({ threadId }) {
      const current = store.get(threadId);
      if (!current.goal) {
        return toUi(threadId, "No goal set.");
      }
      const now = Date.now();
      const goal = setGoalStatus(current.goal, "paused", now);
      if ("error" in goal) {
        return toUi(threadId, goal.error);
      }
      store.save({ threadId, updatedAt: now, goal });
      publish(threadId);
      return toUi(threadId);
    },

    async resumeGoal({ threadId }) {
      const current = store.get(threadId);
      if (!current.goal) {
        return toUi(threadId, "No goal set.");
      }
      const now = Date.now();
      const goal = setGoalStatus(current.goal, "active", now);
      if ("error" in goal) {
        return toUi(threadId, goal.error);
      }
      store.save({
        threadId,
        updatedAt: now,
        goal: { ...goal, continuationCount: 0, lastContinuationAt: null },
      });
      publish(threadId);
      return toUi(threadId);
    },
  });

  bb.agents.registerTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    instructions: TOOL_INSTRUCTIONS,
    experimental_statusLabels: {
      pending: "Updating goal",
      completed: "Updated goal",
    },
    parameters: goalToolInputSchema,
    async execute(input, ctx) {
      const s = await settings.get();
      return executeGoalTool(input, {
        threadId: ctx.threadId,
        store,
        publish,
        requireTodosClear: s.requireTodosClear ?? DEFAULT_REQUIRE_TODOS_CLEAR,
        getOpenTodos: async () => {
          const info = await readOpenTodos(bb, ctx.threadId);
          return { available: info.available, open: info.open };
        },
        onClearNative: async () => {
          const result = await clearNativeGoal(bb, ctx.threadId);
          if (result.attempted && !result.ok) {
            bb.log.warn(
              `native clearGoal failed for ${ctx.threadId}: ${result.error ?? "unknown"}`,
            );
          }
        },
      });
    },
  });

  bb.agents.configure(() => ({
    tools: [TOOL_NAME],
    skills: [SKILL_NAME],
  }));

  bb.agents.contributeInstructions(({ threadId }) => {
    // Sync is async; use last stored snapshot. Idle handler + getGoal keep it fresh.
    // Best-effort: fire-and-forget sync would race; store is updated on idle/RPC.
    const snap = store.get(threadId);
    if (!snap.goal) return null;
    // Hide completed goals from instructions after a while? Keep short complete blurb.
    return instructionBlurb(snap.goal);
  });

  // Keep native harness goal mirrored, and auto-continue plugin-owned active goals.
  bb.events.on("thread.idle", async ({ thread }) => {
    try {
      await syncNativeGoal(bb, store, thread.id, publish);
      const cont = await readContinueSettings();
      const result = await maybeAutoContinue(
        bb,
        store,
        thread.id,
        cont,
        publish,
      );
      if (result.continued) {
        bb.log.info(`auto-continued goal on ${thread.id}`);
      }
    } catch (error) {
      bb.log.warn(
        `thread.idle goal handler: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  bb.events.on("thread.active", async ({ thread }) => {
    try {
      await syncNativeGoal(bb, store, thread.id, publish);
    } catch {
      // ignore
    }
  });

  bb.cli.register({
    name: "goal",
    summary: "Inspect the session goal for a thread",
    commands: [
      {
        name: "show",
        summary: "Print the goal for a thread",
        usage: "bb goal show --thread <thr_…>",
      },
      {
        name: "list-threads",
        summary: "List thread ids that have a stored goal",
        usage: "bb goal list-threads",
      },
      {
        name: "sync",
        summary: "Sync native harness goal into the plugin store",
        usage: "bb goal sync --thread <thr_…>",
      },
    ],
    async run(argv) {
      if (argv[0] === "list-threads" || argv.includes("list-threads")) {
        const ids = store.knownThreadIds();
        return {
          exitCode: 0,
          stdout: ids.length
            ? `${ids.join("\n")}\n`
            : "(no session goals stored)\n",
        };
      }
      const threadFlag = argv.indexOf("--thread");
      const threadId =
        threadFlag >= 0
          ? argv[threadFlag + 1]
          : argv.find((a) => typeof a === "string" && a.startsWith("thr_"));
      if (!threadId) {
        return {
          exitCode: 2,
          stderr:
            "Usage: bb goal show --thread <thr_…>\n       bb goal sync --thread <thr_…>\n       bb goal list-threads\n",
        };
      }
      if (argv[0] === "sync" || argv.includes("sync")) {
        const { snapshot, native, changed } = await syncNativeGoal(
          bb,
          store,
          threadId,
          publish,
        );
        return {
          exitCode: 0,
          stdout: [
            native
              ? `native: ${native.status} — ${native.objective}`
              : "native: (none)",
            changed ? "store: updated" : "store: unchanged",
            snapshot.goal
              ? `plugin: ${snapshot.goal.status} — ${snapshot.goal.text}`
              : "plugin: (none)",
            "",
          ].join("\n"),
        };
      }
      // show — sync first so CLI reflects harness
      await syncNativeGoal(bb, store, threadId, publish);
      const snap = store.get(threadId);
      const { formatGoalMarkdown } = await import("./src/format.js");
      return {
        exitCode: 0,
        stdout: `${formatGoalMarkdown(snap)}\n`,
      };
    },
  });

  bb.log.info("session-goal plugin ready (v0.2 status + auto-continue + native sync)");
}
