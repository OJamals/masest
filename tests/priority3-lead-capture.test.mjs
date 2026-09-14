import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { launchTestBrowser, startStaticTestServer } from "../tools/test-static-server.mjs";

import { QUOTE_TASK_DETAILS } from "../js/quote-task-details.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
let BASE_URL = "";

const resources = read("resources.html");
const chrome = read("js/main/chrome.js");
const track = read("js/track.js");
const engagement = read("js/main/engagement.js");
const integrations = read("js/integrations.js");
const newsletter = read("functions/api/newsletter.js");
const marketingSubscribers = read("functions/_lib/marketing-subscribers.js");
const contact = read("contact.html");
const productPage = read("products/hcr.html");

const SAMPLE_PRODUCTS = [
  "VertKleen CR",
  "VertKleen CR2",
  "VertKleen HCR",
  "VertKleen HCR - 16+ Tote Program",
  "VertKleen Descaler",
  "VertKleen CR HD",
  "VertKleen CR HD Low Foam",
  "VertKleen Neutral",
  "VertKleen MultiWash",
  "VertKleen LAM3",
  "Purgo",
  "VertKleen AlumiBrite",
  "VertKleen Torque",
  "VertKleen SAR",
  "WaterSafe60",
];

async function withServer(fn) {
  const staticSite = await startStaticTestServer(root);
  BASE_URL = staticSite.baseUrl;
  try {
    await fn();
  } finally {
    await staticSite.close();
  }
}

function hasMultipartField(body, name, value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`name="${name}"\\r?\\n\\r?\\n${escaped}(?:\\r?\\n|$)`).test(body);
}

test("document room keeps downloads instant while offering revision notifications", () => {
  assert.match(resources, /id="docNotifyEmail"/, "document room should expose an optional email field");
  assert.match(resources, /Notify me when this document is revised\./);
  assert.match(resources, /data-document-download/);
  assert.match(resources, /data-document-name="[^"]+"[^>]*data-document-download/, "public download links should carry document names");
  assert.doesNotMatch(resources, /docs\/labels\/marine|VertKleen Marine Antimicrobial Label/, "internal marine artwork must stay out of the document room");
  assert.doesNotMatch(resources, /required[^>]*id="docNotifyEmail"/, "revision email must stay optional");
});

test("document downloads are logged with the document name", () => {
  assert.match(chrome, /wireDocumentDownloadCapture\(\)/, "shared chrome should wire direct-download capture");
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
  assert.match(newsletter, /tags:\s*\[properties\.industry, properties\.document\]\.filter\(Boolean\)/);
  assert.match(marketingSubscribers, /p_tags:/);
});

test("quote-submit analytics carries request type, industry, and product metadata", () => {
  assert.match(engagement, /mtrack\(["']quote_submit["'],\s*\{/);
  assert.match(engagement, /industry:\s*data\.get\(["']industry["']\)/);
  assert.match(engagement, /request_type:\s*data\.get\(["']type["']\)/);
  assert.match(engagement, /product:\s*data\.get\(["']product["']\)/);
  assert.match(track, /\['industry', detail\.industry\]/);
  assert.match(track, /\['request_type', detail\.request_type\]/);
});

test("contact page exposes all six public request types", () => {
  for (const label of ["Quote", "Replace a Cleaner", "Program", "Sample Kit", "Labels &amp; SDS", "Distributor"]) {
    assert.match(contact, new RegExp(label));
  }
  assert.match(contact, /data-intent="technical"/, "technical document requests should be a first-class contact intent");
  assert.match(contact, /<option>Data Centers<\/option>/);
  const marketingControl = contact.match(/<input id="fMarketingEmail"[^>]*>/)?.[0];
  assert.ok(marketingControl, "contact form should expose the marketing consent control");
  assert.match(marketingControl, /\bchecked\b/, "email updates should be selected by default");
  assert.match(contact, /Unsubscribe anytime\./);
});

test("quote form defaults to email updates and respects an unchecked option", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const requests = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await page.route("**/api/quote", async (route) => {
        requests.push(route.request().postData() || "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, durable: true, quote_id: "44444444-4444-4444-8444-444444444444" }),
        });
      });
      await page.goto(`${BASE_URL}/contact.html?type=quote`, { waitUntil: "load" });
      assert.equal(await page.locator("#fMarketingEmail").isChecked(), true, "email updates should start checked");
      await page.locator("#fMarketingEmail").uncheck();
      await page.fill("#fName", "Opt-in Buyer");
      await page.fill("#fCompany", "Opt-in Company");
      await page.fill("#fEmail", "opt-in@example.com");
      await page.fill("#fMessage", "Explicit marketing consent test");
      await page.locator('#quoteForm button[type="submit"]').click();
      await page.getByRole("heading", { name: "Request received." }).waitFor();
      assert.equal(hasMultipartField(requests[0], "marketing_email_enabled", "on"), false);

      await page.goto(`${BASE_URL}/contact.html?type=quote`, { waitUntil: "load" });
      assert.equal(await page.locator("#fMarketingEmail").isChecked(), true);
      await page.fill("#fName", "Opt-in Buyer");
      await page.fill("#fCompany", "Opt-in Company");
      await page.fill("#fEmail", "opt-in@example.com");
      await page.fill("#fMessage", "Explicit marketing consent test");
      await page.locator('#quoteForm button[type="submit"]').click();
      await page.getByRole("heading", { name: "Request received." }).waitFor();
    } finally {
      await browser.close();
    }
    assert.equal(requests.length, 2);
    assert.equal(hasMultipartField(requests[0], "marketing_email_enabled", "on"), false);
    assert.equal(hasMultipartField(requests[1], "marketing_email_enabled", "on"), true);
  });
});

test("product detail pages expose a product-specific free sample request CTA", () => {
  assert.match(productPage, /contact\?type=sample&product=/, "sample CTA should prefill the contact sample flow");
  assert.match(productPage, /Try a free [^<]*sample/);
});

test("sample picker covers the full parent product catalog", () => {
  for (const label of SAMPLE_PRODUCTS) {
    assert.match(contact, new RegExp(`value="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `${label} should be sample-requestable`);
  }
});

test("contact form posts all six public request types to quote intake", async () => {
  const flows = [
    { intent: "quote", fill: async () => {} },
    { intent: "audit", fill: async (page) => page.fill("#fSystem", "Cooling tower loop") },
    {
      intent: "program",
      fill: async (page) => {
        await page.fill("#fProgramAssets", "14 service vehicles and 22 technicians");
        await page.selectOption("#fPilotSize", { label: "2-5 sites, vehicles, or crews" });
        await page.fill("#fCurrentSkuCount", "11");
        await page.fill("#fMonthlyUsage", "18 pails and 2 drums");
        await page.selectOption("#fPreferredPacks", { label: "Mixed packs by route or site" });
        await page.fill("#fCurrentVendor", "Current regional supplier");
        for (const label of ["Chemical consolidation", "Technician training", "Recurring resupply"]) {
          await page.getByLabel(label, { exact: true }).check();
        }
      },
    },
    {
      intent: "sample",
      fill: async (page) => {
        for (const label of ["VertKleen HCR", "VertKleen CR", "VertKleen Descaler"]) {
          const checkbox = page.getByLabel(label, { exact: true });
          await checkbox.evaluate(input => input.click());
          assert.equal(await checkbox.isChecked(), true, `${label} should be selected`);
        }
        await page.fill("#fShipTo", "Test Facility, 1 Main St, Tampa FL 33602");
      },
    },
    { intent: "technical", fill: async () => {} },
    {
      intent: "distributor",
      fill: async (page) => {
        await page.selectOption("#fCompanyType", { label: "Distributor / reseller" });
        await page.fill("#fTerritory", "Southeast US");
      },
    },
  ];

  await withServer(async () => {
    const browser = await launchTestBrowser();
    const requests = [];
    try {
      for (const flow of flows) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
        await page.route("**/api/quote", async (route) => {
          requests.push(route.request().postData() || "");
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, durable: true, quote_id: "11111111-1111-4111-8111-111111111111" }),
          });
        });
        await page.goto(`${BASE_URL}/contact.html?type=${flow.intent}&industry=Data%20Centers`, { waitUntil: "load" });
        const taskDetails = page.locator("#quoteTaskDetails");
        assert.equal(await taskDetails.isVisible(), false, `${flow.intent} task details should start hidden`);
        await page.getByRole("button", { name: "Add request details" }).click();
        assert.equal(
          await taskDetails.isVisible(),
          ["quote", "audit", "sample"].includes(flow.intent),
          `${flow.intent} should expose task details only when useful`,
        );
        if (["technical", "distributor"].includes(flow.intent)) {
          await page.locator("#fCurrentChemical").evaluate((input) => {
            input.value = "Not applicable";
          });
        }
        await page.fill("#fName", "QA Buyer");
        await page.fill("#fCompany", "QA Company");
        await page.fill("#fEmail", `${flow.intent}@example.com`);
        await page.fill("#fMessage", `${flow.intent} request smoke test`);
        if (flow.intent === "sample") {
          await page.locator('[data-intent-group="sample"]').waitFor({ state: "visible" });
        }
        await flow.fill(page);
        await page.locator('#quoteForm button[type="submit"]').click();
        await page.getByRole("heading", { name: "Request received." }).waitFor();
        await page.close();
      }
    } finally {
      await browser.close();
    }

    assert.equal(requests.length, flows.length);
    for (const flow of flows) {
      const body = requests.find((requestBody) => hasMultipartField(requestBody, "type", flow.intent));
      assert.ok(body, `${flow.intent} request should post its type`);
      assert.ok(hasMultipartField(body, "industry", "Data Centers"), `${flow.intent} request should carry industry attribution`);
      assert.ok(hasMultipartField(body, "email", `${flow.intent}@example.com`), `${flow.intent} request should carry email`);
      if (flow.intent === "program") {
        assert.ok(hasMultipartField(body, "program_assets", "14 service vehicles and 22 technicians"));
        assert.ok(hasMultipartField(body, "pilot_size", "2-5 sites, vehicles, or crews"));
        assert.ok(hasMultipartField(body, "program_services", "Technician training"));
      }
      if (["technical", "distributor"].includes(flow.intent)) {
        assert.equal(
          hasMultipartField(body, "current_chemical", "Not applicable"),
          false,
          `${flow.intent} should not post task economics`,
        );
      }
    }
  });
});

test("task economics and operating boundaries survive URL prefill, editing, and submission", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const requests = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await page.route("**/api/quote", async (route) => {
        requests.push(route.request().postData() || "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, durable: true, quote_id: "22222222-2222-4222-8222-222222222222" }),
        });
      });
      await page.goto(
        `${BASE_URL}/contact.html?type=audit&product=CR%20HD%20vs%20Simple%20Green`,
        { waitUntil: "load" },
      );
      assert.equal(
        await page.locator("#quoteTaskDetails").isVisible(),
        true,
        "comparison audit CTA should disclose cost-per-task inputs",
      );
      assert.match(
        await page.inputValue("#fMessage"),
        /Product interest: CR HD vs Simple Green/,
      );

      const query = new URLSearchParams({
        type: "audit",
        industry: "Data Centers",
        current_chemical: "Current cleaner",
        current_dilution: "1:12",
        labor_per_task: "2 technicians × 3 hours",
        water_per_task: "300 gallons",
        downtime_per_task: "4 hours",
        disposal_per_task: "Hauler pickup",
        asset_life: "18-month maintenance interval",
        wastewater_route: "On-site pretreatment",
        reopening_criteria: "Supervisor inspection and release",
      });
      await page.goto(`${BASE_URL}/contact.html?${query}`, { waitUntil: "load" });

      assert.equal(await page.locator("#quoteTaskDetails").isVisible(), true);
      assert.equal(await page.inputValue("#fCurrentChemical"), "Current cleaner");
      assert.equal(await page.inputValue("#fCurrentDilution"), "1:12");
      assert.equal(await page.inputValue("#fLaborPerTask"), "2 technicians × 3 hours");
      assert.equal(await page.inputValue("#fWaterPerTask"), "300 gallons");
      assert.equal(await page.inputValue("#fDowntimePerTask"), "4 hours");
      assert.equal(await page.inputValue("#fDisposalPerTask"), "Hauler pickup");
      assert.equal(await page.inputValue("#fAssetLife"), "18-month maintenance interval");
      assert.equal(await page.inputValue("#fWastewaterRoute"), "On-site pretreatment");
      assert.equal(
        await page.inputValue("#fReopeningCriteria"),
        "Supervisor inspection and release",
      );
      assert.deepEqual(
        await page.locator("#quoteTaskDetails input, #quoteTaskDetails textarea").evaluateAll(
          (controls) => Object.fromEntries(controls.map((control) => [control.name, control.maxLength])),
        ),
        Object.fromEntries(QUOTE_TASK_DETAILS.map(({ name, limit }) => [name, limit])),
      );

      await page.fill("#fWastewaterRoute", "Edited permitted route");
      await page.getByRole("button", { name: "Labels & SDS" }).click();
      assert.equal(await page.locator("#quoteTaskDetails").isVisible(), false);
      assert.equal(await page.locator("#fCurrentChemical").isDisabled(), true);
      await page.getByRole("button", { name: "Replace a Cleaner" }).click();
      assert.equal(await page.locator("#quoteTaskDetails").isVisible(), true);
      assert.equal(await page.inputValue("#fWastewaterRoute"), "Edited permitted route");

      await page.fill("#fName", "Lifecycle Buyer");
      await page.fill("#fCompany", "Lifecycle Facility");
      await page.fill("#fEmail", "lifecycle@example.com");
      await page.fill("#fSystem", "Cooling water loop");
      await page.fill("#fMessage", "Compare one completed cleaning task.");
      await page.locator('#quoteForm button[type="submit"]').click();
      await page.getByRole("heading", { name: "Request received." }).waitFor();
      await page.close();
    } finally {
      await browser.close();
    }

    assert.equal(requests.length, 1);
    for (const [name, value] of [
      ["current_chemical", "Current cleaner"],
      ["current_dilution", "1:12"],
      ["labor_per_task", "2 technicians × 3 hours"],
      ["water_per_task", "300 gallons"],
      ["downtime_per_task", "4 hours"],
      ["disposal_per_task", "Hauler pickup"],
      ["asset_life", "18-month maintenance interval"],
      ["wastewater_route", "Edited permitted route"],
      ["reopening_criteria", "Supervisor inspection and release"],
    ]) {
      assert.ok(hasMultipartField(requests[0], name, value), `${name} should survive submission`);
    }
  });
});

test("product-prefilled sample requests can submit one requested product", async () => {
  await withServer(async () => {
    const browser = await launchTestBrowser();
    const requests = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await page.route("**/api/quote", async (route) => {
        requests.push(route.request().postData() || "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, durable: true, quote_id: "33333333-3333-4333-8333-333333333333" }),
        });
      });
      await page.goto(`${BASE_URL}/contact.html?type=sample&product=VertKleen%20CR2`, { waitUntil: "domcontentloaded" });
      await expectPoll(async () => page.getByLabel("VertKleen CR2", { exact: true }).isChecked());
      await page.fill("#fName", "Sample Buyer");
      await page.fill("#fCompany", "Sample Company");
      await page.fill("#fEmail", "sample-product@example.com");
      await page.fill("#fShipTo", "Sample Facility, 1 Main St, Tampa FL 33602");
      await page.fill("#fMessage", "Testing CR2 on a closed-loop water treatment site");
      await page.locator('#quoteForm button[type="submit"]').click();
      await page.getByRole("heading", { name: "Request received." }).waitFor();
      await page.close();
    } finally {
      await browser.close();
    }

    assert.equal(requests.length, 1);
    assert.ok(hasMultipartField(requests[0], "type", "sample"), "request should post sample type");
    assert.ok(hasMultipartField(requests[0], "product", "VertKleen CR2"), "request should carry product interest");
    assert.ok(hasMultipartField(requests[0], "samples", "VertKleen CR2"), "request should carry the selected sample product");
  });
});

async function expectPoll(fn, { timeout = 2000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("condition did not become true before timeout");
}

test("shared chrome resolves all one-level-deep generated pages", () => {
  assert.match(chrome, /\(\?:industries\|products\|services\|comparisons\|blog\)/);
});
