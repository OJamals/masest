import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chrome = read("js/main/chrome.js");
const adminHtml = read("admin.html");

test("shared navigation stays auth-neutral until the account snapshot resolves", () => {
  const placeholder = chrome.match(/<[^>]*class="[^"]*nav-auth-placeholder[^"]*"[^>]*>[\s\S]*?<\/span>/)?.[0] || "";
  assert.ok(placeholder, "shared chrome should reserve an auth-control placeholder");
  assert.doesNotMatch(placeholder, /Sign in/i, "pending auth must not claim the visitor is logged out");
  assert.match(placeholder, /aria-hidden="true"/, "pending auth placeholder should stay out of the accessibility tree");
});

test("admin login gate is not visible before staff authentication resolves", () => {
  const gate = adminHtml.match(/<[^>]*id="admGate"[^>]*>/)?.[0] || "";
  assert.ok(gate, "admin page should declare its authentication gate");
  assert.match(gate, /\bhidden\b/, "admin login gate should start hidden and only appear after an unauthenticated result");
});
