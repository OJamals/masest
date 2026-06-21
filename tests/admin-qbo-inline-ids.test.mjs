import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("admin Orders uses inline QBO id inputs, not blocking prompt()", () => {
  const src = read("js/admin.js");
  assert.doesNotMatch(src, /prompt\(['"]QuickBooks invoice ID['"]\)/, "invoice prompt() must be removed");
  assert.doesNotMatch(src, /prompt\(['"]QuickBooks payment ID['"]\)/, "payment prompt() must be removed");
  assert.match(src, /data-qbo-invoice-input/, "row should render an inline invoice-id input");
  assert.match(src, /data-qbo-payment-input/, "row should render an inline payment-id input");
});

test("admin quotes owner filter has an accessible name", () => {
  const html = read("admin.html");
  assert.match(html, /id="qOwner"[^>]*aria-label=/, "#qOwner needs an aria-label");
});
