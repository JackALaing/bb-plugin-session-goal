/**
 * Lightweight self-test for model + tool logic (no bb host required).
 * Run from plugin root:
 *   node --experimental-strip-types --import ./scripts/register-ts.mjs src/tool.selftest.mjs
 */
import assert from "node:assert/strict";

const { makeGoal, normalizeGoal, patchGoal, setGoalStatus, allCriteriaDone, applyNativeSnapshot } =
  await import("./model.ts");
const { formatGoalMarkdown, instructionBlurb, continuationPrompt } =
  await import("./format.ts");
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
  requireTodosClear: false,
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
  assert.deepEqual(
    g.successCriteria.map((c) => c.text),
    ["a", "b"],
  );
  assert.equal(g.status, "active");
  assert.equal(g.createdAt, 100);

  const patched = patchGoal(
    g,
    { addCriteria: ["c"], removeCriteria: ["a"], completeCriteria: ["b"] },
    200,
  );
  assert.ok(!("error" in patched));
  assert.deepEqual(
    patched.successCriteria.map((c) => ({ t: c.text, d: c.done })),
    [
      { t: "b", d: true },
      { t: "c", d: false },
    ],
  );
  assert.equal(patched.updatedAt, 200);

  const norm = normalizeGoal(
    { text: "x", successCriteria: ["y"], status: "paused" },
    1,
  );
  assert.equal(norm?.status, "paused");
  assert.equal(norm?.successCriteria[0]?.done, false);
}

// complete / block status
{
  const g = makeGoal("Done", [{ text: "ok", done: true }], 1);
  assert.ok(!("error" in g));
  assert.equal(allCriteriaDone(g.successCriteria), true);
  const done = setGoalStatus(g, "complete", 2, { evidence: "tests green" });
  assert.ok(!("error" in done));
  assert.equal(done.status, "complete");
  assert.equal(done.evidence, "tests green");
}

// native merge
{
  const n = applyNativeSnapshot(null, { objective: "Native obj", status: "active" }, 5);
  assert.equal(n.source, "native");
  assert.equal(n.text, "Native obj");
  assert.equal(n.status, "active");
  const paused = applyNativeSnapshot(n, { objective: "Native obj", status: "budgetLimited" }, 6);
  assert.equal(paused.status, "paused");
}

// tool: set / completeCriteria / complete / list
{
  published.length = 0;
  let r = await executeGoalTool(
    {
      action: "set",
      text: "Ship v0.2",
      successCriteria: ["tests", "docs"],
    },
    ctx,
  );
  let body = textOf(r);
  assert.match(body, /Ship v0\.2/);
  assert.match(body, /Status:\*\* active/);
  assert.equal(store.get("thr_test").goal.status, "active");

  r = await executeGoalTool(
    { action: "completeCriteria", completeCriteria: ["tests", "docs"] },
    ctx,
  );
  body = textOf(r);
  assert.match(body, /\[x\] tests/);

  r = await executeGoalTool(
    { action: "complete", evidence: "selftest green + docs updated" },
    ctx,
  );
  body = textOf(r);
  assert.match(body, /status complete|COMPLETE|complete/i);
  assert.equal(store.get("thr_test").goal.status, "complete");

  r = await executeGoalTool({ action: "list" }, ctx);
  body = textOf(r);
  assert.match(body, /Evidence:/);
}

// complete blocked by open criteria
{
  const s2 = memoryStore();
  const c2 = {
    threadId: "thr_2",
    store: s2,
    publish: () => {},
    requireTodosClear: false,
  };
  await executeGoalTool(
    { action: "set", text: "X", successCriteria: ["a"] },
    c2,
  );
  const r = await executeGoalTool(
    { action: "complete", evidence: "nope" },
    c2,
  );
  assert.equal(r.isError, true);
}

// force complete with open criteria
{
  const s3 = memoryStore();
  const c3 = {
    threadId: "thr_3",
    store: s3,
    publish: () => {},
    requireTodosClear: false,
  };
  await executeGoalTool(
    { action: "set", text: "Y", successCriteria: ["a"] },
    c3,
  );
  const r = await executeGoalTool(
    { action: "complete", force: true, evidence: "forced" },
    c3,
  );
  assert.equal(r.isError ?? false, false);
  assert.equal(s3.get("thr_3").goal.status, "complete");
}

// todo gate
{
  const s4 = memoryStore();
  const c4 = {
    threadId: "thr_4",
    store: s4,
    publish: () => {},
    requireTodosClear: true,
    getOpenTodos: async () => ({ available: true, open: 2 }),
  };
  await executeGoalTool({ action: "set", text: "Z" }, c4);
  const r = await executeGoalTool(
    { action: "complete", evidence: "done" },
    c4,
  );
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /todo/i);
}

// instruction blurb + continuation
{
  const g = makeGoal("Keep going", ["one"], 1);
  assert.ok(!("error" in g));
  const blurb = instructionBlurb(g);
  assert.match(blurb, /ACTIVE/);
  assert.match(blurb, /soft-exit/i);
  const cont = continuationPrompt(g);
  assert.match(cont, /Continue working/);
  assert.match(cont, /one/);
}

// format markdown checkboxes
{
  const g = makeGoal("Fmt", [{ text: "a", done: true }, { text: "b", done: false }], 1);
  assert.ok(!("error" in g));
  const md = formatGoalMarkdown({
    threadId: "t",
    updatedAt: 1,
    goal: g,
  });
  assert.match(md, /\[x\] a/);
  assert.match(md, /\[ \] b/);
}

console.log("session-goal selftest: ok");
