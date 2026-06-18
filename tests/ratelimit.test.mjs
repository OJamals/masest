import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { rateLimit, clientIp } from "../functions/_lib/ratelimit.js";

test("rateLimit no-ops (allows) when no RATE_KV binding is present", async () => {
  const r = await rateLimit({}, "quote", "1.2.3.4");
  assert.equal(r.ok, true);
  assert.equal(r.disabled, true);
});

test("rateLimit blocks once the per-window limit is exceeded", async () => {
  const store = new Map();
  const env = { RATE_KV: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } } };
  let last;
  for (let i = 0; i < 7; i++) last = await rateLimit(env, "t", "9.9.9.9", { limit: 5, windowSec: 60 });
  assert.equal(last.ok, false);
  assert.equal(last.retryAfter, 60);
});

test("clientIp prefers CF-Connecting-IP then falls back to XFF", () => {
  assert.equal(clientIp({ headers: { get: (h) => (h === "CF-Connecting-IP" ? "5.6.7.8" : null) } }), "5.6.7.8");
  assert.equal(clientIp({ headers: { get: (h) => (h === "x-forwarded-for" ? "  3.3.3.3, 4.4.4.4" : null) } }), "3.3.3.3");
});

test("quote + newsletter endpoints invoke the rate limiter", () => {
  // static guard: keep the wiring from being dropped in future edits
  const q = readFileSync(new URL("../functions/api/quote.js", import.meta.url), "utf8");
  const n = readFileSync(new URL("../functions/api/newsletter.js", import.meta.url), "utf8");
  assert.match(q, /rateLimit\(env, 'quote'/);
  assert.match(n, /rateLimit\(env, 'newsletter'/);
});
