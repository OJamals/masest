#!/usr/bin/env node
/* Rebuild the served Phosphor icon subset from the full font.
 *
 * The site uses ~150 of Phosphor's ~1530 glyphs. We ship a subset
 * (vendor/phosphor/Phosphor.woff2, ~17kb) instead of the full 147kb font
 * (vendor/phosphor/Phosphor.full.woff2, an inert build source).
 *
 * Run this whenever you add/remove a `ph-<icon>` anywhere in the site:
 *     node tools/subset-phosphor.mjs
 * It rescans the sources, rewrites vendor/phosphor/subset-icons.json (the
 * manifest the guard test checks), and regenerates the served woff2 with
 * pyftsubset (fonttools). Requires: pip install fonttools brotli.
 *
 * tests/phosphor-subset.test.mjs asserts every used icon is in the manifest,
 * so a forgotten re-subset fails CI instead of shipping a blank icon.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FULL = "vendor/phosphor/Phosphor.full.woff2";
const OUT = "vendor/phosphor/Phosphor.woff2";
const MANIFEST = "vendor/phosphor/subset-icons.json";
const IGNORE = /(^|\/)(node_modules|\.git|vendor|_local|\.claude|\.backup_site)(\/|$)/;
const SCAN_EXT = /\.(html|js|mjs|json)$/;

/** Every `ph-<name>` token in the site's source (excluding build/backup dirs). */
export function collectUsedIcons(root = ROOT) {
  const found = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = `${dir}/${name}`;
      const rel = full.slice(root.length);
      if (IGNORE.test(rel)) continue;
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (SCAN_EXT.test(name)) {
        const txt = readFileSync(full, "utf8");
        for (const m of txt.matchAll(/\bph-([a-z0-9]+(?:-[a-z0-9]+)*)\b/g)) found.add(m[1]);
      }
    }
  };
  walk(root);
  return found;
}

/** map of Phosphor icon name -> hex codepoint, parsed from the vendor CSS. */
export function iconCodepoints(root = ROOT) {
  const css = readFileSync(`${root}/vendor/phosphor/style.css`, "utf8");
  const map = new Map();
  for (const m of css.matchAll(/\.ph-([a-z0-9-]+):+before\s*\{\s*content:\s*"\\([0-9a-fA-F]+)"/g)) {
    map.set(m[1], m[2].toUpperCase());
  }
  return map;
}

/** curated buffer (vendor/phosphor/icon-buffer.txt) — extra icons CMS free-text
 *  fields may reference, so an admin's pick doesn't render blank. */
export function bufferIcons(root = ROOT) {
  const path = `${root}/vendor/phosphor/icon-buffer.txt`;
  if (!existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, "utf8").split("\n").map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
  );
}

/** used icons that actually have a glyph (Phosphor weight modifiers etc. don't). */
export function resolveUsed(root = ROOT) {
  const cps = iconCodepoints(root);
  const names = [...collectUsedIcons(root)].filter((n) => cps.has(n)).sort();
  return names.map((name) => ({ name, cp: cps.get(name) }));
}

/** the full subset to ship: used ∪ buffer, each tagged, only glyphs that exist. */
export function resolveSubset(root = ROOT) {
  const cps = iconCodepoints(root);
  const used = new Set(resolveUsed(root).map((u) => u.name));
  const buffer = bufferIcons(root);
  const names = [...new Set([...used, ...buffer])].filter((n) => cps.has(n)).sort();
  return names.map((name) => ({ name, cp: cps.get(name), src: used.has(name) ? "used" : "buffer" }));
}

function main() {
  const all = resolveSubset();
  const usedCount = all.filter((i) => i.src === "used").length;
  const manifest = {
    generated: "run tools/subset-phosphor.mjs to refresh",
    count: all.length, usedCount, bufferCount: all.length - usedCount, icons: all,
  };
  writeFileSync(`${ROOT}/${MANIFEST}`, JSON.stringify(manifest, null, 2) + "\n");
  if (!existsSync(`${ROOT}/${FULL}`)) {
    console.error(`Missing ${FULL}. Recover it: git show <pre-subset>:vendor/phosphor/Phosphor.woff2 > ${FULL}`);
    process.exit(1);
  }
  const unicodes = all.map((u) => `U+${u.cp}`).join(",");
  execFileSync("pyftsubset", [
    `${ROOT}/${FULL}`, `--unicodes=${unicodes}`, "--flavor=woff2",
    "--no-hinting", "--desubroutinize", `--output-file=${ROOT}/${OUT}`,
  ], { stdio: "inherit" });
  const kb = (statSync(`${ROOT}/${OUT}`).size / 1024).toFixed(1);
  console.log(`subset: ${usedCount} used + ${all.length - usedCount} buffer = ${all.length} icons -> ${OUT} (${kb}kb)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
