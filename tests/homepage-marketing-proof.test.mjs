import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const storyCss = readFileSync(new URL("../css/story.css", import.meta.url), "utf8");

test("homepage puts real-job proof before product education and catalog browsing", () => {
  const proof = home.indexOf('<section class="proof-section');
  const education = home.indexOf("Different messes need different cleaners.");
  const catalog = home.indexOf("The VertKleen line, by the job it replaces.");

  assert.ok(proof > 0, "expected proof section");
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
  assert.equal((home.match(/Start with the cleaner you want to replace\./g) || []).length, 1);
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
