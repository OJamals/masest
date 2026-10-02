import { test as base } from "@playwright/test";

import { createMediaIsolation } from "./test-media-isolation.mjs";

export * from "@playwright/test";
export { createMediaIsolation } from "./test-media-isolation.mjs";

export const test = base.extend({
  masestAnalyticsIsolation: [async ({ context }, use) => {
    // Browser regressions must not depend on a live tracker or generate test traffic.
    await context.route("https://analytics.ahrefs.com/analytics.js", (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "/* Ahrefs analytics isolated in browser tests. */",
    }));
    await use(undefined);
  }, { auto: true }],
  masestMediaIsolation: [async ({ context }, use) => {
    const isolation = createMediaIsolation();
    await isolation.install(context);
    try {
      await use(undefined);
    } finally {
      isolation.assertNoUnexpected();
    }
  }, { auto: true }],
});
