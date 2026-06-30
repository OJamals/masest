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
  assert.match(source, /data-content-action="draft"[\s\S]*data-content-action="publish"/);
  assert.match(source, /data-content-workflow="submit_review"[\s\S]*data-content-workflow="schedule"[\s\S]*data-content-workflow="request_changes"/);
  assert.match(source, /data-content-action="new"[\s\S]*data-content-action="duplicate"[\s\S]*data-content-action="archive"/);
});

test("content action groups have mobile-safe wrapping styles", () => {
  const html = read("admin.html");

  assert.match(html, /\.adm-content-actions \{ display: grid/);
  assert.match(html, /\.adm-content-action-group \{ display: flex; flex-wrap: wrap/);
  assert.match(html, /\.adm-content-action-group\[data-content-action-group="draft-publish"\]/);
  assert.match(html, /@media \(max-width: 720px\)[\s\S]*\.adm-content-action-group \.btn \{ flex: 1 1 145px; justify-content: center; \}/);
});
