/**
 * Lightweight self-test for model + tool logic (no bb host required).
 * Run from plugin root:
 *   node --experimental-strip-types src/tool.selftest.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

// Resolve sibling .js imports to .ts when running under strip-types.
register(
  "data:text/javascript," +
    encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (
      specifier.endsWith(".js") &&
      context.parentURL &&
      context.parentURL.includes("/src/")
    ) {
      try {
        return await nextResolve(specifier.replace(/\\.js$/, ".ts"), context);
      } catch {
        return nextResolve(specifier, context);
      }
    }
    return nextResolve(specifier, context);
  }
`),
  pathToFileURL("./"),
);

const { makeGoal, normalizeGoal, patchGoal } = await import("./model.ts");
const { formatGoalMarkdown, instructionBlurb } = await import("./format.ts");
const { executeGoalTool } = await import("./tool.ts");

function memoryStore() {
  const map = new Map();
  return {
    get(threadId) {
      return (
        map.get(threadId) ?? {
          threadId,
          updatedAt: 0,
          goal: null,
        }
      );
    },
    save(snapshot) {
      if (!snapshot.goal) {
        map.delete(snapshot.threadId);
        return {
          threadId: snapshot.threadId,
          updatedAt: snapshot.updatedAt,
          goal: null,
        };
      }
      map.set(snapshot.threadId, snapshot);
      return snapshot;
    },
    clear(threadId, now = Date.now()) {
      map.delete(threadId);
      return { threadId, updatedAt: now, goal: null };
    },
    knownThreadIds() {
      return [...map.keys()];
    },
  };
}

const published = [];
const store = memoryStore();
const ctx = {
  threadId: "thr_test",
  store,
  publish: (id) => published.push(id),
};

function textOf(result) {
  assert.equal(result.isError ?? false, false, result.content?.[0]?.text);
  return result.content.map((c) => c.text).join("\n");
}

// model basics
{
  const g = makeGoal("  Ship it  ", [" a ", "a", "b", ""], 100);
  assert.ok(!("error" in g));
  assert.equal(g.text, "Ship it");
  assert.deepEqual(g.successCriteria, ["a", "b"]);
  assert.equal(g.createdAt, 100);

  const patched = patchGoal(
    g,
    { addCriteria: ["c"], removeCriteria: ["a"] },
    200,
  );
  assert.ok(!("error" in patched));
  assert.deepEqual(patched.successCriteria, ["b", "c"]);
  assert.equal(patched.updatedAt, 200);

  const norm = normalizeGoal({ text: "x", successCriteria: ["y"] }, 1);
  assert.equal(norm?.text, "x");
  assert.equal(normalizeGoal({ text: "  " }), null);
}

// set / list / update / clear
{
  let r = executeGoalTool(
    {
      action: "set",
      text: "Build session-goal",
      successCriteria: ["tool works", "RPC works"],
    },
    ctx,
  );
  let body = textOf(r);
  assert.match(body, /Build session-goal/);
  assert.match(body, /tool works/);
  assert.equal(published.at(-1), "thr_test");

  r = executeGoalTool({ action: "list" }, ctx);
  body = textOf(r);
  assert.match(body, /Build session-goal/);

  r = executeGoalTool(
    {
      action: "update",
      addCriteria: ["banner shows"],
      removeCriteria: ["tool works"],
    },
    ctx,
  );
  body = textOf(r);
  assert.match(body, /banner shows/);
  assert.doesNotMatch(body, /tool works/);

  r = executeGoalTool(
    { action: "update", text: "Ship session-goal plugin" },
    ctx,
  );
  body = textOf(r);
  assert.match(body, /Ship session-goal plugin/);

  r = executeGoalTool({ action: "clear" }, ctx);
  body = textOf(r);
  assert.match(body, /no goal set/i);

  r = executeGoalTool({ action: "list" }, ctx);
  body = textOf(r);
  assert.match(body, /no goal set/i);
}

// shorthand set without action
{
  published.length = 0;
  const r = executeGoalTool({ text: "Shorthand goal" }, ctx);
  const body = textOf(r);
  assert.match(body, /Shorthand goal/);
  assert.equal(store.get("thr_test").goal.text, "Shorthand goal");
}

// validation
{
  const r = executeGoalTool({ action: "set" }, ctx);
  assert.equal(r.isError, true);
}

// format
{
  const goal = {
    text: "Done",
    successCriteria: ["a"],
    createdAt: 1,
    updatedAt: 1,
  };
  const md = formatGoalMarkdown({
    threadId: "t",
    updatedAt: 1,
    goal,
  });
  assert.match(md, /## Session goal/);
  assert.match(md, /- \[ \] a/);

  const blurb = instructionBlurb(goal);
  assert.match(blurb, /Session goal \(why\): Done/);
  assert.match(blurb, /Success criteria: 1\. a/);
  assert.match(blurb, /`todo` for ordered steps/);
}

console.log("session-goal selftest: ok");
