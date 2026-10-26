# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Register the `goal` tool with `presentation.label` instead of
  `experimental_statusLabels`, which plugin SDK 0.4.16 and later reject.
- Send continuation prompts with an explicit empty `mentions` list.

### Changed

- Use the `@get-bb/plugin-sdk` npm package for declarations instead of the
  vendored `types/` (via `bb plugin migrate`); `engines.bbPluginSdk` is now
  `>=0.4.16`.
- The composer banner uses `useComposer()`; `npm test` now loads the
  TypeScript sources and also runs a plugin test against the SDK fake host.

## [0.2.0] - 2026-08-09

### Added

- Goal **status**: `active` | `complete` | `blocked` | `paused`
- Tool actions: `complete`, `block`, `pause`, `resume`, `completeCriteria`, `uncompleteCriteria`
- Checkable success criteria (`{ text, done }`)
- **User UI**: dismiss, edit text, toggle checks, pause/resume, mark done
- Human footer copy (no agent jargon)
- Opt-in **auto-continue** on `thread.idle` (settings + caps; skipped when native harness owns the goal)
- **Todo coupling**: refuse `complete` while open todos remain (unless `force`)
- **Native harness sync**: mirror Codex timeline goal into the card; clear native on dismiss/complete
- CLI: `bb goal sync --thread thr_…`

### Changed

- Stronger agent skill / tool description (end-of-work contract)
- Composer banner status colors and completed criteria strikethrough

## [0.1.0] - 2026-08-09

### Added

- Agent tool `goal` with actions `set` | `update` | `clear` | `list`
- Per-thread SQLite storage for goal text + success criteria
- Composer banner (collapsible) with live RPC + realtime refresh
- Dynamic thread instructions when a goal is set
- CLI: `bb goal show --thread <id>`, `bb goal list-threads`
- Skill `session-goal` teaching goal vs todo and multi-agent patterns
- Pure logic selftest for the tool executor
