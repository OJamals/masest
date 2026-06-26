import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("content repository exposes revision list and restore contracts", () => {
  const source = readFileSync(new URL("../functions/_lib/content.js", import.meta.url), "utf8");
  assert.match(source, /async listRevisions\(/);
  assert.match(source, /async restoreRevision\(/);
  assert.match(source, /content_revisions/);
  assert.match(source, /Restored revision/);
});

test("admin revision endpoint is staff gated and write-gated for restore", () => {
  const source = readFileSync(new URL("../functions/api/admin/content-revisions.js", import.meta.url), "utf8");
  assert.match(source, /requireStaff/);
  assert.match(source, /createContentRepository/);
  assert.match(source, /request\.method === "GET"/);
  assert.match(source, /request\.method === "POST"/);
  assert.match(source, /staffCan\(role, "content\.write"\)/);
});

test("content editor renders revision history and restore controls", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /contentRevisionList/);
  assert.match(source, /data-content-revision/);
  assert.match(source, /restoreRevision/);
  assert.match(source, /\/api\/admin\/content-revisions/);
});
