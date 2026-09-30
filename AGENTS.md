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

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
