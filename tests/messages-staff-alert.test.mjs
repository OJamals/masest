import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ACCOUNT = readFileSync(new URL("../functions/api/account/messages.js", import.meta.url), "utf8");
const ADMIN = readFileSync(new URL("../functions/api/admin/messages.js", import.meta.url), "utf8");
const SUPPORT_EMAIL = readFileSync(new URL("../functions/_lib/support-email.js", import.meta.url), "utf8");
const SUPPORT_MESSAGES = readFileSync(new URL("../functions/_lib/support-messages.js", import.meta.url), "utf8");

test("buyer POST records chat presence and uses shared support email delivery", () => {
  assert.match(ACCOUNT, /deliverSupportMessageEmail/);
  assert.match(ACCOUNT, /action === 'chat_presence'/);
  assert.match(ACCOUNT, /support_chat_open/);
  assert.match(SUPPORT_EMAIL, /adminMessageAlertKind/);
  assert.match(SUPPORT_EMAIL, /adminMessageRecipients/);
});

test("staff messages target a company user and shared delivery honors buyer presence", () => {
  assert.match(ADMIN, /recipient_user_id/);
  assert.match(ADMIN, /deliverSupportMessageEmail/);
  assert.match(SUPPORT_EMAIL, /shouldEmailSupportRecipient/);
  assert.match(SUPPORT_MESSAGES, /support_chat_open/);
  assert.match(SUPPORT_EMAIL, /emailsByIds/);
});
