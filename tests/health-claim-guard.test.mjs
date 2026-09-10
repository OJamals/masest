import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

/* Absolute health claims must be substantiated by the SDS.
 *
 * All twelve VertKleen SDS carry the same GHS classification:
 *   Acute Toxicity-Oral: Category 5      -> "May be harmful if swallowed"
 *   Skin Corrosion/Irritation: Category 3 -> "Causes mild skin irritation"
 *   Eye Damage/Eye Irritation: Category 2B -> "Causes eye irritation"
 *   Signal Word: Warning
 *
 * HMIS 0-0-0 is true and stated in every SDS, and "noncorrosive" and "nonflammable"
 * are supported (Category 3 is an IRRITANT classification, not a corrosive one, and
 * the word "corrosive" appears nowhere in the twelve). Those claims are fine.
 *
 * What is not fine is an ABSOLUTE claim the same documents contradict: "non-toxic"
 * against Category 5, or "safe on skin/eyes" against Category 3 / 2B. Those sit two
 * clicks from the SDS in the site's own resources library.
 *
 * PENDING covers the nine blog sentences that carried "non-toxic" when this guard was
 * written. Post bodies are CMS-authoritative, so they cannot be fixed in this repo --
 * see docs/non-toxic-claim-fix-2026-09-10.md for the paste-ready edits. DELETE each
 * entry as its post is republished. When PENDING is empty the guard is absolute; do
 * not add to it to make a build pass.
 */

const ROOT = new URL("../", import.meta.url);

const SKIP = new Set([
  ".git", ".github", ".wrangler", "artifacts", "audit", "audits", "cloudflare",
  "dist", "docs", "factory", "functions", "node_modules", "prototypes",
  "supabase", "test-results", "tests", "tmp", "tools", "_local",
]);

// Claims the SDS contradict outright.
const UNSUPPORTED = [
  { pattern: /non-?toxic/i, why: 'SDS classify Acute Toxicity-Oral Category 5 ("May be harmful if swallowed")' },
  { pattern: /safe on (?:skin|eyes)/i, why: "SDS classify skin irritation Category 3 and eye irritation Category 2B" },
];

// Blog posts still awaiting their CMS edit. Remove an entry once it is republished.
const PENDING = new Set([
  "blog/construction-equipment-concrete-residue-cleaning.html",
  "blog/data-center-cooling-maintenance-cleaning.html",
  "blog/golf-course-equipment-grounds-hardscape-cleaning.html",
  "blog/hmis-000-explained.html",
  "blog/hotel-property-turnover-facility-cleaning.html",
  "blog/military-government-maintenance-procurement.html",
  "blog/oil-gas-equipment-degreasing-maintenance.html",
  "blog/school-university-facility-cleaning-plan.html",
  "blog/solar-panel-cleaning-low-residue-maintenance.html",
]);

function pages(dir = ROOT.pathname, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pages(full, found);
    else if (entry.endsWith(".html")) found.push(full);
  }
  return found;
}

test("no shipped page makes a health claim the SDS contradict", () => {
  const violations = [];
  for (const file of pages()) {
    const name = relative(ROOT.pathname, file);
    if (PENDING.has(name)) continue;
    const html = readFileSync(file, "utf8");
    for (const { pattern, why } of UNSUPPORTED) {
      const hit = html.match(pattern);
      if (hit) violations.push(`${name}: "${hit[0]}" — ${why}`);
    }
  }
  assert.deepEqual(
    violations.sort(),
    [],
    "Unsupported health claim. HMIS 0-0-0, noncorrosive and nonflammable are all " +
      "documented; an absolute toxicity or skin/eye-safety claim is not.",
  );
});

test("the pending list only holds pages that still carry the claim", () => {
  const stale = [...PENDING].filter((name) => {
    let html;
    try {
      html = readFileSync(new URL(name, ROOT), "utf8");
    } catch {
      return true; // page gone -> entry is stale
    }
    return !UNSUPPORTED.some(({ pattern }) => pattern.test(html));
  });
  assert.deepEqual(stale, [], "Fixed or removed — delete these from PENDING.");
});
