/* One-shot migration: give shadows, rings and translucent borders a token layer.
 *
 * The surface audit reported "30 distinct rendered box-shadow values" and asked
 * for three. Three is the wrong target: counting values treats four unrelated
 * jobs as one. Measured across css/*.css there are 167 box-shadow declarations
 * and 473 border/outline colour declarations, and they divide like this:
 *
 *   elevation on a light surface   68 already tokenised + 43 literals (40 distinct)
 *   focus / selection rings        26 declarations, 21 distinct
 *   elevation on a DARK surface    14 declarations, 12 distinct
 *   inset bevel highlights          5 declarations,  5 distinct
 *   translucent borders           109 literals, 65 distinct
 *
 * A ring is not a shadow with different numbers -- it is a hard spread with no
 * blur, and it must stay legible where a soft drop shadow would vanish. A shadow
 * cast on a dark surface cannot use the teal-tinted ramp that works on white,
 * because a teal tint is invisible against near-black; it needs neutral black.
 * So the fix is four small scales, not one collapsed set.
 *
 * The actual disease is the same one the type, spacing and radius scales had: a
 * continuous ramp with no steps. 27 accent borders are spelled with 17 different
 * alpha values; 23 ink hairlines with 7; 16 on-dark borders with 13. Nobody
 * chose those numbers -- they accumulated.
 *
 * The alpha steps below are not invented. Each family was split by whether the
 * declaration sits in a resting rule or in a :hover / :focus-visible / selected
 * rule, and the steps are the centres of those measured groups:
 *
 *   accent borders   resting  .14-.32 (10 uses)   -> --line-accent        .22
 *                    emphasis .18-.42 (14 uses)   -> --line-accent-hover  .36
 *                    selected .46-.62 ( 3 uses)   -> --line-accent-active .52
 *   ink hairlines    .07-.09 ( 9 uses)            -> --line-ink-soft      .08
 *                    .10-.16 (14 uses)            -> --line-ink           .12
 *   on-dark borders  .10-.22 (12 uses)            -> --line-on-dark       .18
 *                    .30-.55 ( 4 uses)            -> --line-on-dark-strong .42
 *
 * Every proposed token is used at least three times. A token used once is a
 * rename, not a token, so the genuine one-offs stay literal: the hazard-diamond
 * colours, the data-visualisation series, the amber and mint rings, and the two
 * dim inset highlights.
 *
 * Run:  node tools/surface-token-migrate.mjs [--write] [file ...]
 *
 * NOT changed here: rgba() used for backgrounds or text (a translucent fill is a
 * different job again), gradient stops, and anything already routed through a
 * var().
 *
 * ELEVATION IS DELIBERATELY NOT MIGRATED. The first version of this tool snapped
 * elevation literals onto --shadow-xs/sm/md/lg by nearest blur radius. A visual
 * diff against the un-migrated stylesheets rejected it at 2.5M changed pixels:
 * a border alpha varies in one dimension and collapses onto a scale cleanly, but
 * a shadow varies in four -- offset, blur, spread and colour -- and matching on
 * blur alone discards the other three. `0 24px 70px -54px` became --shadow-lg's
 * -28px spread, turning a tight tucked shadow into a broad one; a subtle teal
 * `0 8px 30px rgba(14,124,134,.10)` became the heavy two-layer --shadow-md.
 * Elevation drift is real, but fixing it is a design decision per component, not
 * a mechanical snap. The --shadow-dark-* tokens stay defined and are used by
 * hand where a dark surface needs them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const NEW_TOKENS = `
  /* Translucent border scale. These composite over whatever sits behind them,
     which is why they are alpha rather than the opaque --line: the same hairline
     has to read on white, on --surface-soft and on a tinted panel. Steps are the
     measured centres of the resting / hover / selected groups, not round numbers. */
  --line-ink-soft: rgba(13, 48, 53, .08);
  --line-ink: rgba(13, 48, 53, .12);
  --line-accent: rgba(14, 124, 134, .22);
  --line-accent-hover: rgba(14, 124, 134, .36);
  --line-accent-active: rgba(14, 124, 134, .52);
  --line-on-dark: rgba(255, 255, 255, .18);
  --line-on-dark-strong: rgba(255, 255, 255, .42);

  /* Rings. A ring is a hard spread with no blur -- it marks focus and selection
     and must stay legible where a soft shadow would disappear. Kept separate
     from the elevation ramp for that reason. --ring is the focus ring and is the
     one that must never be softened below AA visibility. */
  --ring: 0 0 0 3px rgba(14, 124, 134, .38);
  --ring-soft: 0 0 0 3px rgba(14, 124, 134, .14);
  --ring-tight: 0 0 0 2px rgba(14, 124, 134, .12);

  /* Elevation on DARK surfaces. The --shadow-* ramp is tinted teal, which is
     correct on white and invisible on near-black, so dark surfaces get a neutral
     ramp of their own rather than a tint nobody can see. */
  --shadow-dark-sm: 0 2px 10px rgba(0, 0, 0, .18);
  --shadow-dark-md: 0 12px 30px rgba(0, 0, 0, .26);
  --shadow-dark-lg: 0 24px 60px rgba(0, 0, 0, .45);

  /* Inset bevel: a one-pixel top highlight that reads as a lit edge. Three uses
     on light surfaces share this value; the two dim variants on dark surfaces
     stay literal, because two uses is a rename rather than a token. */
  --highlight-top: inset 0 1px 0 rgba(255, 255, 255, .85);
`;

const DEFAULT_FILES = [
  "css/style.css",
  "css/components.css",
  "css/blog.css",
  "css/story.css",
  "css/navigation.css",
  "css/admin-support.css",
  "css/customer-chat.css",
];

/* Elevation steps, matched on blur radius -- the number that actually sets how
 * far a surface reads as lifted. Offset and spread vary cosmetically around it.
 *
 * Matched to the NEAREST step rather than bucketed by threshold. The existing
 * ramp's blurs are 2, 12, 42 and 74, which leaves wide gaps, and a literal that
 * lands in one of them should move to whichever step it is actually closest to.
 * Bucketing pushed a 24px blur onto the 42px step -- a visible thickening -- when
 * the 12px step is nearer. Same reasoning as the breakpoint canon. */
const ELEVATION = [
  { name: "--shadow-xs", blur: 2 },
  { name: "--shadow-sm", blur: 12 },
  { name: "--shadow-md", blur: 42 },
  { name: "--shadow-lg", blur: 74 },
];

const DARK_ELEVATION = [
  { name: "--shadow-dark-sm", blur: 10 },
  { name: "--shadow-dark-md", blur: 30 },
  { name: "--shadow-dark-lg", blur: 60 },
];

function nearestStep(ramp, blur) {
  let best = ramp[0];
  let bestDist = Infinity;
  for (const step of ramp) {
    const d = Math.abs(step.blur - blur);
    if (d < bestDist) { bestDist = d; best = step; }
  }
  return best.name;
}

const BORDER_STEPS = {
  accent: [
    { name: "--line-accent", max: 0.29 },
    { name: "--line-accent-hover", max: 0.44 },
    { name: "--line-accent-active", max: Infinity },
  ],
  ink: [
    { name: "--line-ink-soft", max: 0.095 },
    { name: "--line-ink", max: Infinity },
  ],
  onDark: [
    { name: "--line-on-dark", max: 0.26 },
    { name: "--line-on-dark-strong", max: Infinity },
  ],
};

/* Colours that are near-duplicates of the accent and should collapse onto it.
 * rgb(0,115,119) is a second teal that drifted in; it is not a separate brand. */
const ACCENT_RGB = new Set(["14,124,134", "0,115,119"]);
/* Pure black is deliberately NOT in here. --line-ink is teal-tinted
 * rgba(13,48,53,...); pure black is neutral. They are different colours doing
 * different jobs, and folding one into the other tints whatever it outlines. */
const INK_RGB = new Set(["13,48,53", "12,28,33", "15,23,42"]);
const WHITE_RGB = new Set(["255,255,255"]);
const NEUTRAL_RGB = new Set(["0,0,0", "255,255,255"]);

function parseRgba(str) {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*[,/]?\s*([\d.]+%?)?\s*\)$/i.exec(str.trim());
  if (!m) return null;
  let a = m[4];
  a = a == null ? 1 : (a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a));
  return { rgb: `${+m[1]},${+m[2]},${+m[3]}`, a };
}

function borderTokenFor(colour, prop = "") {
  const p = parseRgba(colour);
  if (!p) return null;
  /* An outline drawn in pure black or pure white on photographic media is
   * neutral on purpose -- that is the whole point of it. Routing it through a
   * tinted line token, or nudging its alpha up a scale step, casts colour onto
   * the edge of every image. interface-feel-polish pins these literals for
   * exactly this reason. */
  if (/^outline/i.test(prop) && NEUTRAL_RGB.has(p.rgb)) return null;
  if (p.a >= 0.98) return null;                 // opaque: --line and friends already cover it
  let steps = null;
  if (ACCENT_RGB.has(p.rgb)) steps = BORDER_STEPS.accent;
  else if (INK_RGB.has(p.rgb)) steps = BORDER_STEPS.ink;
  else if (WHITE_RGB.has(p.rgb)) steps = BORDER_STEPS.onDark;
  if (!steps) return null;                      // a genuine one-off colour
  return (steps.find((s) => p.a < s.max) || steps[steps.length - 1]).name;
}

/* A ring is `0 0 0 <spread>` with no blur. */
function ringTokenFor(value) {
  const m = /^(inset\s+)?0\s+0\s+0\s+(\d+)px\s+(.+)$/i.exec(value.trim());
  if (!m || m[1]) return null;                  // inset rings stay as written
  const p = parseRgba(m[3].replace(/,\s*$/, ""));
  if (!p || !ACCENT_RGB.has(p.rgb)) return null; // amber and mint rings are one-offs
  const spread = Number(m[2]);
  /* A 1px ring is a hairline outline, not a compact focus ring; widening it to
   * --ring-tight's 2px is a visible change. Only two of those exist, which is
   * below the bar for a token of their own, so they keep their literal. */
  if (spread === 1) return "KEEP";
  if (spread === 2) return "--ring-tight";
  return p.a >= 0.24 ? "--ring" : "--ring-soft";
}

function shadowTokenFor(value) {
  const v = value.trim();
  if (/^(none|0|inherit|initial|unset)$/i.test(v)) return null;
  if (v.includes("var(--")) return null;
  if (/^inset/i.test(v)) return null;
  if (v.includes(",") && /\)\s*,\s*(inset\s+)?[-\d]/.test(v)) return null; // layered: leave by hand
  /* Offsets are frequently written as a bare `0` rather than `0px`, so the unit
   * has to be optional on every length here -- requiring it silently skipped
   * most of the file on the first run. */
  const LEN = String.raw`-?[\d.]+(?:px)?`;
  const blur = new RegExp(`(?:${LEN}\\s+){2}(${LEN})`).exec(v);
  if (!blur) return null;
  const b = Math.abs(parseFloat(blur[1]));
  /* Both rgba(0,0,0,.4) and the space-separated rgb(0 0 0 / 24%) appear. */
  const isDark = /rgba?\(\s*0\s*[,\s]+0\s*[,\s]+0/.test(v);
  return nearestStep(isDark ? DARK_ELEVATION : ELEVATION, b);
}

/* Physical and logical border properties both appear in this codebase; matching
 * only the physical ones left a border-block declaration behind on the first run. */
const BORDER_PROP = /\b(border(?:-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?(?:-color)?|outline(?:-color)?)\s*:\s*([^;{}]+)/gi;
const SHADOW_PROP = /\bbox-shadow\s*:\s*([^;{}]+)/gi;
const RGBA_RE = /rgba?\([^()]*\)/gi;

export function migrate(source) {
  const changes = [];
  const lines = source.split("\n");
  const out = lines.map((line) => {
    if (line.trim().startsWith("/*") || line.trim().startsWith("*")) return line;

    let next = line.replace(SHADOW_PROP, (whole, value) => {
      const ring = ringTokenFor(value);
      /* "KEEP" means this IS a ring but has no token of its own -- a 1px hairline.
       * It must not fall through to the elevation matcher, which would read its
       * zero blur as a tiny drop shadow and replace a crisp outline with a wash. */
      if (ring === "KEEP") return whole;
      if (ring) {
        changes.push({ kind: "ring", from: value.trim(), to: ring });
        return `box-shadow: var(${ring})`;
      }
      return whole;
    });

    next = next.replace(BORDER_PROP, (whole, prop, value) => {
      if (value.includes("var(--")) return whole;
      let touched = false;
      const replaced = value.replace(RGBA_RE, (colour) => {
        const tok = borderTokenFor(colour, prop);
        if (!tok) return colour;
        touched = true;
        changes.push({ kind: "border", from: colour, to: tok });
        return `var(${tok})`;
      });
      return touched ? `${prop}: ${replaced}` : whole;
    });

    return next;
  });
  return { result: out.join("\n"), changes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
      const key = `${c.kind}: ${c.to}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    console.log(`${rel}: ${changes.length} declarations tokenised`);
    if (write && result !== source) writeFileSync(abs, result);
  }
  console.log(`\ntotal: ${total}`);
  console.log("\nby token:");
  [...buckets.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
  if (!write) console.log("\ndry run — pass --write to apply");
}
