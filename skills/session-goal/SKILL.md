---
name: session-goal
description: Set and maintain a sticky session goal (why + success criteria + status) with the goal tool. Use when the user states an outcome/mission/definition of done, when multi-step work needs a clear why separate from todos, or to re-orient after drift. Complete with evidence; do not soft-exit while active.
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
set | update | complete | block | pause | resume
completeCriteria | uncompleteCriteria | clear | list
```

Default when action is omitted: `list` (or `set` if `text` is present).

### Set

```json
{
  "action": "set",
  "text": "Ship session-goal v0.2",
  "successCriteria": [
    "status + complete with evidence works",
    "auto-continue on idle when enabled",
    "native harness goal syncs when present"
  ]
}
```

### Tick criteria + complete

```json
{ "action": "completeCriteria", "completeCriteria": ["status + complete with evidence works"] }
```

```json
{
  "action": "complete",
  "evidence": "selftest green; installed from path; auto-continue setting verified"
}
```

`complete` **requires** all criteria ticked (unless `force: true`) and
`evidence` (unless `force: true`). If the todo plugin is installed and
`requireTodosClear` is on, open todos also block complete unless `force`.

### Block / pause / resume

```json
{ "action": "block", "blockedReason": "Need API credentials from user" }
```

```json
{ "action": "pause" }
```

```json
{ "action": "resume" }
```

### Clear / list

```json
{ "action": "clear" }
```

```json
{ "action": "list" }
```

## Status

| Status | Meaning |
| --- | --- |
| `active` | Work remains; auto-continue may wake the agent |
| `complete` | Objective proven; stop reopening unless user reframes |
| `blocked` | True impasse — wait for user/external change |
| `paused` | Soft stop; no auto-continue |

## End-of-work contract

Before yielding as **done**:

1. Mark finished steps with **`todo`** (if used).
2. Tick each success criterion as proven (`completeCriteria`).
3. Call **`goal` `complete`** with **evidence** — or leave the goal **active**
   and state what remains.

**Never soft-exit** with an active goal and open criteria.

If auto-continue is enabled, an active goal may start another turn after idle
with a continuation prompt. That is expected — finish the work or pause/block.

## Native harness goals

When the provider exposes a native goal (e.g. Codex), this plugin **syncs**
it into the card (`source: native`). Native harnesses often auto-continue
themselves; the plugin skips double-continue in that case. `clear` /
`complete` also try to clear the native goal banner.

## Goal vs todo

| | **goal** | **todo** |
|---|---|---|
| What | Sticky **why** + optional success criteria | Ordered **steps** / checklist |
| Count | One per thread | Many, nested, with deps |
| Changes when | User reframes success or done-ness | Plan or execution progress changes |
| Finish | `complete` + evidence | mark items completed |

## Anti-patterns

- Steps in `successCriteria` ("edit server.ts") — put those in **todo**.
- Soft-exit: saying "done" without `goal complete` while status is active.
- Completing with `force` instead of ticking criteria / finishing todos.
- Blocking on the first difficulty — only `block` on true repeated impasse.
- Criterion spam — prefer a few concrete checks.

## Rules

1. Prefer a concrete goal early on non-trivial sessions.
2. Keep criteria observable; keep todos actionable.
3. Don't paste the goal card back every turn — the UI shows it.
4. Clear only when abandoning; complete when proven; pause when parking.
