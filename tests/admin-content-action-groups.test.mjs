import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("content editor groups normal, review, and management actions", () => {
  const source = read("js/admin/content.js");

  assert.match(source, /aria-label="CMS editor actions"/);
  assert.match(source, /data-content-action-group="draft-publish"/);
  assert.match(source, /aria-label="Draft and publish"/);
  assert.match(source, /data-content-action-group="review"/);
  assert.match(source, /aria-label="Review workflow"/);
  assert.match(source, /data-content-action-group="manage"/);
  assert.match(source, /aria-label="Manage entry"/);
  // Primary row: Save / Publish / Schedule together. The review workflow
  // (submit_review / request_changes) is demoted into the closed multi-editor
  // disclosure — it's owner-only under current authz, so it must not crowd the
  // main action row.
  assert.match(source, /data-content-action="draft"[\s\S]*data-content-action="publish"[\s\S]*data-content-workflow="schedule"/);
  assert.match(source, /> Publish to CMS</);
  assert.match(source, /Schedule CMS publish/);
  assert.match(source, /Publication status:[\s\S]*public site changes after the static rebuild completes/);
  assert.match(source, /adm-content-disclosure[\s\S]*data-content-workflow="submit_review"[\s\S]*data-content-workflow="request_changes"/);
  assert.doesNotMatch(source, /<details class="adm-content-disclosure full" open>/, "multi-editor tools disclosure starts closed");
  assert.match(source, /data-content-action="new"[\s\S]*data-content-action="duplicate"[\s\S]*data-content-action="archive"/);
});

test("content action groups have mobile-safe wrapping styles", () => {
  const html = read("admin.html");

  assert.match(html, /\.adm-content-actions \{ display: grid/);
  assert.match(html, /\.adm-content-action-group \{ display: flex; flex-wrap: wrap/);
  assert.match(html, /\.adm-content-action-group\[data-content-action-group="draft-publish"\]/);
  assert.match(html, /@media \(max-width: 720px\)[\s\S]*\.adm-content-action-group \.btn \{ flex: 1 1 145px; justify-content: center; \}/);
});

test("content selectors and asset viewer controls keep readable widths", () => {
  const html = read("admin.html");
  const source = read("js/admin/content.js");

  assert.match(source, /<label class="adm-content-selector">Content area/);
  assert.doesNotMatch(source, /<label class="adm-content-selector">Language/);
  assert.match(html, /\.adm-content-selector \{ grid-column: span 3; \}/);
  assert.match(html, /#contentType \{ min-width: min\(100%, 224px\); \}/);
  assert.match(html, /#contentLocale \{ min-width: 112px; \}/);
  assert.match(source, /data-content-action="open_asset_viewer"/);
  assert.match(html, /\.adm-content-open-assets \{[^}]*width: 100%[^}]*min-height: 48px/);
  assert.doesNotMatch(source, /contentAssetRows/);
});

test("blog editor exposes formatting and reference insertion controls", () => {
  const editor = read("js/admin/rich-editor.js");
  const content = read("js/admin/content.js");
  const newsletter = read("js/admin/newsletter.js");

  assert.match(editor, /data-editor-action="format_bold"/);
  assert.match(editor, /data-editor-action="format_italic"/);
  assert.match(editor, /data-editor-action="format_underline"/);
  assert.match(editor, /data-editor-action="format_size"/);
  assert.match(editor, /data-editor-action="format_color"/);
  assert.match(editor, /data-editor-action="insert_image"/);
  assert.match(editor, /data-editor-action="open_reference"/);
  assert.match(editor, /productReferenceGroups/);
  assert.match(editor, /Choose a product, service, or program/);
  assert.match(editor, /data-editor-reference-md/);
  assert.match(editor, /contenteditable="true"/);
  assert.match(editor, /data-editor-action="format_bold" aria-label="Bold" title="Bold"/);
  assert.match(editor, /contenteditable="true" role="textbox" aria-multiline="true" aria-label=/);
  assert.match(editor, /htmlToMarkdown/);
  assert.match(editor, /markdownToEditorHtml/);
  assert.match(editor, /data-rich-editor-surface/);
  assert.match(editor, /data-rich-editor-output/);
  assert.match(editor, /createRichTextEditor/);
  assert.match(content, /createRichTextEditor/);
  assert.match(newsletter, /createRichTextEditor/);
});
