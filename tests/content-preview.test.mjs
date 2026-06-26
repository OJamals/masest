import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("content preview shell listens for admin postMessage payloads", () => {
  const html = readFileSync(new URL("../content-preview.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../js/content-preview.js", import.meta.url), "utf8");
  assert.match(html, /id="contentPreviewRoot"/);
  assert.match(html, /css\/style\.css/);
  assert.match(html, /js\/content-preview\.js/);
  assert.match(js, /addEventListener\("message"/);
  assert.match(js, /masest:content-preview/);
  assert.match(js, /renderPreview/);
});

test("admin content editor owns a preview iframe and sends draft payloads", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /contentPreviewFrame/);
  assert.match(source, /postMessage/);
  assert.match(source, /masest:content-preview/);
  assert.match(source, /refreshPreview/);
});
