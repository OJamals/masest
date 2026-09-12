import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* robots.txt is now ours, not Cloudflare's.
 *
 * The zone had is_robots_txt_managed: true, which prepended Cloudflare's managed block at
 * the edge. That block is all-or-nothing: it disallowed Google-Extended alongside the
 * training scrapers with no way to separate them. The managed block is off and this file
 * is the whole of what the site serves, so these assertions are the only thing standing
 * between a careless edit and a change in who may read the site.
 */
const robots = readFileSync(new URL("../robots.txt", import.meta.url), "utf8");

function groupFor(token) {
  const match = robots.match(new RegExp(`^User-agent:\\s*${token}\\s*$([\\s\\S]*?)(?=^User-agent:|^Sitemap:|\\Z)`, "mi"));
  return match ? match[1] : null;
}

test("Google-Extended is allowed, deliberately", () => {
  // Google's own documentation scopes this token to Gemini Apps and the Vertex AI API for
  // Gemini - training and prompt-time grounding. It does not affect Googlebot, Search
  // ranking, or AI Overviews. Disallowing it was inherited from a Cloudflare default, not
  // chosen. If this ever needs reversing, reverse it here on purpose.
  assert.equal(groupFor("Google-Extended"), null, "Google-Extended must have no disallow group");
  // The token does appear in the header comment, explaining why it is allowed. Parsers
  // ignore comments, and a decision this easy to reverse by accident is worth writing
  // down next to the rules it governs.
  assert.doesNotMatch(
    robots,
    /^User-agent:\s*Google-Extended/mi,
    "no User-agent group for Google-Extended - allowing it is the point",
  );
});

test("bulk training crawlers stay blocked", () => {
  for (const token of ["Amazonbot", "Applebot-Extended", "Bytespider", "CCBot", "ClaudeBot", "GPTBot", "meta-externalagent"]) {
    const group = groupFor(token);
    assert.ok(group, `${token} lost its group`);
    assert.match(group, /^Disallow:\s*\/\s*$/m, `${token} must be disallowed`);
  }
});

test("answer-time crawlers are not blocked", () => {
  // These fetch when a user asks a question and are how a citation happens. Blocking them
  // is the opposite of the goal, and is easy to do by accident while adding a scraper.
  for (const token of ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Googlebot"]) {
    assert.equal(groupFor(token), null, `${token} must inherit the permissive default`);
  }
});

test("signed-in surfaces are left crawlable so their noindex can be read", () => {
  // A disallowed URL is never fetched, so its <meta name="robots" content="noindex"> is
  // never seen, and the page can still be indexed from inbound links. The pages carry
  // noindex; robots.txt must stay out of the way.
  for (const path of ["/cart", "/checkout", "/account", "/dashboard", "/admin", "/business", "/order-confirmed"]) {
    assert.doesNotMatch(robots, new RegExp(`^Disallow:\\s*${path}`, "mi"), `${path} must not be disallowed`);
    assert.doesNotMatch(robots, new RegExp(`^Disallow:\\s*${path}\\.html`, "mi"), `${path}.html must not be disallowed`);
  }
  assert.match(robots, /^Disallow:\s*\/api\/\s*$/m, "/api/ has no HTML to carry a noindex and stays disallowed");
});

test("the content signal permits grounding and the sitemap is declared", () => {
  const signal = robots.match(/^Content-Signal:\s*(.+)$/m)?.[1] || "";
  assert.match(signal, /search=yes/, "search indexing is wanted");
  assert.match(signal, /ai-input=yes/, "prompt-time grounding is what produces citations");
  assert.match(robots, /^Sitemap:\s*https:\/\/masest\.co\/sitemap\.xml$/m);
});
