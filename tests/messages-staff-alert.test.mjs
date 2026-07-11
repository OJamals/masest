import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ACCOUNT = readFileSync(new URL("../functions/api/account/messages.js", import.meta.url), "utf8");
const ADMIN = readFileSync(new URL("../functions/api/admin/messages.js", import.meta.url), "utf8");

test("buyer POST stays in the admin inbox and records chat presence", () => {
  assert.doesNotMatch(ACCOUNT, /sendEmail\(/, "buyer posts must not send staff email alerts");
  assert.match(ACCOUNT, /action === 'chat_presence'/);
  assert.match(ACCOUNT, /support_chat_open/);
});

test("staff reply emails only a closed-chat user with an unanswered question", () => {
  assert.match(ADMIN, /lastMessage/);
  assert.match(ADMIN, /support_chat_open/);
  assert.match(ADMIN, /shouldEmailClosedChatReply/);
  assert.match(ADMIN, /emailsByIds/);
});
