import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

import { QUOTE_TASK_DETAILS } from "../js/quote-task-details.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const PORT = 4327;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const resources = read("resources.html");
const chrome = read("js/main/chrome.js");
const track = read("js/track.js");
const engagement = read("js/main/engagement.js");
const integrations = read("js/integrations.js");
const newsletter = read("functions/api/newsletter.js");
const klaviyo = read("functions/_lib/klaviyo.js");
const contact = read("contact.html");
const productPage = read("product.html");

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
  const server = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`server exited early: ${server.exitCode}`);
      const response = await fetch(`${BASE_URL}/contact.html`).catch(() => null);
      if (response?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (Date.now() >= deadline) throw new Error("server did not start");
    await fn();
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
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
  assert.match(resources, /data-document-name="VertKleen HCR SDS"/, "download links should carry document names");
  assert.doesNotMatch(resources, /required[^>]*id="docNotifyEmail"/, "revision email must stay optional");
});

test("document downloads are logged with the document name", () => {
  assert.match(chrome, /wireDocumentRoomCapture\(authModule\)/, "shared chrome should wire document capture");
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

test("product detail pages expose a product-specific free sample request CTA", () => {
  assert.match(productPage, /id="pSampleBtn"/, "product hero should include a free sample CTA");
  assert.match(productPage, /contact\?type=sample&product=/, "sample CTA should prefill the contact sample flow");
  assert.match(productPage, /Request free sample/);
});

test("sample picker covers the full parent product catalog", () => {
  for (const label of SAMPLE_PRODUCTS) {
    assert.match(contact, new RegExp(`value="${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `${label} should be sample-requestable`);
  }
});

test("contact form posts all five public request types to quote intake", async () => {
  const flows = [
    { intent: "quote", fill: async () => {} },
    { intent: "audit", fill: async (page) => page.fill("#fSystem", "Cooling tower loop") },
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
    const browser = await chromium.launch({ channel: "chrome" });
    const requests = [];
    try {
      for (const flow of flows) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
        await page.route("**/api/quote", async (route) => {
          requests.push(route.request().postData() || "");
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true }),
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
        await page.getByRole("button", { name: "Send Request" }).click();
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
    const browser = await chromium.launch({ channel: "chrome" });
    const requests = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await page.route("**/api/quote", async (route) => {
        requests.push(route.request().postData() || "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
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
      await page.getByRole("button", { name: "Technical Docs" }).click();
      assert.equal(await page.locator("#quoteTaskDetails").isVisible(), false);
      assert.equal(await page.locator("#fCurrentChemical").isDisabled(), true);
      await page.getByRole("button", { name: "Chemical Audit" }).click();
      assert.equal(await page.locator("#quoteTaskDetails").isVisible(), true);
      assert.equal(await page.inputValue("#fWastewaterRoute"), "Edited permitted route");

      await page.fill("#fName", "Lifecycle Buyer");
      await page.fill("#fCompany", "Lifecycle Facility");
      await page.fill("#fEmail", "lifecycle@example.com");
      await page.fill("#fSystem", "Cooling water loop");
      await page.fill("#fMessage", "Compare one completed cleaning task.");
      await page.getByRole("button", { name: "Send Request" }).click();
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
    const browser = await chromium.launch({ channel: "chrome" });
    const requests = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await page.route("**/api/quote", async (route) => {
        requests.push(route.request().postData() || "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      });
      await page.goto(`${BASE_URL}/contact.html?type=sample&product=VertKleen%20CR2`, { waitUntil: "domcontentloaded" });
      await expectPoll(async () => page.getByLabel("VertKleen CR2", { exact: true }).isChecked());
      await page.fill("#fName", "Sample Buyer");
      await page.fill("#fCompany", "Sample Company");
      await page.fill("#fEmail", "sample-product@example.com");
      await page.fill("#fShipTo", "Sample Facility, 1 Main St, Tampa FL 33602");
      await page.fill("#fMessage", "Testing CR2 on a closed-loop water treatment site");
      await page.getByRole("button", { name: "Send Request" }).click();
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

test("shared chrome resolves one-level-deep comparison pages", () => {
  assert.match(chrome, /\(\?:industries\|products\|comparisons\|blog\)/);
});
