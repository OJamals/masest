import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("homepage scrollybook exposes an optimized motion contract", () => {
  const index = read("index.html");
  const storyCss = read("css/story.css");
  const storyJs = read("js/story.js");

  assert.match(index, /data-motion-budget="balanced"/);
  assert.match(index, /data-story-mode="showpiece"/);
  assert.match(index, /class="story-pin"/);
  assert.match(index, /class="story-scene"/);
  assert.match(index, /data-story-label="zero"/);
  assert.match(index, /Procurement asks for proof/);
  assert.match(index, /contact\.html\?type=audit(?:&|&amp;)source=scrollybook/);
  assert.match(index, /aria-label="Skip story and request a chemical audit"/);
  assert.doesNotMatch(index, /<section class="act/);

  assert.match(storyCss, /\.story-pin/);
  assert.match(storyCss, /\.story-layer/);
  assert.match(storyCss, /\.story-copy\[data-scene="field"\]/);
  assert.match(storyCss, /\.story-copy\[data-scene="buildup"\]/);
  assert.match(storyCss, /\.story-field,\s*\n\.story-buildup/);
  assert.match(storyCss, /content-visibility:\s*auto/);
  assert.match(storyCss, /contain-intrinsic-size:\s*100vh 160vh/);
  assert.match(storyCss, /prefers-reduced-motion:\s*reduce/);

  assert.match(storyJs, /gsap\.matchMedia\(\)/);
  assert.match(storyJs, /function buildMasterTimeline/);
  assert.match(storyJs, /\.addLabel\("field"/);
  assert.match(storyJs, /\.addLabel\("zero"/);
  assert.match(storyJs, /majorStops = labels\.map/);
  assert.match(storyJs, /dataset\.snapStops/);
  assert.doesNotMatch(storyJs, /behavior:\s*"smooth"/);
  assert.match(storyJs, /quickSetter/);
  assert.match(storyJs, /gsap\.utils\.mapRange/);
  assert.match(storyJs, /data-motion-budget/);
  assert.match(storyJs, /limitCallbacks:\s*true/);
  assert.match(storyJs, /saveStyles/);
});
