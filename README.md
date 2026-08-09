# bb-plugin-session-goal

Sticky **session goal** for [BB](https://github.com/get-bb/bb) threads: a short **why** plus optional success criteria.

Agents set it with the `goal` tool; the UI shows a compact composer banner. Pair with **bb-plugin-todo** (if installed) for ordered **steps**.

| | **goal** (this plugin) | **todo** |
|---|---|---|
| What | Sticky why + success criteria | Ordered checklist / path |
| Count | One per thread | Many, nested, with deps |
| Changes when | User reframes success | Plan or progress changes |
| UI | Compact goal card | Progress checklist |

## Install

Requires **BB ≥ 0.36** and plugin SDK **^0.4.1**.

### From Git (recommended)

```sh
bb plugin install git:https://github.com/agustif/bb-plugin-session-goal.git@main
bb plugin reload session-goal
```

Pin a tag when you want a frozen release:

```sh
bb plugin install git:https://github.com/agustif/bb-plugin-session-goal.git@v0.1.0
```

### From npm (when published)

```sh
bb plugin install npm:bb-plugin-session-goal@^0.1.0
bb plugin reload session-goal
```

### From a local checkout

```sh
git clone https://github.com/agustif/bb-plugin-session-goal.git
cd bb-plugin-session-goal
npm install
bb plugin install . --yes
bb plugin reload session-goal
```

Check status:

```sh
bb plugin list
bb plugin source session-goal
```

## What you get

- **Tool** `goal` — `set` | `update` | `clear` | `list`
- **Storage** — per-thread goal in the plugin SQLite DB
- **UI** — collapsible composer banner; refreshes on realtime + reconnect
- **Instructions** — thin dynamic blurb so the agent stays oriented to the why
- **CLI** — `bb goal show`, `bb goal list-threads`
- **Skill** — `skills/session-goal/SKILL.md` injected into agent threads

### Tool example

```json
{
  "action": "set",
  "text": "Ship the billing fix",
  "successCriteria": [
    "invoice path covered by test",
    "no regression on free tier"
  ]
}
```

### CLI

```sh
bb goal show --thread thr_…
bb goal list-threads
```

## Goal vs todo

- **Goal text** — outcome for the session ("Ship billing fix safely").
- **successCriteria** — observable done-ness checks, not a work breakdown.
- **Todos** — how you get there (implement, review, install).

### Anti-patterns

- Steps in `successCriteria` ("edit X", "run tests") — put those in **todo**.
- Mission only as a top-level todo — set **goal** so the why stays sticky.
- Mirroring every todo into criteria (or the reverse) — one source each.
- User reframes success but you only add todos — call `goal` `update`/`set`.
- Vague criterion spam — prefer a few testable checks.

### Multi-agent

Parent sets the goal, plans with todos, and dispatches children. Children
`report` on steps; they don't redefine the goal unless the user reframes
success. If the mission changes mid-flight, update the goal first, then
replan todos.

See [`skills/session-goal/SKILL.md`](./skills/session-goal/SKILL.md) for full tool examples.

## Develop

```sh
npm install
npm test
bb plugin types          # refresh vendored SDK .d.ts from your running bb
bb plugin build          # emit dist/ for managed installs
bb plugin install . --yes
bb plugin dev            # watch → rebuild app + reload
```

Layout:

```
server.ts          # factory: tool, rpc, CLI, instructions
app.tsx / app.css  # composer banner
src/               # pure model, store, tool, schemas
skills/            # agent skill
types/             # vendored @bb/plugin-sdk declarations
dist/              # build output (not committed; npm ships it)
```

## Publish (maintainers)

### GitHub release

```sh
# bump version in package.json + CHANGELOG.md
npm test
bb plugin build
git add -A && git commit -m "Release v0.1.0"
git tag v0.1.0
git push origin main --tags
gh release create v0.1.0 --generate-notes
```

Users install with:

```sh
bb plugin install git:https://github.com/agustif/bb-plugin-session-goal.git@v0.1.0
```

### npm (optional)

Managed installs prefer `dist/` when the SDK major matches. Ship a built package:

```sh
npm login
npm version patch   # or minor / major
npm publish --access public
```

`prepublishOnly` runs `bb plugin build` and `npm test`. Consumers then:

```sh
bb plugin install npm:bb-plugin-session-goal@^0.1.0
```

### Compatibility checklist

- Keep `engines.bb` and `engines.bbPluginSdk` honest — managed installs refuse mismatches; path installs surface `incompatible`.
- After SDK upgrades, run `bb plugin types` and re-test against the target BB version.
- Bump the package version when wire/UI behavior changes so `bb plugin outdated` / `update` can move users forward.
- Prefer load-safe factories so a bad update can roll back cleanly.

## License

[MIT](./LICENSE)
