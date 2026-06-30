import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("admin QuickBooks panel separates readiness, queue, and actions", () => {
  const html = read("admin.html");

  assert.match(html, /id="admQbo" class="adm-card adm-qbo-card"/);
  assert.match(html, /id="qboConfigDetail"[^>]*aria-live="polite"/);
  assert.match(html, /class="adm-qbo-queue"[^>]*aria-label="QuickBooks sync queue"/);
  assert.match(html, /class="adm-inline-actions adm-qbo-actions"/);
  assert.match(html, /id="qboSyncNow"[^>]*disabled/);
});

test("admin QuickBooks readiness copy uses QBO_CONNECT_KEY without exposing secret values", () => {
  const source = read("js/admin/qbo.js");

  assert.match(source, /qboConfigDetail/);
  assert.match(source, /QBO_CONNECT_KEY/);
  assert.match(source, /Secret values are never shown here/);
  assert.match(source, /allowSync = configReady && info\.connected === true/);
  assert.doesNotMatch(source, /QuickBooks config missing: `?\$\{missing\.join/, "raw missing-list status should not be the primary admin state");
});
