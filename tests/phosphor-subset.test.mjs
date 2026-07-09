// Guard for the subset Phosphor icon font (vendor/phosphor/Phosphor.woff2 is a
// ~17kb subset of the full 147kb font — see tools/subset-phosphor.mjs). If a new
// `ph-<icon>` is added anywhere without re-running the subset tool, the icon
// ships BLANK. This test fails first: every used icon must be in the manifest
// (and therefore in the served font).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveUsed } from "../tools/subset-phosphor.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}/vendor/phosphor/subset-icons.json`, "utf8"));

test("every used Phosphor icon is covered by the subset manifest", () => {
  const inManifest = new Set(manifest.icons.map((i) => i.name));
  const used = resolveUsed(root).map((u) => u.name);
  const missing = used.filter((n) => !inManifest.has(n));
  assert.deepEqual(
    missing,
    [],
    `These icons are used but NOT in the subset font — run \`node tools/subset-phosphor.mjs\` and commit vendor/phosphor/Phosphor.woff2 + subset-icons.json:\n  ${missing.join("\n  ")}`,
  );
});

test("subset manifest matches the served font (regenerate if this fails)", () => {
  // The manifest is the source of truth the font was built from; keep them in
  // lockstep so the guard above actually reflects what ships.
  const used = new Set(resolveUsed(root).map((u) => u.name));
  const manifestNames = manifest.icons.map((i) => i.name);
  const stale = manifestNames.filter((n) => !used.has(n));
  assert.deepEqual(stale, [], `Manifest lists icons no longer used — re-run tools/subset-phosphor.mjs: ${stale.join(", ")}`);
  assert.equal(manifest.count, manifestNames.length, "manifest count out of sync");
});

test("served Phosphor woff2 is the subset, not the full font", () => {
  const kb = statSync(`${root}/vendor/phosphor/Phosphor.woff2`).size / 1024;
  assert.ok(kb < 60, `served Phosphor.woff2 is ${kb.toFixed(0)}kb — expected the <60kb subset, not the full font`);
});
