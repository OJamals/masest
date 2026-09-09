/* One-shot migration: map hand-typed font-size literals onto the type scale.
 *
 * The site had no type scale. 778 font-size declarations across 126 distinct
 * values, 273 of them computing under 13px — the smallest 7.68px. With almost
 * everything small, nothing could lead, so hierarchy collapsed and the layout
 * compensated with very large section padding. Introducing the scale is the
 * fix; this script is how the existing declarations reach it.
 *
 * Run:  node tools/type-scale-migrate.mjs [--write] [file ...]
 * Without --write it reports the mapping and changes nothing.
 *
 * Deliberately left alone:
 *   clamp()  — the fluid display sizes are already correct and already scale.
 *   em / %   — relative to a parent the script cannot resolve.
 *   icons    — a font-size on an <i> is a glyph dimension, not type. Snapping
 *              those to a text scale changes icon geometry, so selectors whose
 *              subject is an icon keep their literal.
 *   .story-object__*  — the homepage before/after card. Its footer packs three
 *              metadata items and a product block into a fixed sticky card, and
 *              at 13px every one of them wraps to three lines at 390px wide:
 *              measured, the card grew until it covered the "Better chemistry."
 *              headline behind it. Raising these needs the card footer
 *              redesigned for the larger type, not a mechanical snap, so the
 *              12 declarations are left at their literals and tracked as a
 *              separate task. Everything else in story.css does migrate,
 *              including the replacement ledger.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const STEPS = [
  { name: "--fs-caption", px: 13, max: 13.5 },
  { name: "--fs-small", px: 14, max: 15.0 },
  { name: "--fs-body", px: 16, max: 17.0 },
  { name: "--fs-body-lg", px: 18, max: 19.0 },
  { name: "--fs-h5", px: 20, max: 22.0 },
  { name: "--fs-h4", px: 24, max: 27.0 },
  { name: "--fs-h3", px: 30, max: 33.0 },
  { name: "--fs-h2", px: 38, max: 43.0 },
  { name: "--fs-h1", px: 48, max: Infinity },
];

/* story.css was missing from this list on the first pass, and it is the file
 * with the worst offenders: 42 of its 44 font-size literals computed under
 * 13px, the smallest at 7.68px. The metric reported after that pass ("0% of
 * text under 13px") was measured on /products, which does not load story.css —
 * the homepage does, so the front door still carried the whole original
 * problem. admin-support.css and customer-chat.css are included for the same
 * reason; between them they hold two literals, both already at or above body
 * size. */
const DEFAULT_FILES = [
  "css/style.css",
  "css/components.css",
  "css/blog.css",
  "css/navigation.css",
  "css/story.css",
  "css/admin-support.css",
  "css/customer-chat.css",
];

/* An icon rule sizes a glyph, not text. Match the subject of the last compound
 * selector: a bare `i`, or any class that reads as an icon. */
/* Selectors whose layout cannot absorb the scale's 13px floor. See the header:
 * these are exempted deliberately, with the breakage measured, not skipped for
 * convenience. */
const LAYOUT_LOCKED = /\.story-object__/;

function isIconSelector(prelude) {
  return prelude.split(",").some((sel) => {
    const subject = sel.trim().split(/\s+|>/).filter(Boolean).pop() || "";
    if (/(^|[.\-_])ico(n)?([.\-_:[]|$)/i.test(subject)) return true;
    return /^i([.:[#]|$)/.test(subject);
  });
}

function stepFor(px) {
  return STEPS.find((s) => px < s.max) || STEPS[STEPS.length - 1];
}

/* Resolve a literal to px. Only a bare rem or px literal is mechanically safe;
 * everything else — clamp(), calc(), var(), em, %, viewport units — returns
 * null and keeps its original value. Match the safe forms first: a substring
 * test for "em" also matches inside "rem". */
function toPx(value) {
  const v = value.trim();
  let m = /^(-?[\d.]+)rem$/.exec(v);
  if (m) return parseFloat(m[1]) * 16;
  m = /^(-?[\d.]+)px$/.exec(v);
  if (m) return parseFloat(m[1]);
  return null;
}

/* Walk the stylesheet tracking the prelude of the rule each declaration sits
 * in, so an icon rule can be recognised. Brace-depth tracking is enough here:
 * the stylesheet has no strings or comments containing braces. */
function migrate(source) {
  const out = [];
  const changes = [];
  const skipped = [];
  let preludeStack = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (!buffer) return;
    out.push(buffer);
    buffer = "";
  };

  while (i < source.length) {
    const ch = source[i];
    if (ch === "{") {
      preludeStack.push(buffer.split(/[;{}]/).pop().trim());
      buffer += ch;
      flush();
      i += 1;
      continue;
    }
    if (ch === "}") {
      preludeStack.pop();
      buffer += ch;
      flush();
      i += 1;
      continue;
    }
    if (ch === ";" || ch === "\n") {
      buffer += ch;
      const decl = /(^|\s)(font-size)\s*:\s*([^;{}]+)/.exec(buffer);
      if (decl) {
        const raw = decl[3].trim();
        const px = toPx(raw);
        /* The nearest non-at-rule prelude is the selector that owns this
         * declaration; @media wrappers sit above it on the stack. */
        const prelude = [...preludeStack].reverse().find((p) => p && !p.startsWith("@")) || "";
        if (px === null) {
          skipped.push({ prelude, raw, reason: "fluid or relative" });
        } else if (isIconSelector(prelude)) {
          skipped.push({ prelude, raw, reason: "icon glyph size" });
        } else if (LAYOUT_LOCKED.test(prelude)) {
          skipped.push({ prelude, raw, reason: "layout cannot absorb the 13px floor" });
        } else {
          const step = stepFor(px);
          buffer = buffer.replace(decl[3], `var(${step.name})`);
          changes.push({ prelude, from: raw, px, to: step.name, toPx: step.px });
        }
      }
      flush();
      i += 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return { result: out.join(""), changes, skipped };
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const files = args.filter((a) => !a.startsWith("--"));
const targets = files.length ? files : DEFAULT_FILES;

let totalChanged = 0;
let totalSkipped = 0;
const buckets = new Map();
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

for (const rel of targets) {
  const abs = path.join(root, rel);
  const source = readFileSync(abs, "utf8");
  const { result, changes, skipped } = migrate(source);
  totalChanged += changes.length;
  totalSkipped += skipped.length;
  for (const c of changes) {
    const key = `${c.px}px -> ${c.toPx}px (${c.to})`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  console.log(`${rel}: ${changes.length} mapped, ${skipped.length} left alone`);
  if (write && result !== source) writeFileSync(abs, result);
}

console.log(`\ntotal: ${totalChanged} mapped, ${totalSkipped} left alone`);
console.log("\nmapping distribution:");
[...buckets.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
if (!write) console.log("\ndry run — pass --write to apply");
