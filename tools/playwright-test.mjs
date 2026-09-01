import { test as base } from "@playwright/test";

import { createMediaIsolation } from "./test-media-isolation.mjs";

export * from "@playwright/test";
export { createMediaIsolation } from "./test-media-isolation.mjs";

export const test = base.extend({
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
