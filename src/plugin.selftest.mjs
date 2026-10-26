/**
 * Plugin-level self-test against the SDK's fake host (no bb server required).
 * Run from plugin root:
 *   node --experimental-strip-types --import ./scripts/register-ts.mjs src/plugin.selftest.mjs
 */
import assert from "node:assert/strict";
import * as testing from "@get-bb/plugin-sdk/testing";

const { createFakePluginHost, makeThreadResponse } = testing;
// Older SDKs (such as the 0.4.16 minimum) lack this helper. The plugin's
// configure callback ignores its context, so a minimal one is enough there.
const makePluginAgentConfigurationContext =
  testing.makePluginAgentConfigurationContext ?? (() => ({ thread: { id: "thr_goal" } }));

const { default: plugin } = await import("../server.ts");

const THREAD = "thr_goal";
const ctx = { threadId: THREAD, projectId: "project" };

async function load({ settings = {}, timeline } = {}) {
  const sends = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "session-goal",
    agentSkillIds: ["session-goal"],
    settings: {
      autoContinue: true,
      requireTodosClear: false,
      cooldownMs: "0",
      maxContinuations: "1",
      ...settings,
    },
    sdk: {
      threads: {
        timeline: timeline ?? (async () => ({ goal: null })),
        send: async (input) => {
          sends.push(input);
          return {};
        },
      },
    },
  });
  await plugin(bb);
  const idle = () =>
    harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: THREAD }),
      lastAssistantText: "working",
    });
  return { bb, harness, sends, idle };
}

// The tool registers with the presentation labels current bb accepts.
{
  const { harness } = await load();
  const [tool] = harness.inspection.registrations.agentTools;
  assert.equal(tool.name, "goal");
  assert.deepEqual(tool.presentation?.label, {
    pending: "Updating goal",
    completed: "Updated goal",
  });
  const config = await harness.behavior.resolveAgentConfiguration(
    makePluginAgentConfigurationContext(),
  );
  assert.deepEqual(
    config.tools.map((entry) => entry.name),
    ["goal"],
  );
}

// Instructions describe the goal only for the thread that owns it.
{
  const { harness } = await load();
  const set = await harness.behavior.callAgentTool(
    "goal",
    { action: "set", text: "Ship the release notes" },
    ctx,
  );
  assert.equal(set.isError ?? false, false);
  const instructions = harness.inspection.registrations.instructionProvider;
  assert.match(instructions(ctx), /Ship the release notes/);
  assert.equal(instructions({ ...ctx, threadId: "thr_other" }), null);
}

// An active goal continues once per allowed continuation, with a valid text
// block, and not after it is paused.
{
  const { harness, sends, idle } = await load();
  await harness.behavior.callAgentTool(
    "goal",
    { action: "set", text: "Ship the release notes" },
    ctx,
  );
  await idle();
  assert.equal(sends.length, 1);
  assert.equal(sends[0].threadId, THREAD);
  assert.equal(sends[0].mode, "auto");
  assert.equal(sends[0].input.length, 1);
  assert.equal(sends[0].input[0].type, "text");
  assert.deepEqual(sends[0].input[0].mentions, []);
  assert.match(sends[0].input[0].text, /Ship the release notes/);

  await idle();
  assert.equal(sends.length, 1, "maxContinuations caps continuation turns");

  await harness.behavior.callAgentTool("goal", { action: "pause" }, ctx);
  await harness.behavior.callAgentTool("goal", { action: "resume" }, ctx);
  await harness.behavior.callAgentTool("goal", { action: "pause" }, ctx);
  await idle();
  assert.equal(sends.length, 1, "a paused goal does not continue");
}

// No continuation without a goal or when disabled. A failed timeline read
// keeps the local goal, so it still continues. None of these throw out of
// the idle handler.
{
  const empty = await load();
  await empty.idle();
  assert.equal(empty.sends.length, 0);

  const disabled = await load({ settings: { autoContinue: false } });
  await disabled.harness.behavior.callAgentTool(
    "goal",
    { action: "set", text: "Ship the release notes" },
    ctx,
  );
  await disabled.idle();
  assert.equal(disabled.sends.length, 0);

  const failing = await load({
    timeline: async () => {
      throw new Error("timeline unavailable");
    },
  });
  await failing.harness.behavior.callAgentTool(
    "goal",
    { action: "set", text: "Ship the release notes" },
    ctx,
  );
  await failing.idle();
  assert.equal(failing.sends.length, 1, "a failed native read keeps the local goal");
}

console.log(
  "ok - plugin: tool presentation, scoped instructions, continuation envelope, cap, pause, disabled and failed native reads",
);
