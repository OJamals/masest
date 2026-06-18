import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeIndustry, listIdForIndustry, klaviyoSubscribe, subscribeLeadByIndustry,
} from "../functions/_lib/klaviyo.js";

const ENV = {
  KLAVIYO_PRIVATE_KEY: "pk_test",
  KLAVIYO_LIST_OIL_GAS: "LIST_OIL",
  KLAVIYO_LIST_HVAC_WATER: "LIST_HVAC",
  KLAVIYO_LIST_NURTURE: "LIST_FALLBACK",
};

function stubFetch(status) {
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { status }; };
  return calls;
}
let realFetch;
test.before(() => { realFetch = globalThis.fetch; });
test.afterEach(() => { globalThis.fetch = realFetch; });

test("normalizeIndustry lowercases and underscores", () => {
  assert.equal(normalizeIndustry("Oil & Gas"), "oil_gas");
  assert.equal(normalizeIndustry("HVAC / Water Treatment"), "hvac_water_treatment");
  assert.equal(normalizeIndustry("  Military / Government "), "military_government");
  assert.equal(normalizeIndustry(""), "");
});

test("listIdForIndustry maps, falls back to NURTURE, or null", () => {
  assert.equal(listIdForIndustry(ENV, "Oil & Gas"), "LIST_OIL");
  assert.equal(listIdForIndustry(ENV, "HVAC / Water Treatment"), "LIST_HVAC");
  assert.equal(listIdForIndustry(ENV, "Other"), "LIST_FALLBACK");   // unmapped -> fallback
  assert.equal(listIdForIndustry(ENV, ""), "LIST_FALLBACK");        // empty -> fallback
  assert.equal(listIdForIndustry({}, "Oil & Gas"), null);          // nothing configured
});

test("klaviyoSubscribe skips without key/list and never throws", async () => {
  const calls = stubFetch(202);
  assert.deepEqual(await klaviyoSubscribe({}, "a@b.co", "L1"), { ok: false, skipped: true });
  assert.deepEqual(await klaviyoSubscribe(ENV, "a@b.co", ""), { ok: false, skipped: true });
  assert.deepEqual(await klaviyoSubscribe(ENV, "bad-email", "L1"), { ok: false, skipped: true });
  assert.equal(calls.length, 0, "no network call when skipped");
});

test("klaviyoSubscribe posts and reports 202 success / non-202 failure", async () => {
  const ok = stubFetch(202);
  const r1 = await klaviyoSubscribe(ENV, "a@b.co", "L1");
  assert.deepEqual(r1, { ok: true, status: 202 });
  assert.equal(ok.length, 1);
  assert.match(ok[0].url, /profile-subscription-bulk-create-jobs/);
  assert.match(ok[0].opts.body, /"id":"L1"/);
  assert.match(ok[0].opts.headers.Authorization, /Klaviyo-API-Key pk_test/);

  stubFetch(400);
  const r2 = await klaviyoSubscribe(ENV, "a@b.co", "L1");
  assert.deepEqual(r2, { ok: false, status: 400 });
});

test("subscribeLeadByIndustry resolves the list and subscribes", async () => {
  const calls = stubFetch(202);
  const r = await subscribeLeadByIndustry(ENV, { email: "a@b.co", industry: "Oil & Gas" });
  assert.equal(r.ok, true);
  assert.equal(r.listId, "LIST_OIL");
  assert.match(calls[0].opts.body, /"id":"LIST_OIL"/);
});

test("subscribeLeadByIndustry skips when no list resolves", async () => {
  const calls = stubFetch(202);
  const r = await subscribeLeadByIndustry({}, { email: "a@b.co", industry: "Oil & Gas" });
  assert.deepEqual(r, { ok: false, skipped: true });
  assert.equal(calls.length, 0);
});
