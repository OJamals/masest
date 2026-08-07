// No testDir, so the whole project root is swept. _local/ is a gitignored local
// archive that holds stale-root/ — an old copy of this repo whose specs point at a
// site/ directory and a :4173 server that no longer exist. Those 30 permanent
// failures drowned the 9 real ones, which is how the suite came to be reported as
// green. test-results/ is Playwright's own output and must never be collected.
//
// .claude/ holds agent worktrees — full copies of this repo — so it is ignored too, but
// it must be anchored to THIS config's directory. testIgnore globs are matched against
// the ABSOLUTE file path, and a worktree lives at <repo>/.claude/worktrees/<name>: a bare
// `**/.claude/**` therefore matches every spec inside a worktree and silently collects
// zero tests when the suite is run from there.
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
  testIgnore: [
    `${root}/.claude/**`,
    "**/dist/**",
    "**/node_modules/**",
    "**/_local/**",
    "**/test-results/**",
  ],
  // admin.html boots through a lazily-imported module graph and then renders from stubbed
  // APIs. In isolation that lands in ~200ms, but under full-suite parallelism — every spec
  // running its own static server and browser — it can exceed the 5s default, and the
  // failure lands on whichever admin spec happens to run first. That rotating red was
  // indistinguishable from a real regression.
  expect: { timeout: 10000 },
};
