import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Regression: commerce-ui.js calls smoothPref() (swap-result scroll + #cat-* deep
// links). It used to be module-private to engagement.js, so any products#cat-*
// visit threw a ReferenceError inside initShop() and aborted the rest of the
// DOMContentLoaded chain (content snapshots, data visualizations).
test("smoothPref is exported by engagement.js and imported by commerce-ui.js", async () => {
  const engagement = await readFile(new URL("../js/main/engagement.js", import.meta.url), "utf8");
  const commerce = await readFile(new URL("../js/main/commerce-ui.js", import.meta.url), "utf8");

  assert.match(engagement, /export function smoothPref\(/);
  if (/smoothPref\(/.test(commerce.replace(/import[^;]+;/g, ""))) {
    assert.match(commerce, /import\s*\{[^}]*\bsmoothPref\b[^}]*\}\s*from\s*"\.\/engagement\.js"/);
  }
});
