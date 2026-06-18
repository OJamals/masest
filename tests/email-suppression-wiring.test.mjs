import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(new URL("../functions/_lib/supabase.js", import.meta.url), "utf8");

test("sendEmail filters suppressed recipients before sending", () => {
  assert.match(SRC, /loadSuppressed\(/, "sendEmail must load the suppression set");
  assert.match(SRC, /filterSuppressed\(/, "sendEmail must filter recipients");
});

test("sendEmail logs an email_events row with category and resend id", () => {
  assert.match(SRC, /logEmailEvent\(/, "sendEmail must log the send");
  assert.match(SRC, /category/, "sendEmail must accept a category");
  assert.match(SRC, /email_events/, "must write to email_events");
});

test("supabase lib imports the pure email helpers", () => {
  assert.match(SRC, /from '\.\/email\.js'/);
});

test("lib exposes recordSuppression + updateEmailStatus", () => {
  assert.match(SRC, /export async function recordSuppression\(/);
  assert.match(SRC, /export async function updateEmailStatus\(/);
});
