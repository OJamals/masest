import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engagement = await readFile(new URL("../js/main/engagement.js", import.meta.url), "utf8");
const contact = await readFile(new URL("../contact.html", import.meta.url), "utf8");

// Regression: the "Add request details" toggle used to swallow the intent
// groups — it force-hid the Sample Kit picker (a sample request could submit
// with zero products) and stripped data-req off audit/distributor core fields.
test("request-details toggle governs only shared + quote extras, never intent groups", () => {
  const idsMatch = engagement.match(/const advancedIds = \[([^\]]+)\]/);
  assert.ok(idsMatch, "advancedIds list exists");
  const ids = [...idsMatch[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["fPhone", "fIndustry", "fLocation", "fProduct", "fVolume", "fTimeline"]);
  assert.ok(!engagement.includes("progressiveSampleGroup"), "sample group is not toggled by the request-details button");
});

test("intent-core fields keep their data-req so applyIntent can require them", () => {
  for (const id of ["fSystem", "fShipTo", "fCompanyType", "fTerritory"]) {
    const tag = contact.match(new RegExp(`<(?:input|select|textarea)[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `${id} present`);
    assert.match(tag[0], /data-req/, `${id} keeps data-req`);
  }
});

test("dead always-stripped required markers stay out of the shared fields", () => {
  const industry = contact.match(/<select[^>]*id="fIndustry"[^>]*>/)[0];
  const product = contact.match(/<select[^>]*id="fProduct"[^>]*>/)[0];
  assert.doesNotMatch(industry, /required/);
  assert.doesNotMatch(product, /data-req/);
});

// Prefill must survive name drift between links and option text.
test("prefill uses normalized option matching", () => {
  assert.match(engagement, /const selectOption = /);
  assert.match(engagement, /replace\(\/\[\^a-z0-9\]\+\/g, ""\)/);
});

// An unmatched ?product= (program-fit names) must land in the notes, not vanish.
test("unmatched product param falls back to the message field", () => {
  assert.match(engagement, /Product interest: /);
  assert.match(engagement, /preMatched/);
});

test("industry select covers every generated industry page", () => {
  for (const sector of [
    "Oil, Gas &amp; Process Plants", "Marine", "Manufacturing", "Food &amp; Beverage", "Healthcare",
    "Construction", "Distribution / Cold Storage", "Military / Government",
    "Education Facilities", "HVAC / Water Treatment", "Plumbing",
    "Golf Courses &amp; Sports Facilities", "Hotels, Resorts &amp; Property Management",
    "Solar Farms &amp; Panel Cleaning",
  ]) {
    assert.ok(contact.includes(`<option>${sector}</option>`), `industry option: ${sector}`);
  }
});
