import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("index.html");
const storyCss = read("css/story.css");
const storyJs = read("js/story.js");
const storyVisualSpec = read("tools/story-hmis-visual.spec.mjs");
const story = home.match(/<div class="story" id="story"[\s\S]*?<\/div>\s*<section class="story-summary/)?.[0] || "";
const guide = home.match(/<section class="replacement-guide"[\s\S]*?<\/section>/)?.[0] || "";
const acts = [...story.matchAll(/<section class="act[^"]*"[^>]*data-act="(\d)"[^>]*data-scene="([^"]+)"/g)];

test("homepage cleaner guide uses four named steps", () => {
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

test("one persistent equipment object carries condition, product, and result evidence", () => {
  assert.equal((story.match(/class="story-object"/g) || []).length, 1);
  assert.match(story, /img\/blog\/cases\/hcr-brevard-before\.webp/);
  assert.match(story, /img\/blog\/cases\/hcr-brevard-after\.webp/);
  assert.match(story, /img\/updates\/vertkleen-hvac-hcr-5gal\.webp/);
  assert.match(story, /Rust \+ mineral buildup/);
  assert.match(story, /VertKleen HCR/);
});

test("first scene directly diagnoses the cleaning need and exposes two actions", () => {
  const actOne = story.match(/<section class="act[^"]*"[^>]*data-act="1"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(actOne, /Show us the mess\. We(?:&rsquo;|’)ll match the cleaner\./);
  assert.match(actOne, /Cleaning rust and mineral buildup from stainless HVAC equipment\?/);
  assert.match(actOne, /Compare the same surface\./);
  assert.match(actOne, /class="btn btn-primary" href="products\/hcr"[^>]*>Shop HCR<\/a>/);
  assert.match(actOne, /class="btn btn-ghost" href="contact\?type=sample&amp;product=VertKleen%20HCR"[^>]*>Try it on my job<\/a>/);
  assert.doesNotMatch(actOne, /story-shortcuts|reel-slide/);
});

test("second scene directly counts time and repeat work", () => {
  const actTwo = story.match(/<section class="act[^"]*"[^>]*data-act="2"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(actTwo, /36 hours/);
  assert.match(actTwo, /leaves rust behind/i);
  assert.match(actTwo, /repeat work needed to finish/i);
  assert.match(actTwo, /class="burden-chain"/);
  assert.doesNotMatch(actTwo, /pipe-diagram|Scale narrows pipes|Legionella/);
});

test("third scene tells the buyer what to test and defers the full ledger", () => {
  const actThree = story.match(/<section class="act[^"]*"[^>]*data-act="3"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(actThree, /Switch the cleaner\. Finish the job\./);
  assert.match(actThree, /class="switch-card"/);
  assert.match(actThree, /Instead of/);
  assert.match(actThree, />Test</);
  assert.match(actThree, /VertKleen HCR/);
  assert.match(actThree, /0&#8209;0&#8209;0/);
  assert.doesNotMatch(actThree, /replacement-ledger|\$115,000|workplace injury/i);

  assert.ok(guide, "expected full comparison guide below the story");
  assert.equal((guide.match(/class="ledger-row"/g) || []).length, 4);
  for (const product of ["hcr", "cr", "purgo", "neutral"]) {
    assert.match(guide, new RegExp(`href="products/${product}"`));
  }
});

test("fourth scene gives a direct comparison method with sourced proof", () => {
  const actFour = story.match(/<section class="act[^"]*"[^>]*data-act="4"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(actFour, /Compare the whole job\. Then choose\./);
  assert.match(actFour, /30 minutes/);
  assert.match(actFour, /garden hose/i);
  assert.match(actFour, /This test needed no scrubbing/i);
  assert.match(actFour, /href="blog\/hcr-brevard-hvac-rust-case-study"/);
  assert.match(actFour, /href="products\/hcr"/);
  assert.doesNotMatch(actFour, /Industrial muscle|\$115,000/);
});

test("homepage cleaner copy avoids third-person case-note narration", () => {
  assert.doesNotMatch(
    story,
    /field notes say|job notes say|this field job|on this field job|MASEST matched|previous attempt|one job from diagnosis/i
  );
  assert.match(story, /If a cleaner runs for 36 hours and leaves rust behind/);
  assert.match(story, /Compare the result: 30 minutes of HCR contact time/);
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

test("story performance budgets normalize animation cadence against the measured idle baseline", () => {
  assert.match(storyVisualSpec, /frameCoverage:\s*deltas\.length\s*\/\s*\(7000\s*\/\s*idleAverage\)/);
  assert.match(storyVisualSpec, /p95BaselineMultiple:\s*p95\s*\/\s*idleP95/);
  assert.match(storyVisualSpec, /p99BaselineMultiple:\s*p99\s*\/\s*idleP95/);
  assert.match(storyVisualSpec, /metrics\.frameCoverage[\s\S]*toBeGreaterThanOrEqual\(2\s*\/\s*3\)/);
  assert.match(storyVisualSpec, /metrics\.p95BaselineMultiple[\s\S]*toBeLessThanOrEqual\(2\.05\)/);
  assert.match(storyVisualSpec, /metrics\.p99BaselineMultiple[\s\S]*toBeLessThanOrEqual\(3\.05\)/);
  assert.doesNotMatch(storyVisualSpec, /over50/);
  assert.doesNotMatch(storyVisualSpec, /expect\(metrics\.p9[59][\s\S]*toBeLessThan\((?:25|35)\)/);
});

test("story long-task budget measures only the controlled-scroll interval", () => {
  const idleBaselineEnd = storyVisualSpec.indexOf("requestAnimationFrame(idleFrame);\n    });");
  const longTaskObserverStart = storyVisualSpec.indexOf('observer.observe({ type: "longtask" });');
  const controlledScrollStart = storyVisualSpec.indexOf("function frame(now)");

  assert.ok(idleBaselineEnd >= 0, "expected idle baseline before controlled scroll");
  assert.ok(
    longTaskObserverStart > idleBaselineEnd && longTaskObserverStart < controlledScrollStart,
    "long-task observer must start after idle baseline and before controlled scroll",
  );
  assert.doesNotMatch(storyVisualSpec, /buffered:\s*true/);
});
