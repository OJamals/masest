import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("index.html");
const storyCss = read("css/story.css");
const storyJs = read("js/story.js");
const story = home.match(/<div class="story" id="story"[\s\S]*?<\/div>\s*<section class="story-summary/)?.[0] || "";
const acts = [...story.matchAll(/<section class="act[^"]*"[^>]*data-act="(\d)"/g)];

test("homepage story is a four-act Replacement Ledger narrative", () => {
  assert.ok(story, "expected homepage story");
  assert.deepEqual(acts.map((match) => match[1]), ["1", "2", "3", "4"]);
  assert.equal((story.match(/class="rail-btn"/g) || []).length, 4);
  assert.doesNotMatch(story, /data-act="5"/);
});

test("first act has one dominant guided replacement action and quieter trial", () => {
  const actOne = story.match(/<section class="act"[^>]*data-act="1"[\s\S]*?<\/section>/)?.[0] || "";
  const primaryActions = actOne.match(/class="btn btn-primary"/g) || [];

  assert.equal(primaryActions.length, 1);
  assert.match(actOne, /class="btn btn-primary" href="products#catalog"[^>]*>Find your replacement<\/a>/);
  assert.match(actOne, /class="btn btn-ghost" href="contact\?type=sample"[^>]*>Request a trial<\/a>/);
  assert.doesNotMatch(actOne, /story-shortcuts/);
});

test("second act carries buildup and operational cost through one pipe", () => {
  const actTwo = story.match(/<section class="act"[^>]*data-act="2"[\s\S]*?<\/section>/)?.[0] || "";

  assert.equal((actTwo.match(/class="pipe-diagram"/g) || []).length, 1);
  assert.match(actTwo, /class="pipe-cost-chain"/);
  assert.match(actTwo, /PPE &amp; training/);
  assert.match(actTwo, /Downtime/);
  assert.match(actTwo, /Hazmat handling/);
});

test("third act is one operational ledger with qualified replacements", () => {
  const actThree = story.match(/<section class="act act-ledger"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(actThree, /class="replacement-ledger"/);
  assert.equal((actThree.match(/class="ledger-row"/g) || []).length, 4);
  const revealBeats = ["1.2", "1.7", "2.2", "2.7", "3.2", "3.7", "4.2", "4.7"];
  revealBeats.forEach((beat, index) => {
    const step = index + 1;
    const cells = actThree.match(new RegExp(`data-ledger-step="${step}" data-at="${beat}"`, "g")) || [];
    assert.equal(cells.length, 3, `ledger reveal step ${step} must own three cells at beat ${beat}`);
  });
  assert.doesNotMatch(actThree, /class="ledger-row" data-at=/);
  assert.match(storyCss, /\.ledger-intro\s*\{[\s\S]*left: clamp\(36px, 2vw, 40px\)/);
  for (const product of ["hcr", "cr", "purgo", "neutral"]) {
    assert.match(actThree, new RegExp(`href="products/${product}"`));
  }
  assert.equal((actThree.match(/class="hmis-chip is-safe"/g) || []).length, 4);
  assert.match(actThree, /Ratings vary by manufacturer and concentration; typical SDS values are shown/);
  assert.match(actThree, /OSHA 2026 penalty schedule/);
  assert.match(actThree, /Liberty Mutual 2025 Workplace Safety Index/);
  assert.doesNotMatch(actThree, /DBNPA/);
});

test("fourth act is an asymmetric proof and action close", () => {
  const actFour = story.match(/<section class="act act-savior act-proof-close"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(actFour, /class="proof-close"/);
  assert.match(actFour, /class="proof-panel"/);
  assert.match(actFour, /class="close-action"/);
  assert.match(actFour, /data-target="6">6<\/span><span class="cost-per"> job inputs/);
  assert.match(actFour, /Current chemical, dilution, labor, water, downtime, and disposal/);
  assert.match(actFour, /href="products#catalog"/);
  assert.doesNotMatch(actFour, /zero-axis|savior-zero-scale|grid-template-columns:\s*repeat\(3/);
});

test("story keeps native scroll, compact roads, and explicit light-content boundary", () => {
  assert.doesNotMatch(storyJs, /new\s+Lenis|addEventListener\(["']wheel|preventDefault\(\).*wheel|scrollMultiplier/);
  assert.match(storyCss, /\.story \.act\[data-act="1"\]\s*\{[^}]*height:\s*160vh/s);
  assert.match(storyCss, /\.story \.act\[data-act="2"\]\s*\{[^}]*height:\s*170vh/s);
  assert.match(storyCss, /\.story \.act\[data-act="3"\]\s*\{[^}]*height:\s*205vh/s);
  assert.match(storyCss, /\.story \.act\[data-act="4"\]\s*\{[^}]*height:\s*125vh/s);
  assert.match(storyJs, /rect\.bottom\s*>=\s*window\.innerHeight/);
});
