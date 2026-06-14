import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../contact.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../js/main.js", import.meta.url), "utf8");
const story = readFileSync(new URL("../js/story.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");

assert.match(
  html,
  /<form\b[^>]*\bdata-endpoint="https:\/\/formspree\.io\/f\/xzzgvqaq"/,
  "quote form has a real submission endpoint",
);
assert.match(main, /fetch\(\s*endpoint/, "quote form submit uses configured form action");
assert.match(
  main,
  /document\.body\.classList\.toggle\("nav-open"/,
  "mobile menu locks page scroll while open",
);
assert.match(main, /syncRevealFocus/, "hidden reveal links stay out of keyboard order");
assert.match(story, /syncStoryFocus/, "story timeline updates keyboard reachability");
assert.match(
  story,
  /var BEAT_IN = 0\.65, BEAT_OUT = 0\.25, HOLD = 1\.65;/,
  "story timings keep deliberate holds between acts",
);
assert.match(
  story,
  /start:\s*st\.act === firstAct \? "top 67px" : "top bottom"/,
  "first scrollybook act starts at the visible top below the nav",
);
assert.match(css, /body\.nav-open/, "mobile menu has scroll-lock CSS");
assert.match(
  css,
  /@media \(max-width: 360px\)[\s\S]*\.nav-cta/,
  "small-phone header has a compact CTA treatment",
);
