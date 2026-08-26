import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("index.html");
const storyCss = read("css/story.css");
const storyJs = read("js/story.js");
const story = home.match(/<div class="story" id="story"[\s\S]*?<\/div>\s*<section class="story-summary/)?.[0] || "";
const guide = home.match(/<section class="replacement-guide"[\s\S]*?<\/section>/)?.[0] || "";
const acts = [...story.matchAll(/<section class="act[^"]*"[^>]*data-act="(\d)"[^>]*data-scene="([^"]+)"/g)];

test("homepage story is one job told through four named transformations", () => {
  assert.ok(story, "expected homepage story");
  assert.deepEqual(acts.map((match) => [match[1], match[2]]), [
    ["1", "diagnose"],
    ["2", "burden"],
    ["3", "switch"],
    ["4", "prove"],
  ]);
  assert.equal((story.match(/class="rail-btn"/g) || []).length, 4);
  assert.doesNotMatch(story, /data-act="5"/);
});

test("one persistent equipment object carries real job, product, and result evidence", () => {
  assert.equal((story.match(/class="story-object"/g) || []).length, 1);
  assert.match(story, /img\/blog\/cases\/hcr-brevard-before\.webp/);
  assert.match(story, /img\/blog\/cases\/hcr-brevard-after\.webp/);
  assert.match(story, /img\/updates\/vertkleen-hvac-hcr-5gal\.webp/);
  assert.match(story, /Brevard County HVAC/);
  assert.match(story, /VertKleen HCR/);
});

test("first scene diagnoses one job with one product action and one trial action", () => {
  const actOne = story.match(/<section class="act[^"]*"[^>]*data-act="1"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(actOne, /Show us the mess\. We(?:&rsquo;|’)ll match the cleaner\./);
  assert.match(actOne, /class="btn btn-primary" href="products\/hcr"[^>]*>Shop HCR<\/a>/);
  assert.match(actOne, /class="btn btn-ghost" href="contact\?type=sample&amp;product=VertKleen%20HCR"[^>]*>Try it on my job<\/a>/);
  assert.doesNotMatch(actOne, /story-shortcuts|reel-slide/);
});

test("second scene proves burden on the same field job without changing visual grammar", () => {
  const actTwo = story.match(/<section class="act[^"]*"[^>]*data-act="2"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(actTwo, /36 hours/);
  assert.match(actTwo, /result was still incomplete/i);
  assert.match(actTwo, /class="burden-chain"/);
  assert.doesNotMatch(actTwo, /pipe-diagram|Scale narrows pipes|Legionella/);
});

test("third scene makes one matched switch and moves the full ledger below the story", () => {
  const actThree = story.match(/<section class="act[^"]*"[^>]*data-act="3"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(actThree, /Switch the cleaner\. Finish the job\./);
  assert.match(actThree, /class="switch-card"/);
  assert.match(actThree, /Previous attempt/);
  assert.match(actThree, /Matched cleaner/);
  assert.match(actThree, /VertKleen HCR/);
  assert.match(actThree, /0&#8209;0&#8209;0/);
  assert.doesNotMatch(actThree, /replacement-ledger|\$115,000|workplace injury/i);

  assert.ok(guide, "expected full comparison guide below the story");
  assert.equal((guide.match(/class="ledger-row"/g) || []).length, 4);
  for (const product of ["hcr", "cr", "purgo", "neutral"]) {
    assert.match(guide, new RegExp(`href="products/${product}"`));
  }
});

test("fourth scene resolves the exact field job with sourced proof and specific action", () => {
  const actFour = story.match(/<section class="act[^"]*"[^>]*data-act="4"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(actFour, /Count the whole job\. Then make the switch\./);
  assert.match(actFour, /30 minutes/);
  assert.match(actFour, /garden-hose rinse/i);
  assert.match(actFour, /job notes say no scrubbing/i);
  assert.match(actFour, /href="blog\/hcr-brevard-hvac-rust-case-study"/);
  assert.match(actFour, /href="products\/hcr"/);
  assert.doesNotMatch(actFour, /Industrial muscle|\$115,000/);
});

test("story uses compact native-scroll roads and scene renderer contracts", () => {
  assert.doesNotMatch(storyJs, /new\s+Lenis|addEventListener\(["']wheel|preventDefault\(\).*wheel|scrollMultiplier/);

  const heights = [...storyCss.matchAll(/\.story \.act\[data-act="\d"\]\s*\{[^}]*height:\s*(\d+)vh/gs)]
    .map((match) => Number(match[1]));
  assert.equal(heights.length, 4);
  assert.ok(heights.every((height) => height >= 100), heights);
  assert.ok(heights.reduce((sum, height) => sum + height, 0) >= 420, heights);
  assert.ok(heights.reduce((sum, height) => sum + height, 0) <= 480, heights);

  assert.match(storyJs, /var SCENE_DEFS = \[/);
  for (const id of ["diagnose", "burden", "switch", "prove"]) {
    assert.match(storyJs, new RegExp(`id: "${id}"`));
  }
  assert.match(storyJs, /sceneDef\.render\(st\.p, st\)/);
  assert.match(storyJs, /initCompactStory\(\)/);
  assert.match(storyJs, /rect\.bottom\s*>=\s*window\.innerHeight/);
});
