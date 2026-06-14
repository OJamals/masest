import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../contact.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../js/main.js", import.meta.url), "utf8");
const story = readFileSync(new URL("../js/story.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");

assert.match(html, /<form\b[^>]*\bdata-endpoint="https:\/\/formsubmit\.co\/ajax\/matthew@masest\.co"/,
  "quote form has a real submission endpoint");
assert.match(main, /fetch\(\s*endpoint/,
  "quote form submit uses the configured form action");
assert.match(main, /document\.body\.classList\.toggle\("nav-open"/,
  "mobile menu locks page scroll while open");
assert.match(main, /syncRevealFocus/,
  "hidden reveal links stay out of keyboard order");
assert.match(story, /syncStoryFocus/,
  "story timeline updates keyboard reachability");
assert.match(story, /var BEAT_IN = 0\.65, BEAT_OUT = 0\.25, HOLD = 1\.65;/,
  "story beat timings keep content visible between scroll acts");
assert.match(css, /body\.nav-open/,
  "mobile menu has scroll-lock CSS");
assert.match(css, /@media \(max-width: 360px\)[\s\S]*\.nav-cta/,
  "small-phone header has a compact CTA treatment");
