---
name: session-goal
description: Set and maintain a sticky session goal (why + success criteria) with the goal tool. Use when the user states an outcome/mission/definition of done, when multi-step work needs a clear why separate from todos, or to re-orient after drift.
---

# Session goal

Use the **`goal`** tool for the sticky **why** of this thread. Pair it with
**`todo`** for ordered **steps**. BB shows the goal as a compact card above
the composer (separate from the todo checklist).

## When to use

- User states an outcome, mission, or definition of done
- Non-trivial sessions where a checklist alone loses the point
- Re-orient after scope drift — update the goal, don't only add todos

Skip for one-shot trivia.

## Actions

```
set | update | clear | list
```

Default when action is omitted: `list` (or `set` if `text` is present).

### Set

```json
{
  "action": "set",
  "text": "Ship session-goal plugin tool + install",
  "successCriteria": [
    "goal tool supports set/update/clear/list",
    "per-thread sqlite storage + getGoal RPC",
    "composer banner + skill installed"
  ]
}
```

### Update

```json
{
  "action": "update",
  "text": "Ship session-goal end-to-end",
  "addCriteria": ["docs mention goal vs todo"]
}
```

Or replace criteria wholesale with `successCriteria`, remove by exact text
with `removeCriteria`.

### Clear / list

```json
{ "action": "clear" }
```

```json
{ "action": "list" }
```

## Goal vs todo

| | **goal** | **todo** |
|---|---|---|
| What | Sticky **why** + optional success criteria | Ordered **steps** / checklist |
| Count | One per thread | Many, nested, with deps |
| Changes when | User reframes success or done-ness | Plan or execution progress changes |
| UI | Compact goal card | Progress checklist |

- **Goal text** — short outcome ("Ship billing fix without free-tier regressions").
- **successCriteria** — observable checks that mean "done" (tests green, docs
  updated, install verified). Not a work breakdown.
- **Todos** — how you get there (implement, review, install, report).

When both plugins are installed, set the goal first on non-trivial work, then
break work into todos that move criteria toward done.

## Anti-patterns

- **Todo-as-goal** — dumping steps into `successCriteria` ("edit server.ts",
  "run tests"). Criteria should be outcomes you can verify, not a task list.
- **Goal-as-todo** — putting the mission only in a top-level todo and never
  setting `goal`. The checklist can complete while the why is forgotten.
- **Duplicate mirror** — copying every todo item into criteria (or the reverse).
  One source of truth each: criteria = done-ness; todos = path.
- **Silent drift** — user changes the mission but you only add todos. Call
  `goal` `update` (or `set`) so the card matches the new why.
- **Criterion spam** — long, vague, or untestable lists. Prefer a few concrete
  checks (max is a hard cap; fewer is better).

## Multi-agent example

Parent owns both the goal and the plan. Children execute steps and `report`;
they should not redefine the thread goal unless the user reframes success.

```json
// 1) Why (session-goal)
{
  "action": "set",
  "text": "Ship notify plugin with toast + optional webhook",
  "successCriteria": [
    "notify tool delivers toast and webhook channels",
    "quiet hours suppress non-error pings",
    "skill + install documented"
  ]
}
```

```json
// 2) Steps (todo) — path toward that why
{
  "action": "set",
  "items": [
    {
      "id": "notify",
      "content": "Ship notify",
      "children": [
        {
          "id": "notify.channels",
          "content": "Toast + webhook channels",
          "assignee": "worker"
        },
        {
          "id": "notify.quiet",
          "content": "Quiet hours settings",
          "dependsOn": ["notify.channels"],
          "assignee": "worker"
        },
        {
          "id": "notify.review",
          "content": "Review UX + skill copy",
          "dependsOn": ["notify.quiet"],
          "assignee": "reviewer"
        }
      ]
    }
  ]
}
```

```json
// 3) Dispatch workers; they report when done
{ "action": "dispatch-ready" }
```

```json
// Child thread only:
{ "action": "report", "status": "completed", "summary": "Webhook + toast wired" }
```

If mid-flight the user says "drop webhook, toast only," update the **goal**
(and criteria) first, then cancel or replan **todos** — don't only edit the
checklist.

## Rules

1. Prefer a concrete goal early on non-trivial sessions.
2. Keep criteria observable; keep todos actionable.
3. Don't paste the goal card back to the user every turn — the UI shows it.
4. Clear the goal when the session's why is gone, not when one todo finishes.
