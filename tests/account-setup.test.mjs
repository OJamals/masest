import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("account/me returns buyer setup progress for dashboards", () => {
  const src = read("functions/api/account/me.js");
  assert.match(src, /function buildSetup\(/, "setup progress should be computed in one helper");
  assert.match(src, /resale_cert_url/, "setup needs resale certificate state");
  assert.match(src, /stripe_customer_id/, "setup needs payment portal state");
  assert.match(src, /setup:\s*buildSetup\(/, "account response should include setup progress");
  for (const key of ["profile", "approval", "tax", "payment", "net_terms"]) {
    assert.match(src, new RegExp(`key:\\s*'${key}'`), `missing setup step ${key}`);
  }
  assert.match(src, /percent/, "setup should include an overall percent");
});

test("buyer dashboard renders business setup progress", () => {
  const html = read("dashboard.html");
  const js = read("js/dashboard.js");
  assert.match(html, /id="setupBody"/, "dashboard overview needs setup body mount");
  assert.match(js, /function renderSetupProgress\(/, "dashboard should render setup progress");
  assert.match(js, /ACCOUNT\?\.setup/, "dashboard should use setup returned by account/me");
  assert.match(js, /data-setup-state/, "setup steps need non-color-only state hooks");
});

test("business hub shows the same account setup checklist", () => {
  const html = read("business.html");
  const js = read("js/business.js");
  assert.match(html, /id="bizSetup"/, "business hub needs a setup checklist mount");
  assert.match(js, /function renderSetupChecklist\(/, "business hub should render setup checklist");
  assert.match(js, /data\.setup/, "business setup should use account/me setup data");
});
