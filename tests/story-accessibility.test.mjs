import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("index.html");
const storyCss = read("css/story.css");
const storyJs = read("js/story.js");
const story = home.match(/<div class="story" id="story"[\s\S]*?<\/div>\s*<section class="story-summary/)?.[0] || "";
const summary = home.match(/<section class="story-summary sr-only"[\s\S]*?<\/section>/)?.[0] || "";

test("four visual acts expose a coherent heading and region structure", () => {
  assert.match(story, /role="region" aria-label="The story of conventional chemicals versus VertKleen"/);
  for (let act = 1; act <= 4; act += 1) {
    assert.match(story, new RegExp(`<section class="act[^"]*"[^>]*data-act="${act}"[^>]*aria-labelledby="storyAct${act}Title"`));
    assert.match(story, new RegExp(`id="storyAct${act}Title"`));
  }
  assert.match(story, /<h1 class="act-h"[^>]*id="storyAct1Title"/);
  assert.equal((story.match(/<h1\b/g) || []).length, 1);
});

test("replacement ledger has table semantics and keyboard-scrollable mobile overflow", () => {
  assert.match(story, /class="replacement-ledger-scroll" tabindex="0" role="region"/);
  assert.match(story, /<table class="replacement-ledger"/);
  assert.equal((story.match(/<th scope="col"/g) || []).length, 6);
  assert.equal((story.match(/<th scope="row"/g) || []).length, 4);
  assert.match(storyCss, /\.replacement-ledger-scroll:focus-visible/);
  assert.match(storyCss, /overflow-x:\s*auto/);
});

test("static summary matches four visual acts", () => {
  assert.ok(summary, "expected accessible story summary");
  assert.equal((summary.match(/<li>/g) || []).length, 4);
  for (const phrase of [
    "The field problem",
    "Buildup becomes operating cost",
    "The Replacement Ledger",
    "One documented trial brief",
  ]) {
    assert.match(summary, new RegExp(phrase));
  }
});

test("reduced-motion, missing-library, no-JS, and mobile modes expose complete content", () => {
  assert.match(storyJs, /reduce \|\| compact \|\| !window\.gsap \|\| !window\.ScrollTrigger/);
  assert.match(storyJs, /classList\.remove\("story-ready"\)/);
  assert.match(storyCss, /\.story:not\(\.story-ready\) \.act\s*\{\s*height:\s*auto/);
  assert.match(storyCss, /\.story:not\(\.story-ready\) \[data-at\]\s*\{[^}]*opacity:\s*1/s);
  assert.match(storyCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(storyCss, /@media \(max-width: 760px\)[\s\S]*\.story \.act-p,[\s\S]*display:\s*none !important/);
});

test("story actions, proof, and visual media retain accessible names", () => {
  assert.match(story, /aria-label="Find your VertKleen replacement"/);
  assert.match(story, /aria-label="Request a VertKleen trial"/);
  assert.equal((story.match(/<canvas class="fx-canvas" aria-hidden="true">/g) || []).length, 2);
  assert.match(story, /<svg class="pipe-diagram"[^>]*role="img" aria-label="[^"]+"/);
  assert.doesNotMatch(story, /<img(?![^>]*\salt=")[^>]*>/);
});
