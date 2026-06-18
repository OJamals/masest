import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(new URL("../functions/api/account/messages.js", import.meta.url), "utf8");

test("buyer POST emails staff via sendEmail with staff_alert category", () => {
  assert.match(SRC, /sendEmail\(/, "must email staff on new buyer message");
  assert.match(SRC, /ADMIN_EMAILS/, "recipients come from ADMIN_EMAILS");
  assert.match(SRC, /category:\s*'staff_alert'/);
});

test("staff alert sits after the insert and before the success response", () => {
  const send = SRC.indexOf("sendEmail(");
  const created = SRC.indexOf("json(201");
  assert.ok(send > 0 && created > send, "sendEmail must run before the 201 response");
});
