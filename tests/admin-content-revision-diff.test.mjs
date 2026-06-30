// CMS revision diff (inspect-before-restore): pure diff helpers that show what
// restoring a prior revision would change vs the current saved entry.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { diffContentFields, formatFieldValue } from "../js/admin/content-diff.js";

test("formatFieldValue renders empties, arrays, booleans, objects, scalars", () => {
  assert.equal(formatFieldValue(undefined), "—");
  assert.equal(formatFieldValue(null), "—");
  assert.equal(formatFieldValue(""), "—");
  assert.equal(formatFieldValue([]), "—");
  assert.equal(formatFieldValue(["a", "b"]), "a, b");
  assert.equal(formatFieldValue(true), "yes");
  assert.equal(formatFieldValue(false), "no");
  assert.equal(formatFieldValue(3), "3");
  assert.equal(formatFieldValue({ a: 1 }), '{"a":1}');
});

test("diffContentFields flags only the fields that differ", () => {
  const current = { status: "published", payload: { name: "Gold", price: "$10", features: ["a", "b"] }, seo: { title: "Gold tier" } };
  const revision = { status: "draft", payload: { name: "Gold", price: "$8", features: ["a"] }, seo: { title: "Gold tier" } };
  const { fields, changedCount } = diffContentFields(current, revision);
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  assert.equal(byKey.status.changed, true);   // published → draft
  assert.equal(byKey.name.changed, false);     // same
  assert.equal(byKey.price.changed, true);     // $10 → $8
  assert.equal(byKey.features.changed, true);  // [a,b] → [a]
  assert.equal(byKey["seo:title"].changed, false);
  assert.equal(changedCount, 3);
});

test("diffContentFields covers keys present on only one side", () => {
  const current = { payload: { a: "1" }, seo: {} };
  const revision = { payload: { b: "2" }, seo: { canonical: "/x" } };
  const { fields } = diffContentFields(current, revision);
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  assert.equal(byKey.a.from, "1");
  assert.equal(byKey.a.changed, true);          // present→absent
  assert.equal(byKey.b.to, "2");
  assert.equal(byKey.b.changed, true);          // absent→present
  assert.equal(byKey["seo:canonical"].changed, true);
});

test("diffContentFields tolerates missing payload/seo objects", () => {
  const { fields, changedCount } = diffContentFields({}, {});
  assert.equal(fields.length, 1);      // just status
  assert.equal(changedCount, 0);       // both empty
});

// UI wiring: the admin module must inspect-then-restore, not restore on row click.
const CONTENT = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
test("content.js wires the revision diff + an explicit restore-confirm control", () => {
  assert.match(CONTENT, /diffContentFields/);
  assert.match(CONTENT, /data-content-revision-restore/);
});
