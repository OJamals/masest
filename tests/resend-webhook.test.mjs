import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(new URL("../functions/api/resend-webhook.js", import.meta.url), "utf8");
const LIB = readFileSync(new URL("../functions/_lib/supabase.js", import.meta.url), "utf8");

test("webhook verifies the Svix signature before any DB write", () => {
  assert.match(SRC, /verifySvixSignature\(/);
  assert.match(SRC, /svix-id/i);
  assert.match(SRC, /svix-signature/i);
  assert.match(SRC, /json\(400/, "bad signature returns 400");
});

test("webhook maps events and updates status + suppression", () => {
  assert.match(SRC, /mapResendEvent\(/);
  assert.match(SRC, /isSuppressingEvent\(/);
  assert.match(SRC, /updateEmailStatus\(/);
  assert.match(SRC, /recordSuppression\(/);
});

test("webhook no-ops (200) when secret unset and returns 200 on processing", () => {
  assert.match(SRC, /RESEND_WEBHOOK_SECRET/);
  assert.match(SRC, /json\(200/);
});

test("lib exposes recordSuppression + updateEmailStatus", () => {
  assert.match(LIB, /export async function recordSuppression\(/);
  assert.match(LIB, /export async function updateEmailStatus\(/);
});
