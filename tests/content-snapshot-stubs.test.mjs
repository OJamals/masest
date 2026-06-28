// Regression guard: every content type in the registry must ship a committed
// static snapshot stub, a manifest entry, and a verify_site structural check.
// Caught the missing data/content/page-sections.json stub (2026-06-28) that
// 404'd on every public page after the page_section type shipped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { snapshotGroups } from "../js/content-types.js";

const dir = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(dir(rel), "utf8"));

const groups = snapshotGroups();

test("every registry snapshot file has a committed stub with its array keys", () => {
  for (const group of groups) {
    const parsed = readJson(`data/content/${group.file}`);
    for (const { key } of group.types) {
      assert.ok(
        Array.isArray(parsed[key]),
        `data/content/${group.file} must expose a "${key}" array (registry snapshot stub)`,
      );
    }
  }
});

test("static export manifest lists every registry snapshot file", () => {
  const manifest = readJson("data/content/manifest.json");
  assert.ok(manifest.files && typeof manifest.files === "object", "manifest.json needs a files map");
  for (const group of groups) {
    assert.ok(
      manifest.files[group.file],
      `manifest.json must list ${group.file} so the admin export panel and rebuild stay consistent`,
    );
  }
});

test("verify_site structural checks cover every registry snapshot file", () => {
  const source = readFileSync(dir("tools/verify_site.mjs"), "utf8");
  for (const group of groups) {
    assert.ok(
      source.includes(`data/content/${group.file}`),
      `tools/verify_site.mjs must validate data/content/${group.file} (gate blind spot guard)`,
    );
  }
});
