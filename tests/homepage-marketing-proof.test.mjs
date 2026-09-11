import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync(new URL("../index.html", import.meta.url), "utf8");
// The trust strip, replacement guide and HMIS ledger moved here when css/story.css
// went with the homepage scrollybook; they were never story state.
const storyCss = readFileSync(new URL("../css/components.css", import.meta.url), "utf8");

test("homepage puts real-job proof before product education and catalog browsing", () => {
  const proof = home.indexOf('<section class="proof-section');
  const education = home.indexOf("Find the cleaner that replaces yours.");
  const catalog = home.indexOf("The VertKleen line, by the job it replaces.");

  assert.ok(proof > 0, "expected proof section");
  assert.ok(education > 0, "expected the cleaner-matching block");
  assert.ok(proof < education, "real-job proof should precede product education");
  assert.ok(proof < catalog, "real-job proof should precede catalog browsing");
});

test("homepage grounds specific performance claims in a direct evidence path", () => {
  assert.match(
    home,
    /up to 280&times; less corrosion[\s\S]{0,240}href="blog\/descaling-without-acid"[^>]*>Read the corrosion test summary<\/a>/,
  );
});

test("homepage retains owner-confirmed global reach in the trust strip", () => {
  const trustStrip = home.match(/<div class="trust-strip">[\s\S]*?<\/div>\s*<\/div>/)?.[0];

  assert.ok(trustStrip, "expected trust strip");
  assert.match(trustStrip, /href="about"[^>]*>Used in 50\+ countries<\/a>/);
  assert.match(trustStrip, /domestic \+ international support/);
});

test("homepage does not repeat the story's matching and trial process below the fold", () => {
  assert.doesNotMatch(home, /Protect equipment without punishing the crew\./);
  assert.doesNotMatch(home, /A simple path to a better cleaner\./);
  assert.equal((home.match(/Find the cleaner that replaces yours\./g) || []).length, 1);
});

/* SQ-09: the homepage used to argue "pick the product that matches your soil"
   in two consecutive blocks before the catalog — one sorted by soil type, one
   by the incumbent chemical — then restate it in the catalog subhead. They are
   now a single block. This pins the merge: one matching block, carrying all
   three replacement routes, so the pair cannot quietly grow back. */
test("homepage states the cleaner-matching argument once, covering all three routes", () => {
  assert.doesNotMatch(home, /Different messes need different cleaners\./);
  assert.doesNotMatch(home, /Start with the cleaner you want to replace\./);

  const matcher = home.match(/<h2 class="headline">Find the cleaner that replaces yours\.<\/h2>[\s\S]*?<\/section>/)?.[0];
  assert.ok(matcher, "expected a single cleaner-matching section");
  assert.equal((matcher.match(/class="why-col reveal"/g) || []).length, 3);
  for (const route of ['href="products#cat-descale"', 'href="products#cat-degrease"', 'href="programs"']) {
    assert.ok(matcher.includes(route), `matching block should keep the ${route} route`);
  }
});

test("homepage trust strip balances its four proof points", () => {
  assert.equal((home.match(/<div class="trust-strip">[\s\S]*?<\/div>\s*<\/div>/g) || []).length, 1);
  assert.match(
    storyCss,
    /\.trust-strip \.trust-cols\s*{\s*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    storyCss,
    /@media \(max-width:\s*720px\)[\s\S]*?\.trust-strip \.trust-cols\s*{\s*grid-template-columns:\s*1fr 1fr/,
  );
});
