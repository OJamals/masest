import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const engagement = await readFile(new URL("../js/main/engagement.js", import.meta.url), "utf8");
const contact = await readFile(new URL("../contact.html", import.meta.url), "utf8");

test("project details remain available without becoming mandatory for initial contact", () => {
  for (const id of ["fSystem", "fProgramAssets", "fPilotSize", "fShipTo", "fCompanyType", "fTerritory"]) {
    const tag = contact.match(new RegExp(`<(?:input|select|textarea)[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `${id} present`);
    assert.doesNotMatch(tag[0], /required|data-req/, `${id} remains optional`);
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

test("bounded bundle SKUs become explicit quote-form product options", () => {
  assert.match(engagement, /const BUNDLE_SKU = \/\^VK-BND-/);
  assert.match(engagement, /Bundle SKU: \$\{pre\}/);
  assert.match(engagement, /BUNDLE_SKU\.test\(pre\)/);
});

test("industry select covers every generated industry page", () => {
  for (const sector of [
    "Oil, Gas &amp; Process Plants", "Marine", "Manufacturing", "Food &amp; Beverage", "Healthcare",
    "Construction", "Distribution / Cold Storage", "Military / Government",
    "Education Facilities", "HVAC &amp; Water Systems", "Plumbing",
    "Golf Courses &amp; Sports Facilities", "Hotels, Resorts &amp; Property Management",
    "Solar Farms &amp; Panel Cleaning",
  ]) {
    assert.ok(contact.includes(`<option>${sector}</option>`), `industry option: ${sector}`);
  }
});

test("the quote form's consent block ships with the rules that lay it out", async () => {
  // This exists because the failure it guards was silent in every other check.
  //
  // f346586f ("introduce a type scale") rewrote a region of style.css wholesale and dropped
  // .quote-form-footer, .quote-marketing-option and .quote-form-footnotes. The markup kept
  // shipping. The suite stayed green -- no test asserted a gap, and a source-contract test
  // reads what a rule says, never whether a rule exists. Rebasing then replayed that
  // wholesale rewrite over main's copy of the file without raising a conflict, so the rules
  // main had added were removed a second time, again silently.
  //
  // What the reader actually got: the marketing-consent label sat 4px above the submit
  // button instead of 20px -- a consent control crowded against the button that acts on it.
  //
  // The general rule this encodes: a class that ships in markup must have a rule somewhere.
  // Scoped here to the consent block, which is the part with legal weight.
  const styles = await Promise.all(
    ["style.css", "components.css"].map((f) => readFile(new URL(`../css/${f}`, import.meta.url), "utf8")),
  );
  const css = styles.join("\n");

  const controls = contact.slice(contact.indexOf('<label class="form-note quote-marketing-option"'));
  const block = controls.slice(0, controls.indexOf("</form>"));
  assert.ok(block.includes("quote-form-footer"), "consent disclosure precedes the separated submit footer");

  const classes = [...block.matchAll(/class="([^"]+)"/g)]
    .flatMap(([, list]) => list.split(/\s+/))
    .filter(Boolean);
  assert.ok(classes.length >= 4, "expected the footer to carry several classes");

  for (const cls of new Set(classes)) {
    assert.match(
      css,
      new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s,:{.\\[]`),
      `.${cls} ships in contact.html but has no rule in css/ — the markup is unstyled`,
    );
  }

  // The layout itself, not just the presence of a selector: a grid with real separation
  // between the consent control and the button.
  assert.match(css, /\.quote-form-footer\s*\{[^}]*display:\s*grid/,
    "the footer must lay its children out, or they collapse against each other");
  assert.match(css, /\.quote-form-footer\s*\{[^}]*gap:\s*var\(--s[5-9]\)/,
    "consent control and submit button need a real gap between them");
});
