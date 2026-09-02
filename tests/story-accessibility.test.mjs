import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("index.html");
const storyCss = read("css/story.css");
const storyJs = read("js/story.js");
const story = home.match(/<div class="story" id="story"[\s\S]*?<\/div>\s*<section class="story-summary/)?.[0] || "";
const summary = home.match(/<section class="story-summary"[^>]*id="storySummary"[\s\S]*?<\/section>/)?.[0] || "";
const guide = home.match(/<section class="replacement-guide"[\s\S]*?<\/section>/)?.[0] || "";

test("six comparisons expose coherent headings and region structure", () => {
  assert.match(story, /role="region" aria-label="Six VertKleen before and after field results"/);
  for (let act = 1; act <= 6; act += 1) {
    assert.match(story, new RegExp(`<section class="act[^"]*"[^>]*id="story-scene-${act}"[^>]*data-act="${act}"[^>]*aria-labelledby="storyAct${act}Title"`));
    assert.match(story, new RegExp(`id="storyAct${act}Title"`));
  }
  assert.match(story, /<h1 class="act-h"[^>]*id="storyAct1Title"/);
  assert.equal((story.match(/<h1\b/g) || []).length, 1);
});

test("story has a visible escape, meaningful chapter navigation, and persistent actions", () => {
  assert.match(story, /class="story-skip" href="#storySummary"/);
  assert.doesNotMatch(story, /story-skip[^>]*sr-only/);
  assert.match(story, /<nav class="story-rail" aria-label="Before and after field results">/);
  for (let act = 1; act <= 6; act += 1) {
    assert.match(story, new RegExp(`class="rail-btn" href="#story-scene-${act}"`));
  }
  assert.match(story, /<nav class="story-actions" aria-label="Active VertKleen result actions">/);
  assert.match(story, /class="story-actions__shop" href="products\/crhd"/);
  assert.match(story, /class="story-actions__trial" href="contact\?type=sample&amp;product=VertKleen%20CRHD"/);
});

test("chapter rail avoids animated horizontal rules through labels", () => {
  assert.doesNotMatch(storyCss, /\.rail-btn::before/);
  assert.doesNotMatch(storyCss, /\.rail-btn\[aria-current="step"\]::before/);
});

test("full comparison remains a semantic table and becomes complete stacked cards on mobile", () => {
  assert.match(guide, /<table class="replacement-ledger"/);
  assert.equal((guide.match(/<th scope="col"/g) || []).length, 6);
  assert.equal((guide.match(/<th scope="row"/g) || []).length, 4);
  assert.equal((guide.match(/data-label="Conventional"/g) || []).length, 4);
  assert.equal((guide.match(/data-label="VertKleen"/g) || []).length, 4);
  assert.match(storyCss, /@media \(max-width: 760px\)[\s\S]*\.replacement-ledger tbody[\s\S]*display:\s*grid/s);
  assert.match(storyCss, /\.replacement-ledger td\[data-label\]::before/);
  assert.doesNotMatch(storyCss, /\.replacement-ledger\s*\{[^}]*min-width:\s*7\d\dpx/s);
});

test("visible summary matches the six visual scenes", () => {
  assert.ok(summary, "expected visible story summary");
  assert.equal((summary.match(/<li>/g) || []).length, 6);
  for (const phrase of ["Kitchen grease", "CIP vessel", "Fermenter ring", "Shower track", "Airboat panel", "Pool cartridge"]) {
    assert.match(summary, new RegExp(phrase));
  }
});

test("reduced-motion, missing-library, no-JS, and ordinary mobile expose complete content", () => {
  assert.match(storyJs, /if \(reduce \|\| !window\.gsap \|\| !window\.ScrollTrigger\)/);
  assert.match(storyJs, /if \(compact\)\s*\{[\s\S]*initCompactStory\(\)/);
  assert.match(storyJs, /IntersectionObserver/);
  assert.match(storyCss, /\.story:not\(\.story-ready\) \.act\s*\{[^}]*height:\s*auto/s);
  assert.match(storyCss, /\.story:not\(\.story-ready\) \[data-at\]\s*\{[^}]*opacity:\s*1/s);
  assert.match(storyCss, /\.story-mobile-ready \.act-content/);
  assert.match(storyCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test("actions, field proof, and draggable comparison retain accessible names", () => {
  assert.match(story, /aria-label="Shop VertKleen CRHD"/);
  assert.match(story, /aria-label="Try VertKleen CRHD on my cleaning job"/);
  assert.match(story, /class="story-object__card" role="group" aria-labelledby="storyObjectTitle storyObjectDetail"/);
  assert.match(story, /class="story-object__range"[^>]*aria-labelledby="storyCompareLabel storyObjectTitle"/);
  assert.match(story, /class="story-object__range"[^>]*name="storyComparisonReveal"/);
  assert.match(story, /id="storyCompareLabel">Reveal cleaned result/);
  assert.doesNotMatch(story, /class="story-object" aria-hidden="true"/);
  assert.doesNotMatch(story, /<canvas\b/);
  assert.doesNotMatch(story, /<img(?![^>]*\salt=")[^>]*>/);
});
