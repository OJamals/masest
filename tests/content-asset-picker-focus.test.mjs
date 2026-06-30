import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("CMS asset picker manages focus on open and close", () => {
  const js = read("js/admin/content.js");

  // remembers the control that opened the picker, to restore focus later
  assert.match(js, /assetPickerTrigger/, "should track the element that opened the asset picker");
  // opening reveals the panel and moves focus into it (the search field)
  assert.match(js, /\$\("contentAssetSearch"\)\?\.focus\(\)/, "opening the picker should move focus to the asset search field");
  // closing restores focus to the trigger so keyboard users are not dropped at the top
  assert.match(js, /function closeAssetPicker\(\)[\s\S]*?assetPickerTrigger\?\.focus\(\)/, "closing the picker should restore focus to the trigger");
});
