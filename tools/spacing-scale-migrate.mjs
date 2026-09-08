/* One-shot migration: map hand-typed spacing literals onto the spacing scale.
 *
 * :root defined 55 custom properties and exactly one of them was spacing
 * (--space-section). Everything else was typed by hand: 4,345 expanded
 * padding/margin/gap values across 63 distinct px literals, with clusters of
 * near-identical neighbours (5/6/7, 9/10/11, 13/14/15, 17/18, 21/22, 26/28/30)
 * doing the same job in different places. That is why no two panels shared an
 * inner rhythm.
 *
 * Run:  node tools/spacing-scale-migrate.mjs [--write] [file ...]
 * Without --write it reports the mapping and changes nothing.
 *
 * Deliberately left alone:
 *   0, auto, %          not lengths on a scale.
 *   clamp() / calc()    the fluid section rhythm and the story's viewport maths.
 *                       Section-level spacing is its own decision, made later.
 *   var()               already tokenised.
 *   |value| < 4px       1px, 2px and 3px are hairlines and optical nudges, not
 *                       rhythm. .sr-only's margin:-1px in particular must not
 *                       move, and a 1px gap is a divider, not a gap.
 *
 * Ties round up. Type got larger in the previous commit, so where a value sits
 * exactly between two steps the safer failure mode is slightly airy rather than
 * text touching its container. The macro problem — 108px section padding making
 * pages long — is a separate change against the clamp() values, not this one.
 *
 * Sign is preserved through the same snap, so a negative margin stays paired
 * with the padding it compensates: .prod-photo's -32px bleed and its card's
 * 32px padding land on the same step, as do the hero card's -44px and 44px.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const STEPS = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 112];
const KEEP_BELOW = 4;

const DEFAULT_FILES = [
  "css/style.css",
  "css/components.css",
  "css/blog.css",
  "css/story.css",
  "css/navigation.css",
  "css/admin-support.css",
  "css/customer-chat.css",
];

const PROP = /^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/;
/* Only the box-spacing properties. inset/top/left are excluded below — they
 * position things against edges and are not part of the rhythm. */
const SPACING_PROP = /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/;

function snap(px) {
  const sign = px < 0 ? -1 : 1;
  const v = Math.abs(px);
  if (v < KEEP_BELOW) return null;
  if (v > STEPS[STEPS.length - 1]) return sign * Math.round(v / 16) * 16;
  let best = STEPS[0];
  let bestDist = Infinity;
  for (const s of STEPS) {
    const d = Math.abs(s - v);
    /* strictly-less keeps the first (smaller) step on a tie; using <= lets the
     * later, larger step win, which is the round-up rule. */
    if (d <= bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return sign * best;
}

const TOKEN = new Map(STEPS.map((s, i) => [s, `--s${i + 1}`]));

/* Rewrite one declaration's value, token by token. Anything that is not a bare
 * px length passes through untouched, including whole clamp()/calc() calls. */
function rewriteValue(value, stats) {
  if (/clamp\(|calc\(|var\(|min\(|max\(/.test(value)) {
    stats.skipped.push({ value, reason: "fluid or computed" });
    return value;
  }
  let changed = false;
  const out = value.replace(/(-?\d*\.?\d+)px/g, (whole, num) => {
    const px = parseFloat(num);
    const target = snap(px);
    if (target === null) {
      stats.skipped.push({ value: whole, reason: "optical, under 4px" });
      return whole;
    }
    const token = TOKEN.get(Math.abs(target));
    if (!token) {
      stats.skipped.push({ value: whole, reason: "above scale" });
      return whole;
    }
    changed = true;
    stats.changes.push({ from: px, to: target });
    return target < 0 ? `calc(-1 * var(${token}))` : `var(${token})`;
  });
  return changed ? out : value;
}

function migrate(source) {
  const stats = { changes: [], skipped: [] };
  const result = source.replace(
    /(^|[;{}\s])([a-z-]+)\s*:\s*([^;{}]+)/g,
    (whole, lead, prop, value) => {
      if (!SPACING_PROP.test(prop)) return whole;
      const next = rewriteValue(value, stats);
      return next === value ? whole : `${lead}${prop}: ${next}`;
    },
  );
  return { result, ...stats };
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const files = args.filter((a) => !a.startsWith("--"));
const targets = files.length ? files : DEFAULT_FILES;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const buckets = new Map();
let totalChanged = 0;
let totalSkipped = 0;

for (const rel of targets) {
  const abs = path.join(root, rel);
  const source = readFileSync(abs, "utf8");
  const { result, changes, skipped } = migrate(source);
  totalChanged += changes.length;
  totalSkipped += skipped.length;
  for (const c of changes) {
    const key = `${c.from}px -> ${c.to}px`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  console.log(`${rel}: ${changes.length} mapped, ${skipped.length} left alone`);
  if (write && result !== source) writeFileSync(abs, result);
}

console.log(`\ntotal: ${totalChanged} mapped, ${totalSkipped} left alone`);
console.log("\nlargest moves (occurrences x distance):");
[...buckets.entries()]
  .map(([k, v]) => {
    const [from, to] = k.match(/-?\d+/g).map(Number);
    return { k, v, dist: Math.abs(to - from) };
  })
  .filter((e) => e.dist > 0)
  .sort((a, b) => b.v * b.dist - a.v * a.dist)
  .slice(0, 20)
  .forEach((e) => console.log(`  ${String(e.v).padStart(4)}  ${e.k}`));
if (!write) console.log("\ndry run — pass --write to apply");
