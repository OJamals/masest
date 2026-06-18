import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  filterSuppressed,
  mapResendEvent,
  isSuppressingEvent,
  verifySvixSignature,
} from "../functions/_lib/email.js";

test("filterSuppressed drops suppressed addresses, case-insensitive", () => {
  const out = filterSuppressed(["A@x.com", "keep@x.com"], new Set(["a@x.com"]));
  assert.deepEqual(out, ["keep@x.com"]);
});

test("filterSuppressed returns all when suppression set empty", () => {
  assert.deepEqual(filterSuppressed(["a@x.com"], new Set()), ["a@x.com"]);
});

test("mapResendEvent maps Resend event types to internal status", () => {
  assert.equal(mapResendEvent("email.delivered"), "delivered");
  assert.equal(mapResendEvent("email.bounced"), "bounced");
  assert.equal(mapResendEvent("email.complained"), "complained");
  assert.equal(mapResendEvent("email.sent"), "sent");
  assert.equal(mapResendEvent("email.delivery_delayed"), null);
  assert.equal(mapResendEvent("unknown.event"), null);
});

test("isSuppressingEvent true only for bounce + complaint", () => {
  assert.equal(isSuppressingEvent("email.bounced"), true);
  assert.equal(isSuppressingEvent("email.complained"), true);
  assert.equal(isSuppressingEvent("email.delivered"), false);
});

function signSvix(secretB64, id, ts, body) {
  const key = Buffer.from(secretB64, "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return `v1,${sig}`;
}

test("verifySvixSignature accepts a valid signature", async () => {
  const secretB64 = Buffer.from("supersecretkey").toString("base64");
  const id = "msg_1", ts = "1700000000", body = '{"type":"email.delivered"}';
  const header = signSvix(secretB64, id, ts, body);
  const ok = await verifySvixSignature(`whsec_${secretB64}`,
    { id, timestamp: ts, signature: header }, body);
  assert.equal(ok, true);
});

test("verifySvixSignature rejects a tampered body", async () => {
  const secretB64 = Buffer.from("supersecretkey").toString("base64");
  const id = "msg_1", ts = "1700000000";
  const header = signSvix(secretB64, id, ts, '{"type":"email.delivered"}');
  const ok = await verifySvixSignature(`whsec_${secretB64}`,
    { id, timestamp: ts, signature: header }, '{"type":"email.bounced"}');
  assert.equal(ok, false);
});

test("verifySvixSignature rejects missing parts", async () => {
  assert.equal(await verifySvixSignature("whsec_x", { id: "", timestamp: "", signature: "" }, "b"), false);
});
