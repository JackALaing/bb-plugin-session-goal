# Why session-goal underperforms (and how peers fix it)

Research notes comparing **bb-plugin-session-goal** to **Codex thread goals** and
**OpenCode todos**, plus BB’s own native Codex goal surface.

## Diagnosis (what the plugin does today)

| Layer | Behavior |
| --- | --- |
| Storage | Per-thread SQLite row: `{ text, successCriteria[], timestamps }` |
| Agent tool | `goal` set / update / clear / list — **no `complete` / `blocked` / status** |
| Context | `bb.agents.contributeInstructions` injects a **~1–2 sentence blurb** at `thread.start` / `turn.submit` only |
| UI | Composer banner (why + criteria as static checkboxes that never tick) |
| Lifecycle | **None** — no idle wake, no auto-continue, no budget, no completion audit |
| Criteria | Display-only; model is never required to prove or check them off |

The blurb (current):

```
Session goal (why): <text>
Success criteria: 1. … 2. …
Stay oriented to this why. Update with `goal` if the user reframes success;
use `todo` for ordered steps (not for restating the goal).
```

So bleu’s guess is correct: **it mostly dumps the goal text into instructions and stops**.
That is enough for orientation, **not** for finish-through or honest completion.

### Failure mode we hit in practice

1. Agent sets goal + todos early (good).
2. Does partial work; leaves todos incomplete.
3. Ends turn without marking goal done or clearing it.
4. Nothing wakes the agent; goal card stays “open forever” as decoration.
5. User sees unfinished criteria and unfinished todos → “goal plugin isn’t great.”

This is **not primarily a “remind every N turns” problem**. It is missing:

1. **Terminal status** (`complete` / `blocked` / clear with reason)
2. **Harness-driven continuation** while status is active
3. **Hard completion rules** (evidence audit before complete)
4. **Coupling to todos** (optional but high leverage)

---

## Codex: what “real goals” look like

Codex ships a first-class **thread goal** system (`codex-rs/ext/goal`, state
`thread_goals`, prompts under `prompts/templates/goals/`). BB already **mirrors**
Codex goal events for Codex threads (`thread/goal/updated`,
`thread/goal/cleared`, `threads.clearGoal`) — that is **provider-native**, not this plugin.

### Status machine

```
active | paused | blocked | usage_limited | budget_limited | complete
```

Terminal-ish: `complete`, `budget_limited`. Soft stop: `paused`, `blocked`, `usage_limited`.

### Accounting

- Optional `token_budget`, running `tokens_used`, `time_used_seconds`
- Hitting budget → `budget_limited` + wrap-up prompt (no new substantive work)

### Auto-continue (the missing piece)

On **`on_thread_idle`**, if a goal is still **`active`** and not deferred:

```text
continue_if_idle()
  → try_start_turn_if_idle([continuation_steering_item(goal)])
```

That steering prompt is a **hidden user/context item**, not a soft system blurb.
It re-states the objective and forces:

- Keep the full objective (don’t shrink success to what fits this turn)
- Use **update_plan** for multi-step progress when available
- Run a **completion audit** (requirement-by-requirement evidence) before complete
- Strict **blocked audit** (same blocker ≥ 3 consecutive goal turns)
- Only then call `update_goal` with `complete` or `blocked`

Source of truth: `codex-rs/prompts/templates/goals/continuation.md` (and
`budget_limit.md`, `objective_updated.md`).

### Tools

- `create_goal` / `get_goal` / `update_goal(status)`
- Completion is an explicit tool call that preserves accounting

### Mental model

**Goal = durable work contract the harness enforces across turns.**
Ending a turn does **not** end the goal; the runtime wakes the agent again.

---

## OpenCode: todos, not goals — but strong “finish the list” culture

OpenCode has **session todos** (storage + UI dock + `TodoWrite` tool), **not** a
Codex-style goal continuation runtime.

What it does well:

1. **Tool description / prompts insist on real-time status updates**  
   (`todowrite.txt`: mark complete only after verification; exactly one `in_progress`)
2. **System prompts hammer keep-going**  
   e.g. beast/meta: work until the todo list is fully checked; on “continue/resume”
   pick up the next incomplete item and don’t yield until done
3. **UI** shows progress continuously (composer/session dock)

What it does **not** do (unlike Codex goals):

- Automatic idle re-entry driven by unfinished todos (continuation is mostly
  **prompt discipline** + user “continue”, not a harness loop)

### Mental model

**Todo = progress surface; “keep going” is prompt policy.**
Effective for in-turn discipline; weaker for multi-turn autonomous finish unless
the model is already stubborn.

---

## BB plugin API affordances we can use

Already available to plugins:

| API | Use for goals |
| --- | --- |
| `bb.agents.contributeInstructions` | Re-inject goal + unfinished criteria **every turn** (already every `turn.submit`) |
| `bb.agents.registerTool` | Add `complete` / `blocked` / criterion ticks |
| `bb.events.on("thread.idle")` | **Auto-continue** while goal active (same pattern as notify’s worker hooks) |
| `bb.sdk.threads.send({ mode: "auto", … })` | Kick a new turn with a continuation prompt when idle |
| `bb.realtime` | UI refresh for status |
| Settings | `autoContinue`, max continuations, token/turn budgets |

Constraints:

- `contributeInstructions` is **sync + cheap** (good for status text; not for I/O-heavy audits)
- Idle handlers are **fire-and-forget** — must not block the lifecycle; catch errors
- Continuation burns credits — needs caps + pause

Note: Codex-native goals on Codex provider threads already auto-continue **inside
Codex**. Our plugin is the **provider-agnostic** version for Claude/Pi/etc., and
currently does none of that.

---

## Gap map (plugin vs Codex)

| Capability | Codex | session-goal plugin | OpenCode todos |
| --- | --- | --- | --- |
| Sticky objective in UI | Yes | Yes (banner) | N/A (todo dock) |
| Inject every turn | Continuation item + tools | Thin instruction blurb | Prompt rules |
| Explicit complete status | `update_goal(complete)` | clear only (ambiguous) | mark todos complete |
| Completion audit | Long, strict | None | “verify before complete” in tool text |
| Auto-wake while unfinished | `on_thread_idle` → new turn | **None** | Mostly none |
| Budgets / rate limits | Token budget, usage_limited | None | N/A |
| Blocked with threshold | ≥3 turns same blocker | None | informal |
| Plan/todo coupling | Suggests `update_plan` | Soft “use todo” | Is the todo |

---

## Proposed v0.2 design (ranked)

### P0 — Make completion real (cheap, high clarity)

1. **Statuses** on the goal: `active | complete | blocked | paused`  
   - `clear` remains for “abandon / no longer relevant”  
   - UI: badge + mute banner when complete/paused
2. **Tool actions**: `complete`, `block`, `pause`, `resume`  
   - `complete` requires either all criteria done **or** explicit `evidence` string
3. **Checkable criteria**  
   - `toggleCriteria` / `completeCriteria` by exact text or index  
   - Banner shows `[x]` for done criteria
4. **Stronger instruction blurb** while `active`  
   - Include remaining open criteria  
   - Require: do not end the turn as “done” without `goal complete` or updating todos toward criteria  
   - Explicit: “Unfinished goal is still the mission; do not soft-exit”

### P1 — Auto-continue (Codex parity; opt-in)

Settings (defaults conservative):

```ts
autoContinue: boolean          // default false or true for “agent” power users
maxContinuations: number       // e.g. 8 per goal lifetime
cooldownMs: number             // e.g. 1500
pauseOnUserMessage: boolean    // defer continuation when user queued text
```

On `thread.idle`:

```
if goal.status === "active"
  && continuations < max
  && !user-paused
  && not rate-limited
then
  bb.sdk.threads.send({
    threadId,
    mode: "auto",
    input: [{ type: "text", text: continuationPrompt(goal) }],
    // hidden/system if BB supports it; else visible "…continuing goal" is OK v1
  })
```

Continuation prompt should be adapted from Codex’s `continuation.md` (shorter for
token cost): restate objective, open criteria, forbid shrinking scope, demand
evidence before complete, link to `todo` for remaining steps.

Stop auto-continue when: complete / blocked / paused / max reached / thread.failed
with unrecoverable error / credits (surface as `blocked` or `paused` + notify).

Pair with **notify** plugin: toast on complete, on max-continuations, on blocked.

### P2 — Todo coupling

If todo plugin is installed (detect via `bb.sdk.plugins.list` or optional RPC):

- Instruction blurb includes: open todo count / ready next ids (if we can read
  shared storage — or subscribe via convention)
- On `complete`, warn if open todos remain (allow override with `force: true`)
- Skill text: parent must `goal complete` only after todos that implement criteria are done

If cross-plugin storage is hard, stay convention-based: continuation text says
“call `todo` list; do not complete goal while open work remains.”

### P3 — Remember every N turns (optional)

Less important if P1 ships: every turn already re-injects via
`contributeInstructions`. “Every N turns” only helps if:

- providers drop plugin instructions mid-session, or
- context compaction strips them

Mitigations:

- Put a short **goal hash line** in tool results when any `goal`/`todo` tool runs
- Optional: inject a steerable “goal reminder” user message every N auto-continuations
  (not every model turn — too noisy)

### P4 — Align with BB/Codex native goals (long term)

For Codex provider threads, prefer **native** goal events (already in BB timeline)
and avoid double cards. Options:

- Plugin detects `provider.id === "codex"` and **defers** to native goal UI/tooling
- Or: plugin becomes a thin BB UI over native state when available

Do not invent a second competing goal system for Codex-only users without a
unification plan.

---

## Skill / tool-description copy changes (immediate)

Even without auto-continue, tighten agent-facing text:

1. **End-of-session contract**  
   “Before yielding as done: either (a) `goal` action `complete` with evidence, or
   (b) leave goal active and say what remains — never soft-exit with open criteria.”
2. **Criteria are gates**, not flavor text  
   “Each criterion must be explicitly completed or still open.”
3. **Todos are path**  
   “Mark todos complete as you go; open todos with an active goal means work remains.”

Codex/OpenCode both succeed partly because **tool descriptions are long and
normative**, not just schemas.

---

## What not to do

- Don’t spam the full goal markdown into every assistant message (UI owns that).
- Don’t auto-continue without a max + pause (credit burn / runaway).
- Don’t mark complete from heuristics (“assistant said ‘done’”) without the tool.
- Don’t treat criteria as a second todo tree — keep them **done-ness checks**.

---

## Suggested ship order

1. **v0.2.0** — status + complete/block + checkable criteria + stronger blurb/skill  
2. **v0.2.1** — opt-in auto-continue + max/cooldown + notify hooks  
3. **v0.3.0** — todo coupling + budgets  
4. **Later** — Codex-native unification

## References (local trees)

- Codex: `codex-rs/ext/goal/`, `codex-rs/prompts/templates/goals/continuation.md`
- OpenCode: `packages/opencode/src/tool/todowrite.txt`, `session/prompt/beast.txt`
- BB native Codex goal bridge: `packages/agent-runtime/src/codex/event-translation.ts`
- This plugin: `server.ts` (`contributeInstructions`), `src/format.ts` (`instructionBlurb`)
