import { type BbPluginApi } from "@bb/plugin-sdk";
import {
  REALTIME_CHANNEL,
  SKILL_NAME,
  TOOL_NAME,
} from "./src/constants.js";
import { goalForUi, instructionBlurb } from "./src/format.js";
import { rpcContract } from "./src/rpc.js";
import { TOOL_DESCRIPTION, goalToolInputSchema } from "./src/schemas.js";
import { openGoalStore } from "./src/store.js";
import { executeGoalTool } from "./src/tool.js";

export { rpcContract } from "./src/rpc.js";

export default async function plugin(bb: BbPluginApi) {
  const store = openGoalStore(bb);

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

  bb.rpc.register(rpcContract, {
    getGoal({ threadId }) {
      const snap = store.get(threadId);
      if (!snap.goal) {
        return { snapshot: null };
      }
      return {
        snapshot: {
          threadId: snap.threadId,
          updatedAt: snap.updatedAt,
          goal: goalForUi(snap.goal),
        },
      };
    },
  });

  bb.agents.registerTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    instructions:
      "Use the `goal` tool to set/update/clear the sticky session goal (why + successCriteria). Prefer a concrete outcome early in non-trivial sessions. Use `todo` for ordered steps toward the goal.",
    experimental_statusLabels: {
      pending: "Updating goal",
      completed: "Updated goal",
    },
    parameters: goalToolInputSchema,
    async execute(input, ctx) {
      return executeGoalTool(input, {
        threadId: ctx.threadId,
        store,
        publish,
      });
    },
  });

  bb.agents.configure(() => ({
    tools: [TOOL_NAME],
    skills: [SKILL_NAME],
  }));

  bb.agents.contributeInstructions(({ threadId }) => {
    const snap = store.get(threadId);
    if (!snap.goal) return null;
    return instructionBlurb(snap.goal);
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
            "Usage: bb goal show --thread <thr_…>\n       bb goal list-threads\n",
        };
      }
      const snap = store.get(threadId);
      const { formatGoalMarkdown } = await import("./src/format.js");
      return {
        exitCode: 0,
        stdout: `${formatGoalMarkdown(snap)}\n`,
      };
    },
  });

  bb.log.info("session-goal plugin ready");
}
