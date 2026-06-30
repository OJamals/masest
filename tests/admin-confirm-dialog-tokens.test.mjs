import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("admin confirm-dialog uses shared radius/shadow tokens, matching the detail-dialog modal", () => {
  const html = read("admin.html");
  const block = html.match(/\.confirm-dialog \{[^}]*\}/);
  assert.ok(block, "admin.html should style .confirm-dialog");

  assert.match(block[0], /border-radius:\s*var\(--r-lg/, "confirm-dialog radius should use the --r-lg token");
  assert.match(block[0], /box-shadow:\s*var\(--shadow-lg\)/, "confirm-dialog shadow should use the --shadow-lg token");
  assert.doesNotMatch(block[0], /border-radius:\s*12px/, "confirm-dialog should not hardcode a 12px radius");
  assert.doesNotMatch(block[0], /box-shadow:\s*0 20px 50px/, "confirm-dialog should not hardcode a raw shadow");
});
