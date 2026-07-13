// Guard for the subset Phosphor icon font (vendor/phosphor/Phosphor.woff2 is a
// ~17kb subset of the full 147kb font — see tools/subset-phosphor.mjs). If a new
// `ph-<icon>` is added anywhere without re-running the subset tool, the icon
// ships BLANK. This test fails first: every used icon must be in the manifest
// (and therefore in the served font).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectUsedIcons, resolveUsed, bufferIcons } from "../tools/subset-phosphor.mjs";

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

test("subset manifest holds only used or buffered icons (regenerate if this fails)", () => {
  // Manifest = used icons ∪ the curated CMS buffer (icon-buffer.txt). Anything
  // else means the manifest drifted from the tool — re-run it.
  const allowed = new Set([...resolveUsed(root).map((u) => u.name), ...bufferIcons(root)]);
  const manifestNames = manifest.icons.map((i) => i.name);
  const stray = manifestNames.filter((n) => !allowed.has(n));
  assert.deepEqual(stray, [], `Manifest lists icons that are neither used nor buffered — re-run tools/subset-phosphor.mjs: ${stray.join(", ")}`);
  assert.equal(manifest.count, manifestNames.length, "manifest count out of sync");
});

test("icon discovery ignores generated builds and backups", () => {
  const fixture = mkdtempSync(join(tmpdir(), "phosphor-scan-"));
  try {
    mkdirSync(join(fixture, "dist"));
    mkdirSync(join(fixture, "backups"));
    writeFileSync(join(fixture, "source.html"), `<i class="${"ph-" + "check"}"></i>`);
    writeFileSync(join(fixture, "dist", "stale.html"), `<i class="${"ph-" + "flame"}"></i>`);
    writeFileSync(join(fixture, "backups", "stale.html"), `<i class="${"ph-" + "heartbeat"}"></i>`);
    assert.deepEqual([...collectUsedIcons(fixture)], ["check"]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("served Phosphor woff2 is the subset, not the full font", () => {
  const kb = statSync(`${root}/vendor/phosphor/Phosphor.woff2`).size / 1024;
  assert.ok(kb < 60, `served Phosphor.woff2 is ${kb.toFixed(0)}kb — expected the <60kb subset, not the full font`);
});

test("admin refreshes the Phosphor CSS and subset font after icon changes", () => {
  const admin = readFileSync(`${root}/admin.html`, "utf8");
  const css = readFileSync(`${root}/vendor/phosphor/style.css`, "utf8");
  assert.match(admin, /vendor\/phosphor\/style\.css\?v=\d{8}[a-z]/, "admin should cache-bust the Phosphor stylesheet");
  assert.match(css, /Phosphor\.woff2\?v=\d{8}[a-z]/, "Phosphor stylesheet should cache-bust the subset font");
});
