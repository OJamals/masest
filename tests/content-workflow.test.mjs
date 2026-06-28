import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("content schema supports review, changes, scheduled, and locks", () => {
  const sql = readFileSync(new URL("../supabase/schema-content.sql", import.meta.url), "utf8");
  assert.match(sql, /in_review/);
  assert.match(sql, /changes_requested/);
  assert.match(sql, /scheduled/);
  assert.match(sql, /scheduled_at/);
  assert.match(sql, /locked_by/);
  assert.match(sql, /locked_at/);
});

test("content API exposes workflow actions with publish and review permissions", () => {
  const source = readFileSync(new URL("../functions/api/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /action === "submit_review"/);
  assert.match(source, /action === "request_changes"/);
  assert.match(source, /action === "schedule"/);
  assert.match(source, /action === "publish_scheduled"/);
  assert.match(source, /action === "lock"/);
  assert.match(source, /action === "unlock"/);
  assert.match(source, /action === "force_unlock"/);
  assert.match(source, /scheduled_at_required/);
  assert.match(source, /publishScheduledDue/);
  assert.match(source, /body\.note \|\| "Submitted for review"/);
  assert.match(source, /body\.note \|\| "Scheduled publish"/);
  assert.match(source, /staffCan\(role, "content\.review"\)/);
  assert.match(source, /staffCan\(role, "content\.publish"\)/);
  assert.match(source, /result\.error === "content_locked" \? 409/);
});

test("content repository enforces active editorial locks", () => {
  const source = readFileSync(new URL("../functions/_lib/content.js", import.meta.url), "utf8");
  assert.match(source, /CONTENT_LOCK_TTL_MS/);
  assert.match(source, /activeContentLock/);
  assert.match(source, /contentLockConflict/);
  assert.match(source, /error:\s*"content_locked"/);
  assert.match(source, /async lock\(/);
  assert.match(source, /async unlock\(/);
  assert.match(source, /this\.publish\(entry, userId, \{ force: true \}\)/);
});

test("content editor surfaces workflow queues and actions", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /contentWorkflowQueue/);
  assert.match(source, /workflowEntries/);
  assert.match(source, /status:\s*"all"/);
  assert.match(source, /data-content-workflow/);
  assert.match(source, /data-content-action="publish_scheduled"/);
  assert.match(source, /contentWorkflowNote/);
  assert.match(source, /publishScheduledContent/);
  assert.match(source, /body:\s*\{\s*action,\s*note,\s*entry\s*\}/);
  assert.match(source, /Submit for review/);
  assert.match(source, /Schedule publish/);
  assert.match(source, /Publish due scheduled/);
  assert.match(source, /contentLockStatus/);
  assert.match(source, /data-content-action="lock"/);
  assert.match(source, /data-content-action="unlock"/);
  assert.match(source, /data-content-action="force_unlock"/);
  assert.match(source, /editorBlockedByLock/);
  assert.match(source, /updateContentLock/);
});
