import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("newsletter.js subscribes via the shared helper, not an inline job payload", () => {
  const src = read("functions/api/newsletter.js");
  assert.match(src, /from\s+['"]\.\.\/_lib\/klaviyo\.js['"]/, "must import ../_lib/klaviyo.js");
  assert.match(src, /klaviyoSubscribe\(/, "must call klaviyoSubscribe");
  assert.doesNotMatch(src, /profile-subscription-bulk-create-job/, "inline bulk-job payload should move into the helper");
  // contract preserved
  assert.match(src, /newsletter_not_configured/);
  assert.match(src, /klaviyo_error/);
});

test("quote.js schedules industry nurture only after durable intake, before returning", () => {
  const src = read("functions/api/quote.js");
  assert.match(src, /from\s+['"]\.\.\/_lib\/klaviyo\.js['"]/, "quote.js must import ../_lib/klaviyo.js");
  assert.match(src, /subscribeLead\(env/, "quote.js must call injected subscribeLeadByIndustry boundary");
  const durableIdx = src.indexOf("durable = await persistIntake");
  const callIdx = src.indexOf("subscribeLead(env");
  const returnIdx = src.lastIndexOf("return json(durable.duplicate");
  assert.ok(durableIdx > -1 && callIdx > -1 && returnIdx > -1, "anchors present");
  assert.ok(durableIdx < callIdx && callIdx < returnIdx, "subscribe runs only after durable intake and before the response");
});

test("newsletter.html is a real signup page wired to subscribeNewsletter", () => {
  const html = read("newsletter.html");
  assert.match(html, /<input[^>]*type="email"/, "must have an email input");
  assert.match(html, /subscribeNewsletter\(/, "must call window.MASEST.subscribeNewsletter");
  assert.match(html, /js\/main\.js/, "must boot the shared chrome bundle");
  assert.match(html, /name="company"/, "must include the honeypot field the function checks");
  assert.match(html, /rel="canonical" href="https:\/\/masest\.co\/newsletter"/, "must set its canonical URL");
});

test("sitemap lists the newsletter page", () => {
  assert.match(read("sitemap.xml"), /<loc>https:\/\/masest\.co\/newsletter<\/loc>/);
});
