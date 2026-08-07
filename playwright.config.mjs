// No testDir, so the whole project root is swept. _local/ is a gitignored local
// archive that holds stale-root/ — an old copy of this repo whose specs point at a
// site/ directory and a :4173 server that no longer exist. Those 30 permanent
// failures drowned the 9 real ones, which is how the suite came to be reported as
// green. test-results/ is Playwright's own output and must never be collected.
export default {
  testIgnore: [
    "**/.claude/**",
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
