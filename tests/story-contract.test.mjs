import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("index.html");
const storyCss = read("css/story.css");
const storyJs = read("js/story.js");
const storyVisualSpec = read("tools/story-hmis-visual.spec.mjs");
const storyPerformanceBudget = read("tools/story-performance-budget.mjs");
const story = home.match(/<div class="story" id="story"[\s\S]*?<\/div>\s*<section class="story-summary/)?.[0] || "";
const guide = home.match(/<section class="replacement-guide"[\s\S]*?<\/section>/)?.[0] || "";
const acts = [...story.matchAll(/<section class="act[^"]*"[^>]*data-act="(\d+)"[^>]*data-scene="([^"]+)"/g)];

test("homepage story uses six named field-result scenes", () => {
  assert.ok(story, "expected homepage story");
  assert.deepEqual(acts.map((match) => [match[1], match[2]]), [
    ["1", "kitchen-grease"],
    ["2", "cip-vessel"],
    ["3", "labelle-fermenter"],
    ["4", "shower-track"],
    ["5", "airboat-panel"],
    ["6", "pool-cartridge"],
  ]);
  assert.equal((story.match(/class="rail-btn"/g) || []).length, 6);
  assert.doesNotMatch(story, /data-act="7"/);
});

test("one persistent comparator carries each true pair and active product", () => {
  assert.equal((story.match(/class="story-object"/g) || []).length, 1);
  assert.match(story, /class="story-object__range" type="range" name="storyComparisonReveal" min="0" max="100" value="50"/);
  assert.match(story, /media\.masest\.co\/site\/img\/proof\/story\/kitchen-grease-before-aligned-202609\.webp/);
  assert.match(story, /media\.masest\.co\/site\/img\/proof\/story\/kitchen-grease-after-aligned-202609\.webp/);
  assert.match(story, /media\.masest\.co\/site\/img\/products\/crhd-food-beverage-studio\.webp/);
  assert.match(story, /Commercial-kitchen grease/);
  assert.match(story, /VertKleen CRHD/);
  assert.doesNotMatch(story, /AI[- ]generated|digitally reconstructed|synthetic (?:image|photo|visual|imagery)/i);
  assert.doesNotMatch(story, /story-object__method/);
  assert.match(story, /story-object__label--before[^>]*>Before</);
  assert.match(story, /story-object__label--after[^>]*>After</);
  assert.equal((story.match(/data-before-src="https:\/\/media\.masest\.co\/site\/img\/proof\/story\//g) || []).length, 6);
  assert.equal((story.match(/data-after-src="https:\/\/media\.masest\.co\/site\/img\/proof\/story\//g) || []).length, 6);
  assert.doesNotMatch(story, /supabase\.co\/storage\/v1\/object/i);
});

test("primary story carries the product thesis while every job stays a secondary proof note", () => {
  const thesis = [
    "Industrial strength. Better chemistry.",
    "Built to outperform traditional cleaners.",
    "Industrial results. HMIS 0-0-0.",
    "Less expensive by the finished job.",
    "The right strength for the soil.",
    "Put both cleaners on the same job.",
  ];

  assert.equal((story.match(/class="story-job-note"/g) || []).length, 6);
  for (let act = 1; act <= 6; act += 1) {
    const scene = story.match(new RegExp(`<section class="act[^"]*"[^>]*data-act="${act}"[\\s\\S]*?<\\/section>`))?.[0] || "";
    assert.ok(scene.includes(thesis[act - 1]), `scene ${act} must carry its primary thesis`);
    assert.ok(scene.indexOf('class="act-p"') < scene.indexOf('class="story-job-note"'));
  }

  assert.match(story, /more soil removed, fewer repeat passes/i);
  assert.match(story, /Every VertKleen product MASEST offers is rated 0-0-0/i);
  assert.match(story, /chemical, labor, water, waste, and downtime/i);
  assert.doesNotMatch(story, /class="proof-stats"|class="story-evidence"|class="story-ctas"/);
});

test("first scene keeps the real aligned kitchen result inside its proof note", () => {
  const actOne = story.match(/<section class="act[^"]*"[^>]*data-act="1"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(actOne, /class="story-job-note"/);
  assert.match(actOne, /Baked-on residue to exposed stainless/i);
  assert.match(actOne, /Follow the lower seam and the grease line/i);
  assert.match(actOne, /href="proof#commercial-kitchen-crhd"/);
  assert.doesNotMatch(actOne, /story-shortcuts|reel-slide/);
});

test("all six scenes identify product, alignment cue, and evidence route", () => {
  const expectations = [
    ["1", "VertKleen CRHD", "lower seam", "proof#commercial-kitchen-crhd"],
    ["2", "VertKleen CR", "Same vessel", "proof#brewery-cip-trials"],
    ["3", "VertKleen CR", "vessel curve and port", "proof#brewery-cip-trials"],
    ["4", "VertKleen Descaler", "glass edge", "products/descaler"],
    ["5", "VertKleen AlumiBrite", "top fasteners", "proof#airboat-alumibrite"],
    ["6", "VertKleen HCR", "cap, bands, and pleat pattern stay registered", "docs/sds/vertkleen-hcr-pool-filter.pdf"],
  ];
  for (const [act, product, cue, href] of expectations) {
    const scene = story.match(new RegExp(`<section class="act[^"]*"[^>]*data-act="${act}"[\\s\\S]*?<\\/section>`))?.[0] || "";
    assert.match(scene, new RegExp(product));
    assert.match(scene, new RegExp(cue, "i"));
    assert.match(scene, new RegExp(`href="${href}"`));
  }

  assert.ok(guide, "expected full comparison guide below the story");
  assert.equal((guide.match(/class="ledger-row"/g) || []).length, 4);
  for (const product of ["hcr", "cr", "purgo", "neutral"]) {
    assert.match(guide, new RegExp(`href="products/${product}"`));
  }
});

test("homepage result copy directs comparison to geometry, not exposure", () => {
  assert.doesNotMatch(
    story,
    /field notes say|job notes say|this field job|on this field job|MASEST matched|previous attempt|one job from diagnosis/i
  );
  assert.match(story, /Read the surface, not the exposure/);
  assert.match(story, /Geometry stays recognizable/);
  assert.match(story, /Follow fixed hardware/);
});

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
