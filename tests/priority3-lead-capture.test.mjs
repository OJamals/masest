import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const resources = read("resources.html");
const chrome = read("js/main/chrome.js");
const track = read("js/track.js");
const engagement = read("js/main/engagement.js");
const integrations = read("js/integrations.js");
const newsletter = read("functions/api/newsletter.js");
const klaviyo = read("functions/_lib/klaviyo.js");
const contact = read("contact.html");

test("document room keeps downloads instant while offering revision notifications", () => {
  assert.match(resources, /id="docNotifyEmail"/, "document room should expose an optional email field");
  assert.match(resources, /Notify me when this document is revised\./);
  assert.match(resources, /data-document-download/);
  assert.match(resources, /data-document-name="VertKleen HCR SDS"/, "download links should carry document names");
  assert.doesNotMatch(resources, /required[^>]*id="docNotifyEmail"/, "revision email must stay optional");
});

test("document downloads are logged with the document name", () => {
  assert.match(chrome, /wireDocumentRoomCapture\(\)/, "shared chrome should wire document capture");
  assert.match(chrome, /data-document-download/);
  assert.match(chrome, /mtrack\(["']document_download["'],\s*\{/);
  assert.match(chrome, /document:\s*docName/);
  assert.match(track, /\['document', detail\.document\]/, "track payload path should include the document name");
});

test("footer newsletter signup sends page and industry context", () => {
  assert.match(chrome, /newsletterSourceContext/);
  assert.match(chrome, /source_path:\s*window\.location\.pathname/);
  assert.match(chrome, /industry:\s*industryFromPath\(\)/);
  assert.match(chrome, /subscribeNewsletter\(email,\s*newsletterSourceContext\(\)\)/);
  assert.match(integrations, /subscribeNewsletter\(email,\s*context\s*=\s*\{\}\)/);
  assert.match(integrations, /source_path/);
  assert.match(integrations, /industry/);
  assert.match(newsletter, /newsletterProperties/);
  assert.match(klaviyo, /properties:\s*profileProperties/);
});

test("quote-submit analytics carries request type, industry, and product metadata", () => {
  assert.match(engagement, /mtrack\(["']quote_submit["'],\s*\{/);
  assert.match(engagement, /industry:\s*data\.get\(["']industry["']\)/);
  assert.match(engagement, /request_type:\s*data\.get\(["']type["']\)/);
  assert.match(engagement, /product:\s*data\.get\(["']product["']\)/);
  assert.match(track, /\['industry', detail\.industry\]/);
  assert.match(track, /\['request_type', detail\.request_type\]/);
});

test("contact page exposes all five public request types", () => {
  for (const label of ["Quote", "Chemical Audit", "Sample Kit", "Distributor"]) {
    assert.match(contact, new RegExp(label));
  }
  assert.match(contact, /data-intent="technical"/, "technical document requests should be a first-class contact intent");
  assert.match(contact, /<option>Data Centers<\/option>/);
});

test("shared chrome resolves one-level-deep comparison pages", () => {
  assert.match(chrome, /\(\?:industries\|products\|comparisons\|blog\)/);
});
