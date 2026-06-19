import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("business hub avoids blank setup cards and cramped inline forms", () => {
  const html = read("business.html");
  const js = read("js/business.js");

  assert.match(js, /bizSetup'\)\.hidden\s*=\s*true/, "empty setup state should hide the setup card");
  assert.match(html, /class="biz-inline-form"/, "business forms need reusable inline form layout");
  assert.doesNotMatch(html, /style="/, "business hub should not rely on inline style polish");
  assert.match(html, /tier-grid/, "program tier layout should remain explicit and responsive");
});

test("admin dashboard has production shell affordances without inline layout hacks", () => {
  const html = read("admin.html");

  assert.match(html, /adm-tabs-wrap/, "admin tab row should have a mobile-safe scroll container");
  assert.match(html, /adm-panel-header/, "admin panels should expose a consistent panel header utility");
  assert.match(html, /adm-inline-actions/, "admin inline action rows should use reusable classes");
  assert.doesNotMatch(html, /style="/, "admin shell should not rely on inline style polish");
});
