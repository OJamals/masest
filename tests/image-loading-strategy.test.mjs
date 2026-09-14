import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

/* The loading strategy for shipped images, as an invariant rather than a count.
 *
 * A raw count of images "missing loading=" reports 83 and reads like a defect. It
 * is not: every one of the 83 is deliberately eager. 68 carry fetchpriority="high"
 * and are their page's LCP image, where loading="lazy" would REGRESS LCP; 12 sit
 * inside <noscript>, where the attribute never applies because the markup is not
 * parsed when scripts run; the rest are the first image on their page, above the
 * fold.
 *
 * So the rule is not "every image must be lazy". It is: an eager image must have a
 * reason. If this fails, an image was added below the fold without loading="lazy" —
 * add the attribute rather than widening the exemptions.
 */

const ROOT = new URL("../", import.meta.url);

// cf-build never publishes these.
const SKIP = new Set([
  ".git", ".github", ".wrangler", "artifacts", "audit", "audits", "cloudflare",
  "dist", "docs", "factory", "functions", "node_modules", "prototypes",
  "supabase", "test-results", "tests", "tmp", "tools", "_local",
]);
// cf-build ships `git ls-files --cached --others --exclude-standard`; a git-ignored
// snapshot (backups/premium-redesign-*) is not a shipped page.
const SHIPPABLE = new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
}).split("\n").filter(Boolean));

function pages(dir = ROOT.pathname, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pages(full, found);
    else if (entry.endsWith(".html") && SHIPPABLE.has(relative(ROOT.pathname, full))) found.push(full);
  }
  return found;
}

/* Two homepage images are eager and carry no marker, on purpose.
 *
 * They are the story object's after-frame and the product chip (a 180x240 variant
 * sized for its 28x42 box, not the 900x1200 packshot) -- the other
 * halves of the same above-the-fold comparison card as the LCP image. They are
 * deliberately NOT given loading="eager" or fetchpriority="high", because
 * tests/image-delivery.test.mjs:25-26 asserts exactly that: marking them would
 * put them in competition with the initial field frame for bandwidth, which is
 * the opposite of what that test protects ("homepage prioritizes the initial
 * field frame while preserving later scene assets").
 *
 * So this is not a loophole to widen. Adding an entry here means claiming another
 * image must stay unmarked for a documented reason; anything else gets
 * loading="lazy".
 */
const DEFERS_TO_LCP_DECISION = new Set([
  "https://media.masest.co/site/img/proof/story/kitchen-grease-after-aligned-202609.webp",
  "https://media.masest.co/site/img/products/crhd-food-beverage-studio-chip.webp",
]);

function images(html) {
  const noscript = [...html.matchAll(/<noscript>[\s\S]*?<\/noscript>/g)]
    .map((match) => [match.index, match.index + match[0].length]);
  const inNoscript = (at) => noscript.some(([from, to]) => at >= from && at < to);
  let rank = 0;
  return [...html.matchAll(/<img\b[^>]*>/g)].map((match) => {
    const hidden = inNoscript(match.index);
    return { tag: match[0], inNoscript: hidden, rank: hidden ? -1 : rank++ };
  });
}

test("every eager image is an LCP image, a noscript fallback, or first on its page", () => {
  const unexplained = [];
  for (const file of pages()) {
    for (const image of images(readFileSync(file, "utf8"))) {
      if (/\bloading\s*=/.test(image.tag)) continue;
      if (image.inNoscript) continue;
      if (/fetchpriority="high"/.test(image.tag)) continue;
      if (image.rank === 0) continue;
      const src = image.tag.match(/src="([^"]*)"/)?.[1] ?? "(no src)";
      if (DEFERS_TO_LCP_DECISION.has(src)) continue;
      unexplained.push(`${relative(ROOT.pathname, file)} #${image.rank}: ${src}`);
    }
  }
  assert.deepEqual(
    unexplained.sort(),
    [],
    'Image is eager with no reason. Add loading="lazy" if it is below the fold; if it ' +
      'is genuinely the LCP element, give it fetchpriority="high" instead.',
  );
});

test("every shipped image keeps alt text and intrinsic dimensions, so CLS stays handled", () => {
  const missing = [];
  for (const file of pages()) {
    for (const { tag } of images(readFileSync(file, "utf8"))) {
      const name = relative(ROOT.pathname, file);
      if (!/\balt\s*=/.test(tag)) missing.push(`${name}: no alt — ${tag.slice(0, 70)}`);
      if (!/\bwidth\s*=/.test(tag) || !/\bheight\s*=/.test(tag)) {
        missing.push(`${name}: no width/height — ${tag.slice(0, 70)}`);
      }
    }
  }
  assert.deepEqual(missing.sort(), []);
});
