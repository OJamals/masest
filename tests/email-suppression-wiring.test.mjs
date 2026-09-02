import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(new URL("../functions/_lib/supabase.js", import.meta.url), "utf8");

test("sendEmail filters suppressed recipients per stream before sending", () => {
  assert.match(SRC, /loadSuppressed\(/, "sendEmail must load the suppression map");
  assert.match(SRC, /filterByStream\(allTo, category/, "sendEmail must filter by category stream");
});

test("sendEmail logs an email_events row with category and provider message id", () => {
  assert.match(SRC, /logEmailEvent\(/, "sendEmail must log the send");
  assert.match(SRC, /category/, "sendEmail must accept a category");
  assert.match(SRC, /email_events/, "must write to email_events");
  assert.match(SRC, /provider_message_id/, "must persist provider lifecycle identity");
});

test("supabase lib imports the pure email helpers", () => {
  assert.match(SRC, /from '\.\/email\.js'/);
});

test("lib exposes recordSuppression + updateEmailStatus", () => {
  assert.match(SRC, /export async function recordSuppression\(/);
  assert.match(SRC, /export async function updateEmailStatus\(/);
});

test("sendEmail supports bcc (offer broadcast privacy)", () => {
  assert.match(SRC, /bcc/, "sendEmail must accept bcc");
});

const OFFERS = readFileSync(new URL("../functions/api/admin/offers.js", import.meta.url), "utf8");

test("offers use the canonical Klaviyo marketing gateway", () => {
  assert.match(OFFERS, /queueMarketingEmail\(/, "offers must call the canonical marketing gateway");
  assert.match(OFFERS, /category:\s*'offer'/, "offers must tag category 'offer'");
  assert.doesNotMatch(OFFERS, /sendEmail(?:Result)?\(/, "offers must not enter Cloudflare transactional sending");
  assert.doesNotMatch(OFFERS, /api\.resend\.com/, "offers must not call a retired provider directly");
});
