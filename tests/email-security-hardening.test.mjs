import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifySvixSignature } from "../functions/_lib/email.js";

const messagesSrc = readFileSync(new URL("../functions/api/account/messages.js", import.meta.url), "utf8");
const emailSrc = readFileSync(new URL("../functions/_lib/email.js", import.meta.url), "utf8");

test("staff message-alert email escapes buyer-supplied company name and body", () => {
  assert.match(messagesSrc, /import \{[^}]*htmlEscape[^}]*\} from '\.\.\/\.\.\/_lib\/supabase\.js'/);
  assert.match(messagesSrc, /Company: \$\{htmlEscape\(companyName\)\}/);
  assert.match(messagesSrc, /\$\{htmlEscape\(text\.slice\(0, 500\)\)\}/);
  // No raw interpolation of the user text into the email HTML.
  assert.doesNotMatch(messagesSrc, /<p>\$\{text\.slice/);
});

test("Svix verifier uses a constant-time compare (no === short-circuit on the MAC)", () => {
  assert.match(emailSrc, /timingSafeEqualStr\(sig, expected\)/);
  assert.doesNotMatch(emailSrc, /provided\.some\(\(sig\) => sig === expected\)/);
});

// Helper mirrors the library's own signing to craft a genuinely valid Svix signature.
async function signSvix(secret, id, timestamp, body) {
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = Uint8Array.from(atob(rawSecret), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

test("constant-time Svix verify still accepts valid signatures and rejects tampered ones", async () => {
  const secret = `whsec_${btoa("super-secret-key-bytes-32-length!!")}`;
  const id = "msg_1";
  const nowMs = 1_700_000_000_000;
  const timestamp = Math.floor(nowMs / 1000);
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "e1" } });

  const valid = await signSvix(secret, id, timestamp, body);
  assert.equal(await verifySvixSignature(secret, { id, timestamp, signature: valid }, body, { nowMs }), true);

  // Tampered body → reject.
  assert.equal(await verifySvixSignature(secret, { id, timestamp, signature: valid }, body + "x", { nowMs }), false);
  // Wrong signature → reject.
  assert.equal(await verifySvixSignature(secret, { id, timestamp, signature: "v1,AAAA" }, body, { nowMs }), false);
  // Multiple sigs, one valid → accept (Svix may rotate keys).
  assert.equal(await verifySvixSignature(secret, { id, timestamp, signature: `v1,AAAA ${valid}` }, body, { nowMs }), true);
});
