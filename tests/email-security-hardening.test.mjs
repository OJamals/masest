import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  signEmailBridgePayload,
  verifyEmailBridgePayload,
} from "../shared/email-bridge.js";

const messagesSrc = readFileSync(new URL("../functions/api/account/messages.js", import.meta.url), "utf8");
const adminMessagesSrc = readFileSync(new URL("../functions/api/admin/messages.js", import.meta.url), "utf8");
const supportPublisherSrc = readFileSync(new URL("../functions/_lib/support-message-publisher.js", import.meta.url), "utf8");
const supportEmailSrc = readFileSync(new URL("../functions/_lib/support-email.js", import.meta.url), "utf8");
const emailRenderersSrc = readFileSync(new URL("../functions/_lib/email-renderers.js", import.meta.url), "utf8");
const emailBridgeSrc = readFileSync(new URL("../shared/email-bridge.js", import.meta.url), "utf8");
const messageRepliesSrc = readFileSync(new URL("../functions/_lib/message-replies.js", import.meta.url), "utf8");

test("support notification emails route customer and staff content through the canonical escaping renderer", () => {
  assert.match(messagesSrc, /publishSupportMessage/);
  assert.match(adminMessagesSrc, /publishSupportMessage/);
  assert.match(supportPublisherSrc, /assert_email_effects_ready/);
  assert.match(supportPublisherSrc, /emailDelivery: \{ ok: true, queued: true \}/);
  assert.doesNotMatch(supportPublisherSrc, /deliverSupportMessageEmail/);
  assert.match(supportEmailSrc, /renderSupportEmail\(/);
  assert.match(emailRenderersSrc, /const latest = bodyAsHtml\(message\.body\)/);
  assert.match(emailRenderersSrc, /View order \$\{emailEscape\(orderReference\)\}/);
  assert.doesNotMatch(supportEmailSrc, /<blockquote[^>]*>\$\{message\.body\}/);
});

test("email bridge verifier compares every MAC byte without a signature equality short-circuit", () => {
  assert.match(emailBridgeSrc, /difference \|= a\.charCodeAt\(index\) \^ b\.charCodeAt\(index\)/);
  assert.match(emailBridgeSrc, /return difference === 0/);
  assert.doesNotMatch(emailBridgeSrc, /expected === signature|signature === expected/);
});

test("reply-address verifier uses the shared constant-time comparison", () => {
  assert.match(messageRepliesSrc, /timingSafeHexEqual\(token, expected\)/);
  assert.doesNotMatch(messageRepliesSrc, /token === expected|expected === token/);
});

test("email bridge verification accepts valid signatures and rejects tampering and replay", async () => {
  const secret = "super-secret-key-bytes-32-length!!";
  const nowMs = 1_700_000_000_000;
  const timestamp = Math.floor(nowMs / 1000);
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "e1" } });

  const valid = await signEmailBridgePayload(secret, timestamp, body);
  const verify = (overrides = {}) => verifyEmailBridgePayload({
    secret,
    timestamp,
    rawBody: body,
    signature: valid,
    nowMs,
    ...overrides,
  });

  assert.equal(await verify(), true);

  assert.equal(await verify({ rawBody: `${body}x` }), false);
  assert.equal(await verify({ signature: "0".repeat(64) }), false);
  assert.equal(await verify({ signature: "not-hex" }), false);
  assert.equal(await verify({ timestamp: timestamp - 301 }), false);
  assert.equal(await verify({ timestamp: timestamp + 301 }), false);
  assert.equal(await verify({ timestamp: "not-a-timestamp" }), false);
});
