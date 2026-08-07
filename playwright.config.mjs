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
};
