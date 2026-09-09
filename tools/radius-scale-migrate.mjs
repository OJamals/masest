/* One-shot migration: snap border-radius literals onto the radius tokens.
 *
 * A radius scale already existed and was already used 116 times — --r-input
 * (10px), --r-card (16px), --r-lg (22px), --r-pill (999px). It was simply
 * bypassed: ~200 further declarations spell the same handful of intentions as
 * raw literals, and the ramp they form (2, 4, 6, 7, 8, 9, 10, 11, 12, 14, 16px)
 * has no system in it. 17 distinct border-radius values render across the site.
 *
 * Run:  node tools/radius-scale-migrate.mjs [--write] [file ...]
 *
 * One new token, --r-xs: 4px. The first draft folded everything under 13px into
 * --r-input, on the reasoning that a 2px radius delta is imperceptible. That is
 * true of 8->10 and 12->10; it is not true of 2->10, which is a five-fold change
 * on the small hairline elements that use it. The 19 declarations under 7px are
 * a real step and get one. The resulting ramp is 4 / 10 / 16 / 22 / pill — even
 * six-pixel gaps, with no two steps close enough to be confusable.
 *
 * Left alone:
 *   50%      — a circle, not a corner. Different intent, and snapping it to a
 *              px value would turn avatars and dots into squircles.
 *   0        — an explicit corner reset.
 *   inherit  — deliberate inheritance.
 *   calc()/var() — already on the scale, or deliberately derived from it.
 *   multi-value shorthands (e.g. "16px 16px 0 0") — the per-corner intent is
 *              not mechanically recoverable; these are handled by hand.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const STEPS = [
  { name: "--r-xs", px: 4, max: 7 },
  { name: "--r-input", px: 10, max: 13 },
  { name: "--r-card", px: 16, max: 19 },
  { name: "--r-lg", px: 22, max: 40 },
  { name: "--r-pill", px: 999, max: Infinity },
];

const DEFAULT_FILES = [
  "css/style.css",
  "css/components.css",
  "css/blog.css",
  "css/story.css",
  "css/navigation.css",
  "css/admin-support.css",
  "css/customer-chat.css",
];

function toPx(v) {
  let m = /^(-?[\d.]+)rem$/.exec(v);
  if (m) return parseFloat(m[1]) * 16;
  m = /^(-?[\d.]+)px$/.exec(v);
  if (m) return parseFloat(m[1]);
  return null;
}

function migrate(source) {
  const changes = [];
  const skipped = [];
  const result = source.replace(
    /(^|[;{\s])(border(?:-[a-z]+)*-radius)\s*:\s*([^;{}]+)/g,
    (whole, lead, prop, rawValue) => {
      const raw = rawValue.trim();
      /* Only a single-token literal is mechanically safe. A shorthand encodes
       * per-corner intent this script cannot recover. */
      if (/\s/.test(raw)) { skipped.push({ prop, raw, why: "multi-value shorthand" }); return whole; }
      if (/var\(|calc\(|%|inherit|initial|unset/.test(raw)) { skipped.push({ prop, raw, why: "already tokenised or non-px" }); return whole; }
      const px = toPx(raw);
      if (px === null) { skipped.push({ prop, raw, why: "unrecognised" }); return whole; }
      if (px === 0) { skipped.push({ prop, raw, why: "explicit reset" }); return whole; }
      const step = STEPS.find((s) => px < s.max) || STEPS[STEPS.length - 1];
      changes.push({ prop, from: raw, px, to: step.name, toPx: step.px });
      return `${lead}${prop}: var(${step.name})`;
    },
  );
  return { result, changes, skipped };
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const files = args.filter((a) => !a.startsWith("--"));
const targets = files.length ? files : DEFAULT_FILES;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

let changed = 0;
let left = 0;
const buckets = new Map();
const skipBuckets = new Map();
for (const rel of targets) {
  const abs = path.join(root, rel);
  const source = readFileSync(abs, "utf8");
  const { result, changes, skipped } = migrate(source);
  changed += changes.length;
  left += skipped.length;
  for (const c of changes) {
    const k = `${c.px}px -> ${c.toPx === 999 ? "pill" : c.toPx + "px"} (${c.to})`;
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  for (const s of skipped) skipBuckets.set(s.why, (skipBuckets.get(s.why) || 0) + 1);
  console.log(`${rel}: ${changes.length} snapped, ${skipped.length} left alone`);
  if (write && result !== source) writeFileSync(abs, result);
}
console.log(`\ntotal: ${changed} snapped, ${left} left alone`);
console.log("\nmapping:");
[...buckets.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
console.log("\nleft alone, by reason:");
[...skipBuckets.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
if (!write) console.log("\ndry run — pass --write to apply");
