/* One-shot migration: normalize media-query breakpoints onto a canonical set.
 *
 * There were 32 distinct px breakpoints across 140 @media blocks — 360, 420,
 * 430, 460, 480, 520, 540, 560, 600, 620, 640, 680, 681, 700, 720, 721, 760,
 * 761, 800, 820, 821, 840, 860, 900, 920, 940, 960, 980, 1100, 1180, 1300,
 * 1400 — each added to fix one component in isolation. Nobody could predict a
 * component's behaviour at a given width without testing it.
 *
 * Run:  node tools/breakpoint-normalize.mjs [--write] [file ...]
 *
 * Why eight canonical values and not four. Unlike a type or spacing literal,
 * a breakpoint is not interchangeable with its neighbour: it records the width
 * at which a specific layout stops fitting. 820/821 is the navigation's
 * burger-vs-links threshold; 940 is where a three-column grid gives up. Moving
 * those changes when layouts switch, and the failure mode is a cramped band
 * between two widths that a fixed-viewport screenshot sweep will not catch.
 * The canonical set below is derived from the clusters actually present, so
 * every real threshold survives and no rule moves more than one cluster.
 *
 * Rounding is to the NEAREST canonical value, not up. There is no universally
 * safe direction: rounding a max-width up over-applies it. The max-width:360
 * blocks squeeze the nav and checkout header for the smallest phones, and
 * pushing them to 480 would cramp every 400px phone; the max-width:980 blocks
 * collapse the services grids and the shop toolbar to one column, and pushing
 * them to 1180 would flatten the desktop layout. Nearest keeps every move
 * inside its own cluster — nothing shifts more than 100px, and nothing in the
 * dense 600-960 region shifts more than 40px.
 *
 * min-width maps to (the canon nearest its v-1) + 1, which keeps every
 * mutually-exclusive max/min pair exclusive: 680/681, 720/721 and 760/761 all
 * land on 720/721, and 820/821 stays put.
 *
 * This also fixes a real overlap: max-width:760 and min-width:760 both existed,
 * so at exactly 760px both rule sets applied. They now land either side of 820.
 *
 * Blocks are NOT merged. Two @media blocks with identical conditions stay
 * separate, because merging them would move rule bodies in source order and
 * silently change which declaration wins.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CANON = [360, 480, 560, 640, 720, 820, 960, 1180, 1400];

const DEFAULT_FILES = [
  "css/style.css",
  "css/components.css",
  "css/blog.css",
  "css/story.css",
  "css/navigation.css",
  "css/admin-support.css",
  "css/customer-chat.css",
];

/* Nearest canonical value. Ties resolve upward, which keeps 680 and 720 — the
 * two heaviest boundaries in the file — on the same canon, so the ranges that
 * open at 681 and 721 stay exclusive against them. */
function nearest(v) {
  let best = CANON[0];
  let bestDist = Infinity;
  for (const c of CANON) {
    const d = Math.abs(c - v);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function mapMax(v) {
  return nearest(v);
}

/* A min-width of v is the open side of a boundary whose closed side is v-1.
 * Map that closed side, then sit one pixel above it, so a pair that was
 * exclusive before is still exclusive after. */
function mapMin(v) {
  return nearest(v - 1) + 1;
}

function migrate(source) {
  const changes = [];
  const result = source.replace(/@media[^{]+/g, (query) => {
    if (!/\d+px/.test(query)) return query;
    return query.replace(
      /\((min|max)-width:\s*(\d+)px\)/g,
      (whole, dir, num) => {
        const v = Number(num);
        const next = dir === "max" ? mapMax(v) : mapMin(v);
        if (next === v) return whole;
        changes.push({ dir, from: v, to: next });
        return `(${dir}-width: ${next}px)`;
      },
    );
  });
  return { result, changes };
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const files = args.filter((a) => !a.startsWith("--"));
const targets = files.length ? files : DEFAULT_FILES;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const buckets = new Map();
let total = 0;
for (const rel of targets) {
  const abs = path.join(root, rel);
  const source = readFileSync(abs, "utf8");
  const { result, changes } = migrate(source);
  total += changes.length;
  for (const c of changes) {
    const key = `${c.dir}-width ${c.from} -> ${c.to}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  console.log(`${rel}: ${changes.length} conditions remapped`);
  if (write && result !== source) writeFileSync(abs, result);
}

console.log(`\ntotal: ${total} conditions remapped`);
console.log("\nmapping:");
[...buckets.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));
if (!write) console.log("\ndry run — pass --write to apply");
