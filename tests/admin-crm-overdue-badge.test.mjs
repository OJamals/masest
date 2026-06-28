import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stats = readFileSync(new URL('../functions/api/admin/stats.js', import.meta.url), 'utf8');
const adminJs = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

// ── stats.js: overdue crm_tasks count ────────────────────────────────────────

test('stats.js counts overdue crm_tasks (table name present)', () => {
  assert.match(stats, /count\('crm_tasks'/);
});

test('stats.js crm_tasks count filters by status open', () => {
  assert.match(stats, /\.eq\('status',\s*'open'\)/);
});

test('stats.js crm_tasks count excludes null due_at', () => {
  assert.match(stats, /\.not\('due_at',\s*'is',\s*null\)/);
});

test('stats.js crm_tasks count filters due_at <= nowIso', () => {
  assert.match(stats, /\.lte\('due_at',\s*nowIso\)/);
});

test('stats.js destructures overdueTasks from Promise.all', () => {
  assert.match(stats, /overdueTasks,?\s*\]\s*=\s*await Promise\.all/);
});

// ── stats.js: response shape ──────────────────────────────────────────────────

test('stats.js exposes crm_tasks: { overdue } at top level', () => {
  assert.match(stats, /crm_tasks:\s*\{\s*overdue:\s*overdueTasks\s*\}/);
});

test('stats.js exposes tasks_overdue inside crm object', () => {
  assert.match(stats, /tasks_overdue:\s*overdueTasks/);
});

// ── admin.js: badge wiring ────────────────────────────────────────────────────

test('admin.js sets badge aBadgeCrm in renderStats', () => {
  assert.match(adminJs, /badge\('aBadgeCrm',/);
});

test('admin.js reads crm_tasks?.overdue for the CRM badge', () => {
  assert.match(adminJs, /stats\.crm_tasks\?\.overdue/);
});

test('admin.js has fallback path stats.crm?.tasks_overdue', () => {
  assert.match(adminJs, /stats\.crm\?\.tasks_overdue/);
});

// ── admin.html: pill element ──────────────────────────────────────────────────

test('admin.html has pill span with id aBadgeCrm', () => {
  assert.match(adminHtml, /id="aBadgeCrm"/);
});

test('admin.html aBadgeCrm pill is inside the data-tab="crm" button', () => {
  const crmButton = adminHtml.match(/<button[^>]*data-tab="crm"[^>]*>[\s\S]*?<\/button>/);
  assert.ok(crmButton, 'data-tab="crm" button not found');
  assert.match(crmButton[0], /id="aBadgeCrm"/);
});

test('admin.html aBadgeCrm pill has class pill and hidden attribute', () => {
  assert.match(adminHtml, /<span class="pill" id="aBadgeCrm" hidden>/);
});
