import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { find, textOf as nodeText } from "../tools/html-query.mjs";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const industries = JSON.parse(read("data/industry-applications.json")).industries;
const pages = readdirSync(new URL("industries/", root)).filter((file) => file.endsWith(".html"));

// Registry field -> the buyer-facing label it ships under.
const ROWS = [
  ["concentration", "Dilution"],
  ["process", "What to log"],
  ["boundary", "Site controls"],
  ["verification", "Finished-result check"],
  ["materials", "Surfaces"],
  ["wastewater", "Wash water"],
];

// parse5 decodes entities and drops <script> content for us; hand-rolled tag stripping
// left &#39; and &amp; in the text and compared them against raw registry copy.
const textOf = (html) => nodeText(find(html, { tag: "body" }) || find(html, { tag: "dl" }) || null)
  || nodeText(find(`<div>${html}</div>`, { tag: "div" }));

test("every industry page ships the operating standard its registry entry carries", () => {
  // These six fields were authored per industry and reached no page at all: the
  // applications grid answers what the job is, and this answers how it is run, which is
  // what a facilities engineer reads before trialling a cleaner and what an answer engine
  // has to quote from.
  assert.equal(pages.length, industries.length);
  for (const industry of industries) {
    const html = read(`industries/${industry.slug}.html`);
    assert.equal(
      (html.match(/data-industry-operating-standard/g) || []).length,
      1,
      `${industry.slug}: exactly one operating standard section`,
    );
    const text = textOf(html);
    for (const [field, label] of ROWS) {
      const value = String(industry[field] || "").trim();
      assert.ok(value, `${industry.slug}: ${field} stays in the registry`);
      assert.ok(text.includes(label), `${industry.slug}: renders the "${label}" row`);
      assert.ok(
        text.includes(textOf(value)),
        `${industry.slug}: "${label}" must render the registry's ${field} verbatim`,
      );
    }
  }
});

test("the operating standard is distinct per industry, not shared template prose", () => {
  for (const [field] of ROWS) {
    const values = new Set(industries.map((industry) => industry[field]));
    assert.equal(
      values.size,
      industries.length,
      `${field}: every industry must carry its own value, not a shared sentence`,
    );
  }
});

test("industry copy keeps the trade's own job titles", () => {
  // A find/replace across the registry turned "operator" into "crew member", which left
  // aviation citing a "crew member's maintenance manual" and food & beverage scheduling
  // discharge with a "wastewater crew member". Both are roles with specific meanings to
  // the buyer this section is written for, and both now ship on a page.
  const aviation = industries.find((industry) => industry.slug === "aviation-fbos-mro-airports");
  const foodBeverage = industries.find((industry) => industry.slug === "food-beverage");
  assert.match(aviation.boundary, /operator's maintenance manual/);
  assert.match(foodBeverage.wastewater, /wastewater operator/);
  for (const [field] of ROWS) {
    for (const industry of industries) {
      assert.doesNotMatch(
        industry[field],
        /(?:wastewater|maintenance|plant's|facility's) crew member/i,
        `${industry.slug}: ${field} names a role that does not exist`,
      );
    }
  }
});
