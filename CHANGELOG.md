# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-09

### Added

- Agent tool `goal` with actions `set` | `update` | `clear` | `list`
- Per-thread SQLite storage for goal text + success criteria
- Composer banner (collapsible) with live RPC + realtime refresh
- Dynamic thread instructions when a goal is set
- CLI: `bb goal show --thread <id>`, `bb goal list-threads`
- Skill `session-goal` teaching goal vs todo and multi-agent patterns
- Pure logic selftest for the tool executor
