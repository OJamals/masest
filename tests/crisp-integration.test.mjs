import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const INTEGRATIONS = read("../js/integrations.js");
const CHROME = read("../js/main/chrome.js");

test("Crisp integration exposes a complete public bridge", () => {
  assert.match(INTEGRATIONS, /export function loadCrisp/);
  assert.match(INTEGRATIONS, /export function identifyCrispLead/);
  assert.match(INTEGRATIONS, /export function openCrispChat/);
  assert.match(INTEGRATIONS, /export function trackCrispEvent/);
  assert.match(INTEGRATIONS, /user:email/);
  assert.match(INTEGRATIONS, /user:nickname/);
  assert.match(INTEGRATIONS, /user:company/);
  assert.match(INTEGRATIONS, /session:data/);
  assert.match(INTEGRATIONS, /session:segments/);
  assert.match(INTEGRATIONS, /chat:open/);
});

test("Crisp integration captures site and quote context", () => {
  assert.match(INTEGRATIONS, /syncCrispPageContext/);
  assert.match(INTEGRATIONS, /URLSearchParams/);
  assert.match(INTEGRATIONS, /quoteForm/);
  assert.match(INTEGRATIONS, /identifyCrispLead\(lead\)/);
  assert.match(INTEGRATIONS, /quote_form_submitted/);
  assert.match(INTEGRATIONS, /data-crisp-open/);
});

test("Crisp integration syncs buyer account and cart context", () => {
  assert.match(INTEGRATIONS, /export async function syncCrispAccountContext/);
  assert.match(INTEGRATIONS, /hasAuthSessionMarker/);
  assert.match(INTEGRATIONS, /import\("\.\/auth\.js"\)/);
  assert.match(INTEGRATIONS, /account_email/);
  assert.match(INTEGRATIONS, /account_company/);
  assert.match(INTEGRATIONS, /account_staff/);
  assert.match(INTEGRATIONS, /export function syncCrispCartContext/);
  assert.match(INTEGRATIONS, /masest_cart/);
  assert.match(INTEGRATIONS, /cart_count/);
  assert.match(INTEGRATIONS, /cart_skus/);
  assert.match(INTEGRATIONS, /masest:cart/);
  assert.match(INTEGRATIONS, /cart:updated/);
});

test("shared chrome loads public config before integrations once per page", () => {
  assert.match(CHROME, /window\.__masestIntegrations/);
  assert.match(CHROME, /js\/config\.js/);
  assert.match(CHROME, /js\/integrations\.js/);
  assert.match(CHROME, /data-crisp-open/);
  assert.match(CHROME, /Live chat/);
  assert.ok(CHROME.indexOf("js/config.js") < CHROME.indexOf("js/integrations.js"));
});
