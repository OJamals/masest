import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(new URL("../tools/visual-css-guard.mjs", import.meta.url), "utf8");

test("visual guard cleanup closes its in-process static server", () => {
  assert.match(src, /createServer/);
  assert.match(src, /server\.close\(\)/);
  assert.match(src, /await\s+Promise\.race\(\[/);
});

test("visual guard no longer starts a child-process static server", () => {
  assert.doesNotMatch(src, /http\.server/);
});
