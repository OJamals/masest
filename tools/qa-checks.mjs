import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../contact.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../js/main.js", import.meta.url), "utf8");
const chrome = readFileSync(new URL("../js/main/chrome.js", import.meta.url), "utf8");
const engagement = readFileSync(new URL("../js/main/engagement.js", import.meta.url), "utf8");
const story = readFileSync(new URL("../js/story.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");

assert.match(
  html,
  /<form\b[^>]*\bdata-endpoint="\/api\/quote"/,
  "quote form uses the site quote intake endpoint",
);
assert.match(engagement, /fetch\(\s*endpoint/, "quote form submit uses configured form action");
assert.match(
  chrome,
  /document\.body\.classList\.toggle\("nav-open"/,
  "mobile menu locks page scroll while open",
);
assert.match(story, /syncStoryFocus/, "story timeline updates keyboard reachability");
assert.match(
  story,
  /var BEAT_IN = 0\.58, BEAT_OUT = 0\.22, HOLD = 1\.25;/,
  "story timings keep deliberate holds between acts",
);
assert.match(
  story,
  /function storyStart\(\)\s*{\s*return "top " \+ stickyOffset\(\) \+ "px";\s*}[\s\S]*start:\s*storyStart/,
  "pinned scrollybook acts start at the visible top below the nav for every act",
);
assert.match(css, /body\.nav-open/, "mobile menu has scroll-lock CSS");
assert.match(
  css,
  /@media \(max-width: 360px\)[\s\S]*\.nav-cta/,
  "small-phone header has a compact CTA treatment",
);
