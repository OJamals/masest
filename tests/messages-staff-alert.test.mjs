import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ACCOUNT = readFileSync(new URL("../functions/api/account/messages.js", import.meta.url), "utf8");
const ADMIN = readFileSync(new URL("../functions/api/admin/messages.js", import.meta.url), "utf8");

test("buyer POST records chat presence and honours admin email settings", () => {
  assert.match(ACCOUNT, /adminMessageAlertKind/);
  assert.match(ACCOUNT, /adminMessageRecipients/);
  assert.match(ACCOUNT, /action === 'chat_presence'/);
  assert.match(ACCOUNT, /support_chat_open/);
});

test("staff reply emails only a closed-chat user with an unanswered question", () => {
  assert.match(ADMIN, /lastMessage/);
  assert.match(ADMIN, /support_chat_open/);
  assert.match(ADMIN, /shouldEmailClosedChatReply/);
  assert.match(ADMIN, /emailsByIds/);
});
