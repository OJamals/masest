import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { renderIndustryPage } from "../tools/build-industry-pages.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const industries = JSON.parse(read("data/industry-applications.json"));
const restrictedDocuments = new Set([
  "docs/trinidad-tank-cleaning-test.pdf",
  "docs/walmart-refrigeration-case-study.pdf",
]);

const industryFiles = readdirSync(new URL("industries/", root))
  .filter((file) => file.endsWith(".html"))
  .sort();

test("P1 registry covers every industry route with task-specific operating context", () => {
  const expectedSlugs = industryFiles.map((file) => file.replace(/\.html$/, "")).sort();
  const actualSlugs = industries.map((industry) => industry.slug).sort();

  assert.equal(industries.length, 32);
  assert.deepEqual(actualSlugs, expectedSlugs);
  assert.equal(new Set(actualSlugs).size, actualSlugs.length);

  const supplemental = industries.filter((industry) => industry.kind === "supplemental");
  assert.equal(supplemental.length, 16);

  for (const industry of industries) {
    for (const field of [
      "label",
      "lead_task",
      "asset",
      "soil",
      "method",
      "concentration",
      "process",
      "boundary",
      "verification",
      "materials",
      "wastewater",
    ]) {
      assert.ok(industry[field]?.trim(), `${industry.slug}: ${field} is required`);
    }
    assert.ok(industry.products?.length, `${industry.slug}: products are required`);
    assert.ok(industry.document_products?.length, `${industry.slug}: document products are required`);
    if (industry.kind === "supplemental") {
      assert.ok(actualSlugs.includes(industry.parent), `${industry.slug}: parent must be a current route`);
      assert.notEqual(industry.parent, industry.slug);
    }
  }
});

test("every industry page renders one task-led applications and proof module", () => {
  for (const file of industryFiles) {
    const slug = file.replace(/\.html$/, "");
    const html = read(`industries/${file}`);

    assert.equal((html.match(/data-industry-hero-facts/g) || []).length, 1, `${slug}: hero facts`);
    assert.equal(
      (html.match(/data-industry-applications-proof/g) || []).length,
      1,
      `${slug}: applications/proof module`,
    );
    assert.equal((html.match(/data-industry-local-cta/g) || []).length, 1, `${slug}: localized CTA`);
    assert.doesNotMatch(html, /Put the current chemical on the table\./);

    for (const label of [
      "Task",
      "Asset / substrate",
      "Soil / deposit",
      "Starting chemistry",
      "Concentration",
      "Process controls",
      "Shutdown / containment",
      "Verification endpoint",
    ]) {
      assert.match(html, new RegExp(`>${label}<`), `${slug}: missing ${label}`);
    }

    assert.match(html, /No field result is presented as proof unless/i, `${slug}: evidence boundary`);
    assert.match(html, /message=/, `${slug}: CTA must prefill the cleaning brief`);
  }
});

test("industry proof links resolve locally and exclude restricted customer records", () => {
  for (const file of industryFiles) {
    const slug = file.replace(/\.html$/, "");
    const html = read(`industries/${file}`);
    const module = html.match(
      /<!-- industry:applications:start -->([\s\S]*?)<!-- industry:applications:end -->/,
    )?.[1] || "";
    const documents = [...module.matchAll(/href="\.\.\/(docs\/[^"]+\.pdf)"/g)]
      .map((match) => match[1]);

    assert.ok(documents.length >= 2, `${slug}: direct controlled-document links required`);
    for (const document of documents) {
      assert.equal(restrictedDocuments.has(document), false, `${slug}: restricted ${document}`);
      assert.ok(existsSync(new URL(document, root)), `${slug}: missing ${document}`);
    }
  }
});

test("localized CTA requests the six inputs needed to scope a cleaning trial", () => {
  const contactHtml = read("contact.html");
  const contactIndustries = new Set(
    [...contactHtml.matchAll(/<option>([^<]+)<\/option>/g)]
      .map((match) => match[1].replaceAll("&amp;", "&")),
  );

  for (const file of industryFiles) {
    const slug = file.replace(/\.html$/, "");
    const html = read(`industries/${file}`);
    const cta = html.match(/<!-- industry:cta:start -->([\s\S]*?)<!-- industry:cta:end -->/)?.[1] || "";
    const href = cta.match(/href="\.\.\/contact\?([^"]+)"/)?.[1];
    assert.ok(href, `${slug}: contact CTA missing`);

    const params = new URLSearchParams(href.replaceAll("&amp;", "&"));
    assert.ok(contactIndustries.has(params.get("industry")), `${slug}: contact industry must preselect`);
    const message = params.get("message") || "";
    for (const prompt of [
      "Asset / substrate:",
      "Soil / deposit:",
      "Operating conditions:",
      "Materials:",
      "Wastewater route:",
      "Buying deadline:",
    ]) {
      assert.match(message, new RegExp(prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${slug}: ${prompt}`);
    }
  }
});

test("industry page generation is idempotent", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const reviewByPath = new Map(review.documents.map((document) => [document.path, document]));

  for (const industry of industries) {
    const html = read(`industries/${industry.slug}.html`);
    assert.equal(
      renderIndustryPage(html, industry, industries, reviewByPath),
      html,
      `${industry.slug}: second render changed output`,
    );
  }
});

test("applications anchor clears the sticky navigation", () => {
  const css = read("css/style.css");
  const offset = css.match(/\.ind-applications\s*\{[^}]*scroll-margin-top:\s*(\d+)px/s)?.[1];
  assert.ok(Number(offset) >= 120, "applications anchor needs room for the sticky navigation");
});
