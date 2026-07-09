import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("admin review creation does not ship seed/mock review data", () => {
  const shipped = [
    ["admin.html", read("admin.html")],
    ["js/admin/reviews.js", read("js/admin/reviews.js")],
    ["functions/api/admin/reviews.js", read("functions/api/admin/reviews.js")],
  ];

  for (const [path, source] of shipped) {
    assert.doesNotMatch(source, /staff seed|seeding|rvSeed|create_seed|staff_seed|seed@masest\.co/i, `${path} still contains seed review behavior`);
  }
});

test("admin manual review form captures a real author email", () => {
  const html = read("admin.html");
  const js = read("js/admin/reviews.js");

  assert.match(html, /id="rvAuthorEmail"/, "manual review form should require an author email");
  assert.match(html, /id="rvManualForm"/, "review form should be named for manual entry, not seeding");
  assert.match(js, /action:\s*['"]create_manual['"]/, "client should call the manual-review action");
  assert.match(js, /author_email:\s*\$\('rvAuthorEmail'\)\.value\.trim\(\)/, "client should send the author email");
});
