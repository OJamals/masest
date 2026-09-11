import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/* Freeze the raw box-shadow literals in css/.
 *
 * Shadows on this site are FOUR unrelated jobs, not one scale, and each has its
 * own token family: layered material elevation (--shadow-xs/sm/md/lg), single-
 * layer cast shadows (--shadow-cast-sm/md/lg), focus and selection rings
 * (--ring, --ring-soft, --ring-tight) and inset bevels (--highlight-top).
 * A value that belongs to one family renders wrong in another: a teal brand glow
 * folded into an ink ramp loses its hue, and a single-layer zero-spread cast
 * cannot be spelled with a two-layer negative-spread token at all.
 *
 * This test does NOT require every literal to be tokenised. Genuine one-offs stay
 * literal by design -- a token used once is a rename, not a token. It requires
 * only that the set does not GROW: reach for an existing token first, and if none
 * fits, add the new value here with a comment saying which family it belongs to
 * and why no token does.
 *
 * Removing an entry when a literal is tokenised is always safe and encouraged.
 */

const CSS_DIR = new URL("../css/", import.meta.url);

const ALLOWED = new Set([
  "0 0 0 1px rgba(0, 0, 0, .15)",
  "0 0 0 1px rgba(14, 124, 134, .14)",
  "0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent)",
  "0 0 0 2px rgba(180,35,24,.14)",
  "0 0 0 3px rgba(14, 124, 134, .12), 0 18px 42px rgba(4, 50, 54, .12)",
  "0 0 0 3px var(--accent-soft)",
  "0 0 0 4px rgba(14,124,134,.16), var(--shadow-sm)",
  "0 0 0 4px var(--accent-soft)",
  "0 10px 24px rgba(0, 115, 119, .18)",
  "0 10px 26px -10px rgba(14,124,134,.6), 0 0 0 1px rgba(255,255,255,.14)",
  "0 12px 28px color-mix(in srgb, var(--ink) 28%, transparent), 0 3px 8px color-mix(in srgb, var(--ink) 16%, transparent)",
  "0 12px 30px rgb(0 0 0 / 24%)",
  "0 12px 48px rgba(0, 0, 0, .55)",
  "0 14px 34px rgba(4, 50, 54, .06)",
  "0 14px 38px rgba(4, 50, 54, .08)",
  "0 16px 32px rgb(0 0 0 / 18%)",
  "0 18px 38px -28px rgba(21,23,28,.45)",
  "0 18px 42px -28px rgba(20, 24, 32, .48)",
  "0 18px 44px color-mix(in srgb, var(--ink) 22%, transparent), 0 3px 10px color-mix(in srgb, var(--ink) 14%, transparent)",
  "0 18px 44px rgba(16, 74, 80, .20)",
  "0 1px 0 rgba(20, 24, 32, .02)",
  "0 1px 0 rgba(20,24,32,.02), 0 8px 24px -18px rgba(20,24,32,.3)",
  "0 1px 2px color-mix(in srgb, var(--ink) 10%, transparent)",
  "0 1px 2px rgba(20,24,32,.18), 0 10px 22px -14px rgba(20,24,32,.42)",
  "0 1px 3px rgba(21,23,28,.26)",
  "0 20px 52px rgb(0 0 0 / 28%)",
  "0 22px 52px rgba(4, 50, 54, .09)",
  "0 24px 70px -54px rgba(21, 23, 28, .52)",
  "0 24px 72px rgba(0, 0, 0, .34)",
  "0 24px 80px rgba(20, 24, 32, .28)",
  "0 26px 74px rgba(9, 46, 52, .1)",
  "0 2px 10px rgba(0, 0, 0, .18)",
  "0 2px 6px rgba(20,24,32,.20), 0 14px 28px -16px rgba(20,24,32,.46)",
  "0 34px 84px rgba(4, 50, 54, .09)",
  "0 34px 92px rgba(9, 46, 52, .16)",
  "0 8px 24px color-mix(in srgb, var(--ink) 24%, transparent), 0 2px 5px color-mix(in srgb, var(--ink) 18%, transparent)",
  "0 8px 24px rgba(9, 46, 52, .12)",
  "0 8px 24px rgba(9, 46, 52, .16)",
  "0 8px 30px rgba(14, 124, 134, .10)",
  "0 9px 30px -25px rgba(16, 46, 51, .4)",
  "inset 0 0 0 1px rgba(14, 124, 134, .12)",
  "inset 0 0 0 2px var(--accent)",
  "inset 0 1px 0 rgba(255, 255, 255, .18)",
  "inset 0 1px 0 rgba(255, 255, 255, .2)",
]);

function literals(source) {
  return [...source.matchAll(/box-shadow:\s*([^;]+);/g)]
    .map((match) => match[1].split(/\s+/).join(" ").trim())
    .filter((value) => value !== "none" && !value.startsWith("var("));
}

test("css/ introduces no new raw box-shadow literals", () => {
  const found = new Map();
  for (const file of readdirSync(CSS_DIR).filter((name) => name.endsWith(".css"))) {
    for (const value of literals(readFileSync(new URL(file, CSS_DIR), "utf8"))) {
      if (!ALLOWED.has(value)) found.set(value, file);
    }
  }
  assert.deepEqual(
    [...found].map(([value, file]) => `${file}: ${value}`),
    [],
    "New raw box-shadow literal. Use --shadow-*, --shadow-cast-*, --ring* or " +
      "--highlight-top if one fits; otherwise add it to ALLOWED with the family " +
      "it belongs to and why no token fits.",
  );
});

test("every allowed literal is still present, so the list cannot rot", () => {
  const all = readdirSync(CSS_DIR)
    .filter((name) => name.endsWith(".css"))
    .flatMap((file) => literals(readFileSync(new URL(file, CSS_DIR), "utf8")));
  const live = new Set(all);
  const stale = [...ALLOWED].filter((value) => !live.has(value));
  assert.deepEqual(stale, [], "Tokenised or deleted — remove these from ALLOWED.");
});
