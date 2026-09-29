import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const imageManifest = JSON.parse(read("data/content/site-images.json"));

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
