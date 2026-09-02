import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { createQuoteHandler } from "../functions/api/quote.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));

const PRIVATE_ACCOUNT_COPY = /ThermalConcepts|VK\s*TC|Partnership Closing Checklist|\$25\.21|\$28\.83|\$25\.70/i;

test("site presents one program portfolio without exposing account-specific material", () => {
  const home = read("index.html");
  const programs = read("programs.html");
  const chrome = read("js/main/chrome.js");
  const publicProgramCopy = `${home}\n${programs}\n${chrome}`;

  assert.match(chrome, /href:\s*"programs",\s*label:\s*"Programs"/);
  assert.doesNotMatch(chrome, /Water Programs/);
  assert.match(home, /Replace the shelf\. Train the crew\. Keep every route supplied\./);
  assert.match(home, /contact\?type=program/);
  assert.match(programs, /Chemical consolidation/);
  assert.match(programs, /Private-label supply/);
  assert.match(programs, /Pilot rollout/);
  assert.match(programs, /Technician training/);
  assert.match(programs, /Resupply and container returns/);
  assert.match(programs, /id="water-treatment"/);
  assert.doesNotMatch(publicProgramCopy, PRIVATE_ACCOUNT_COPY);
});

test("program intake captures fleet, pilot, supply, and training context", () => {
  const contact = read("contact.html");
  const engagement = read("js/main/engagement.js");
  const quote = read("functions/api/quote.js");

  assert.match(contact, /data-intent="program"[^>]*>[\s\S]*?Program/);
  assert.match(contact, /data-intent-group="program"/);
  for (const id of ["fProgramAssets", "fPilotSize"]) {
    const field = contact.match(new RegExp(`<(?:input|select|textarea)[^>]*id="${id}"[^>]*>`));
    assert.ok(field, `${id} present`);
    assert.match(field[0], /data-req/, `${id} required only for program intent`);
  }
  for (const name of ["current_sku_count", "monthly_usage", "preferred_packs", "current_vendor", "program_services"]) {
    assert.match(contact, new RegExp(`name="${name}"`), `${name} captured`);
  }
  assert.match(engagement, /const INTENTS = \[[^\]]*"program"/);
  assert.match(engagement, /program_assets:\s*"Sites, vehicles, or technicians"/);
  assert.match(quote, /program_services:\s*'Program services'/);
  assert.match(quote, /Confirm current chemical inventory, pilot scope, training, and supply needs\./);
});

test("program requests persist a useful CRM next step and readable field labels", async () => {
  let saved;
  const emails = [];
  const handler = createQuoteHandler({
    rateLimit: async () => ({ ok: true }),
    verifyTurnstile: async () => ({ status: "unconfigured" }),
    adminClient: () => ({}),
    saveIntake: async (_sb, input) => {
      saved = input;
      return { quoteId: "22222222-2222-4222-8222-222222222222", duplicate: false };
    },
    sendEmail: async (_env, message) => { emails.push(message); return { ok: true }; },
    subscribeLeadByIndustry: async () => ({ ok: true }),
  });
  const request = new Request("https://masest.test/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.44" },
    body: JSON.stringify({
      submission_id: "11111111-1111-4111-8111-111111111111",
      type: "program",
      name: "Program Buyer",
      email: "buyer@example.com",
      company: "Fleet Co",
      program_assets: "42 service vehicles",
      pilot_size: "5-10 units",
      current_sku_count: "18",
      monthly_usage: "24 cases",
      preferred_packs: "Quarts and gallons",
      program_services: ["Technician training", "Container-return plan"],
      message: "Consolidate our chemical shelf.",
    }),
  });

  const response = await handler({ request, env: {} });
  assert.equal(response.status, 201);
  assert.equal(saved.row.type, "program");
  assert.equal(saved.row.pipeline_stage, "new");
  assert.equal(saved.row.next_step, "Confirm current chemical inventory, pilot scope, training, and supply needs.");
  assert.equal(saved.row.payload.program_assets, "42 service vehicles");
  assert.deepEqual(saved.row.payload.program_services, ["Technician training", "Container-return plan"]);
  assert.match(emails[0].html, /Sites, vehicles, or technicians/);
  assert.match(emails[0].html, /Program services/);
});

test("marine page promotes one bounded sportfisher field record from canonical proof data", () => {
  const cards = json("data/content/proof.json").proof_cards;
  const marine = json("data/industry-applications.json").industries.find(({ slug }) => slug === "marine");
  const page = read("industries/marine.html");
  const card = cards.find(({ slug }) => slug === "sportfisher-raw-water-intake");

  assert.ok(card, "sportfisher proof record exists");
  assert.equal(card.kind, "marine");
  assert.equal(card.publication_scope, "Published result summary");
  assert.match(card.result, /1:1/);
  assert.match(card.result, /24-hour soak/);
  assert.match(card.result, /No scrubbing/);
  assert.match(card.narrative, /single August 2026 cleaning/i);
  assert.match(card.narrative, /not an antifouling coating/i);
  assert.match(card.source, /field record/i);
  assert.equal(card.image, "img/proof/cases/sportfisher-intake-before-202608.webp");
  assert.equal(card.image_after, "img/proof/cases/sportfisher-intake-after-202608.webp");
  assert.equal(existsSync(new URL(`../${card.image}`, import.meta.url)), true);
  assert.equal(existsSync(new URL(`../${card.image_after}`, import.meta.url)), true);
  assert.equal(marine.featured_proof_slug, card.slug);
  assert.match(page, /Sportfisher raw-water intake descaling/);
  assert.match(page, /href="\.\.\/products\/hcr-t16\?market=marine"/);
  assert.match(page, /href="\.\.\/proof#sportfisher-raw-water-intake"/);
  assert.doesNotMatch(page, PRIVATE_ACCOUNT_COPY);
});
