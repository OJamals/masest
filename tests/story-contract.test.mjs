import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const storyCss = read("css/story.css");
const storyJs = read("js/story.js");
const storyVisualSpec = read("tools/story-hmis-visual.spec.mjs");
const storyPerformanceBudget = read("tools/story-performance-budget.mjs");

// Legacy engine contracts remain until its consumers and tooling are retired.
test("story reveal uses a scroll-driven and draggable wipe, not a contrast crossfade", () => {
  assert.match(storyCss, /--story-reveal:\s*8%/);
  assert.match(storyCss, /clip-path:\s*inset\(0 0 0 calc\(100% - var\(--story-reveal\)\)\)/);
  assert.match(storyCss, /\.story-object__divider\s*\{[^}]*left:\s*var\(--story-reveal\)/s);
  assert.match(storyCss, /rotate\(var\(--story-after-rotate\)\)/);
  assert.match(storyJs, /return 8 \+ clamp\(progress, 0, 1\) \* 84/);
  assert.match(storyJs, /comparisonRange\.addEventListener\("input"/);
  assert.match(storyJs, /manualReveal/);
});

test("story uses compact native-scroll roads and scene renderer contracts", () => {
  assert.doesNotMatch(storyJs, /new\s+Lenis|addEventListener\(["']wheel|preventDefault\(\).*wheel|scrollMultiplier/);

  const heights = [...storyCss.matchAll(/\.story \.act\[data-act="\d"\]\s*\{[^}]*height:\s*(\d+)vh/gs)]
    .map((match) => Number(match[1]));
  assert.equal(heights.length, 6);
  assert.ok(heights.every((height) => height >= 80 && height <= 88), heights);
  assert.ok(heights.reduce((sum, height) => sum + height, 0) >= 480, heights);
  assert.ok(heights.reduce((sum, height) => sum + height, 0) <= 520, heights);
  assert.match(storyCss, /\.story \.stage\s*\{[^}]*position:\s*relative[^}]*height:\s*100%/s);
  assert.match(storyJs, /start:\s*"top center"/);
  assert.match(storyJs, /end:\s*"bottom center"/);

  assert.match(storyJs, /var states = acts\.map/);
  assert.match(storyJs, /config: sceneConfig\(act\)/);
  assert.match(storyJs, /activateSceneMedia\(st\)/);
  assert.match(storyJs, /preloadNextScene\(st\)/);
  assert.match(storyJs, /renderScene\(st\)/);
  assert.match(storyJs, /initCompactStory\(\)/);
  assert.match(storyJs, /rect\.bottom\s*>=\s*window\.innerHeight/);
});

test("story performance budgets normalize each sample and tolerate only one cadence outlier", () => {
  assert.match(storyVisualSpec, /frameCoverage:\s*deltas\.length\s*\/\s*\(sweepDuration\s*\/\s*idleAverage\)/);
  assert.match(storyVisualSpec, /p95BaselineMultiple:\s*p95\s*\/\s*idleP95/);
  assert.match(storyVisualSpec, /p99BaselineMultiple:\s*p99\s*\/\s*idleP95/);
  assert.match(storyVisualSpec, /STORY_PERFORMANCE_SAMPLE_COUNT/);
  assert.match(storyVisualSpec, /evaluateStoryPerformanceSamples\(samples\)/);
  assert.match(storyVisualSpec, /evaluation\.pass/);
  assert.match(storyPerformanceBudget, /frameCoverage:\s*2\s*\/\s*3/);
  assert.match(storyPerformanceBudget, /p95BaselineMultiple:\s*2\.05/);
  assert.match(storyPerformanceBudget, /p99BaselineMultiple:\s*3\.05/);
  assert.match(storyPerformanceBudget, /longTasks:\s*1/);
  assert.match(storyPerformanceBudget, /Math\.floor\(samples\.length\s*\/\s*2\)\s*\+\s*1/);
  assert.doesNotMatch(storyVisualSpec, /over50/);
  assert.doesNotMatch(storyVisualSpec, /expect\(metrics\.p9[59][\s\S]*toBeLessThan\((?:25|35)\)/);
});

test("story long-task budget measures only the controlled-scroll interval", () => {
  const idleBaselineEnd = storyVisualSpec.indexOf("const idleDeltas = await collectFrameDeltas(idleDuration);");
  const longTaskObserverStart = storyVisualSpec.indexOf('observer.observe({ type: "longtask" });');
  const controlledScrollStart = storyVisualSpec.indexOf("function frame(now)");

  assert.ok(idleBaselineEnd >= 0, "expected idle baseline before controlled scroll");
  assert.ok(
    longTaskObserverStart > idleBaselineEnd && longTaskObserverStart < controlledScrollStart,
    "long-task observer must start after idle baseline and before controlled scroll",
  );
  assert.doesNotMatch(storyVisualSpec, /buffered:\s*true/);
});
