import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("CMS asset picker manages focus on open and close", () => {
  const js = read("js/admin/content.js") + read("js/admin/content-assets.js");

  // remembers the control that opened the picker, to restore focus later
  assert.match(js, /assetPickerTrigger/, "should track the element that opened the asset picker");
  // opening reveals the panel and sends focus into the modal viewer search
  assert.match(js, /autoOpenLibrary:\s*true/, "opening the picker should open the image viewer");
  assert.match(read("js/admin/image-library-picker.js"), /librarySearch\?\.focus\(\)/, "opening the viewer should focus its search field");
  // closing restores focus to the trigger so keyboard users are not dropped at the top
  assert.match(js, /function closeAssetPicker\(\)[\s\S]*?assetPickerTrigger\?\.focus\(\)/, "closing the picker should restore focus to the trigger");
});
