import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("index.html");
const storyJs = read("js/story.js");
const storyCss = read("css/story.css");
const imageManifest = JSON.parse(read("data/content/site-images.json"));
const story = home.match(/<div class="story" id="story"[\s\S]*?<\/div>\s*<section class="story-summary/)?.[0] || "";
const sceneTags = [...story.matchAll(/<section class="act"[^>]*data-act="(\d+)"[^>]*data-scene="([^"]+)"[^>]*>/g)];

const expectedScenes = [
  ["1", "kitchen-grease"],
  ["2", "cip-vessel"],
  ["3", "labelle-fermenter"],
  ["4", "shower-track"],
  ["5", "airboat-panel"],
  ["6", "pool-cartridge"],
];

const expectedAssets = expectedScenes.flatMap(([, scene]) => [
  `/img/proof/story/${scene}-before-aligned-202609.webp`,
  `/img/proof/story/${scene}-after-aligned-202609.webp`,
]);

const alignedWidth = 1200;
const alignedHeight = 1017;

test("homepage story contains six R2-backed true before-after scenes", () => {
  assert.deepEqual(sceneTags.map((match) => [match[1], match[2]]), expectedScenes);
  assert.equal((story.match(/class="rail-btn"/g) || []).length, 6);
  assert.doesNotMatch(story, /supabase\.co\/storage\/v1\/object/i);

  for (const [act, scene] of expectedScenes) {
    const section = sceneTags.find((match) => match[1] === act)?.[0] || "";
    const before = `https://media.masest.co/site/img/proof/story/${scene}-before-aligned-202609.webp`;
    const after = `https://media.masest.co/site/img/proof/story/${scene}-after-aligned-202609.webp`;
    assert.match(section, new RegExp(`data-before-src="${before.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(section, new RegExp(`data-after-src="${after.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(section, new RegExp(`data-before-width="${alignedWidth}"`));
    assert.match(section, new RegExp(`data-before-height="${alignedHeight}"`));
    assert.match(section, new RegExp(`data-after-width="${alignedWidth}"`));
    assert.match(section, new RegExp(`data-after-height="${alignedHeight}"`));
    assert.match(section, /data-product-src="https:\/\/media\.masest\.co\/site\/img\/products\//);
  }
});

test("story comparison is scroll-driven and can be overridden with an accessible range", () => {
  const range = story.match(/<input[^>]*class="story-object__range"[^>]*>/)?.[0] || "";
  assert.match(range, /type="range"/);
  assert.match(range, /min="0"/);
  assert.match(range, /max="100"/);
  assert.match(range, /value="50"/);
  assert.match(range, /aria-labelledby="[^"]+"/);

  assert.match(storyJs, /comparisonRange\.addEventListener\("input"/);
  assert.match(storyJs, /manualReveal/);
  assert.match(storyJs, /style\.setProperty\("--story-reveal"/);
  assert.match(storyJs, /activateSceneMedia/);
  assert.match(storyCss, /clip-path:\s*inset\(0 0 0 calc\(100% - var\(--story-reveal\)\)\)/);
  assert.match(storyCss, /left:\s*var\(--story-reveal\)/);
});

test("all comparison frames use one locked camera with no runtime correction", () => {
  for (const match of sceneTags) {
    assert.match(match[0], /data-before-position="50% 50%"/);
    assert.match(match[0], /data-after-position="50% 50%"/);
    assert.match(match[0], /data-before-scale="1"/);
    assert.match(match[0], /data-after-scale="1"/);
    assert.match(match[0], /data-after-rotate="0"/);
  }
  assert.match(storyCss, /rotate\(var\(--story-after-rotate\)\)/);
});

test("all twelve story frames stay in the site-image ledger for R2 byte verification", () => {
  const assets = new Map(imageManifest.assets.map((asset) => [asset.storage_path, asset]));
  for (const path of expectedAssets) {
    const asset = assets.get(path);
    assert.ok(asset, `${path} registered`);
    assert.equal(asset.public_url, path);
    assert.equal(asset.mime_type, "image/webp");
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.ok(asset.byte_size > 0);
    assert.equal(asset.width, alignedWidth);
    assert.equal(asset.height, alignedHeight);
    assert.equal(existsSync(new URL(`..${path}`, import.meta.url)), true, `${path} source exists`);
  }
});
