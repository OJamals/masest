import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/tasks.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/crm-task-digest-cron.example.sql', import.meta.url), 'utf8');

// ── sweep_due branch ──────────────────────────────────────────────────────────

test('tasks endpoint has a sweep_due action branch', () => {
  assert.match(src, /body\.action === 'sweep_due'/);
});

test('sweep_due is guarded by QUOTE_CRM_SECRET env var', () => {
  assert.match(src, /env\.QUOTE_CRM_SECRET/);
});

test('sweep_due checks the x-quote-crm-secret request header', () => {
  assert.match(src, /x-quote-crm-secret/);
});

test('sweep_due calls sweepDueTasks', () => {
  assert.match(src, /sweepDueTasks\(/);
});

test('sweep_due returns 200 on ok and 500 on error from sweepDueTasks', () => {
  assert.match(src, /result\.ok \? 200 : 500/);
});

// ── enrichLabels refactor ─────────────────────────────────────────────────────

test('enrichLabels is defined as a module-level async function', () => {
  assert.match(src, /async function enrichLabels\(/);
});

test('GET scope branch calls enrichLabels (no inline enrichment)', () => {
  assert.match(src, /await enrichLabels\(sb, tasks\)/);
});

test('sweepDueTasks also calls enrichLabels (shared enrichment)', () => {
  // Two call-sites: GET branch and sweepDueTasks
  const callCount = (src.match(/enrichLabels\(sb, tasks\)/g) || []).length;
  assert.ok(callCount >= 2, `expected at least 2 enrichLabels call sites, got ${callCount}`);
});

test('.from(companies) appears exactly once — no inline duplicate after refactor', () => {
  const count = (src.match(/\.from\('companies'\)/g) || []).length;
  assert.equal(count, 1, `.from('companies') should appear exactly once (inside enrichLabels), got ${count}`);
});

// ── sweepDueTasks is stateless ────────────────────────────────────────────────

test('sweepDueTasks does not call .update() on crm_tasks (stateless digest)', () => {
  const sweepStart = src.indexOf('async function sweepDueTasks');
  assert.ok(sweepStart > -1, 'sweepDueTasks not found');
  // Find the next top-level function declaration after sweepDueTasks to bound the body
  const nextFn = src.indexOf('\nexport async function ', sweepStart + 1);
  const sweepBody = nextFn > sweepStart ? src.slice(sweepStart, nextFn) : src.slice(sweepStart);
  assert.doesNotMatch(sweepBody, /\.update\(/);
});

test('sweepDueTasks returns needs_migration on missing table error', () => {
  assert.match(src, /needs_migration: true/);
  assert.match(src, /does not exist\|relation\|schema cache/);
});

test('sweepDueTasks uses crm_task_digest email category', () => {
  assert.match(src, /crm_task_digest/);
});

test('sweep email CTA links to the admin CRM tab', () => {
  assert.match(src, /admin\.html#crm/);
});

test('all task-derived text in the email is passed through htmlEscape', () => {
  // Verify htmlEscape is imported and used in the email body construction
  assert.match(src, /htmlEscape/);
  // t.title and t.subject_type are escaped
  assert.match(src, /htmlEscape\(t\.title\)/);
  assert.match(src, /htmlEscape\(t\.subject_type\)/);
});

// ── cron SQL template ─────────────────────────────────────────────────────────

test('cron template enables pg_cron and pg_net extensions', () => {
  assert.match(sql, /create extension if not exists pg_cron/);
  assert.match(sql, /create extension if not exists pg_net/);
});

test('cron template unschedules crm-task-digest idempotently', () => {
  assert.match(sql, /cron\.unschedule\('crm-task-digest'\)/);
  assert.match(sql, /jobname = 'crm-task-digest'/);
});

test('cron schedules crm-task-digest daily at 13:00 UTC', () => {
  assert.match(sql, /cron\.schedule\(\s*'crm-task-digest',\s*'0 13 \* \* \*'/);
});

test('cron posts to the correct tasks endpoint URL', () => {
  assert.match(sql, /url := 'https:\/\/masest\.co\/api\/admin\/crm\/tasks'/);
});

test('cron sends the x-quote-crm-secret header (reuses quote secret)', () => {
  assert.match(sql, /'x-quote-crm-secret', '<QUOTE_CRM_SECRET>'/);
});

test('cron body matches the action contract the endpoint verifies', () => {
  assert.match(sql, /'action', 'sweep_due'/);
  // Confirm endpoint still checks the same action string
  assert.match(src, /body\.action === 'sweep_due'/);
});
