## Imported Claude Cowork project instructions

Redesign and development of MASEST.co. Core objective: transition the current basic
informational site into a high-trust, conversion-optimized platform that aggressively
advertises and sells the VertKleen line of chemicals. Merge an Apple-inspired premium
aesthetic with industrial credibility to build a scalable foundation for global expansion
and streamlined B2B/B2C procurement.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `OJamals/masest`; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label triage vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain-doc layout. See `docs/agents/domain.md`.

## RTK (Rust Token Killer)

A PreToolUse hook auto-rewrites Bash commands to their `rtk` equivalents transparently —
no manual prefix needed. Direct-invoke only: `rtk gain` (analytics), `rtk discover`
(missed savings), `rtk proxy <cmd>` (run unfiltered but tracked). For debugging, run the
raw command with no `rtk`. See `~/.claude/RTK.md`.

## Memory

Primary source of truth is intrinsic file memory —
`~/.claude/projects/<project>/memory/` (`MEMORY.md` index + topic files). Read at session
start; write durable decisions, conventions, and learnings back to it.

For code structure — how X works, call paths, blast radius, verbatim source — use the
`codegraph` MCP (`codegraph_explore`): one call returns line-numbered source plus the call
graph, cheaper than a Read/Grep loop. It self-indexes via a file watcher.
