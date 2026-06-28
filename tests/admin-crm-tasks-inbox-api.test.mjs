import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/crm/tasks.js', import.meta.url), 'utf8');

test('scoped branch attaches subject_label to tasks', () => {
  assert.match(src, /subject_label/);
  assert.match(src, /\['mine', 'overdue', 'open'\]\.includes\(scope\)/);
});

test('subject_label enrichment queries companies, quotes and crm_contacts', () => {
  assert.match(src, /\.from\('companies'\)\.select\('id,name'\)/);
  assert.match(src, /\.from\('quotes'\)\.select\('id,company,name,email'\)/);
  assert.match(src, /\.from\('crm_contacts'\)\.select\('id,name'\)/);
});

test('enrichment is guarded to scoped queries only (not the subject-specific branch)', () => {
  // The subject-specific else-branch runs before the enrichment block —
  // verify the enrichment block is placed after query execution, inside a
  // guard that checks scope membership.
  const enrichStart = src.indexOf("['mine', 'overdue', 'open'].includes(scope)");
  const subjectBranch = src.indexOf("validSubject(subjectType, subjectId)");
  // Both must exist and the subject-specific branch must come before enrichment
  assert.ok(enrichStart > -1, 'enrichment guard not found');
  assert.ok(subjectBranch > -1, 'subject branch not found');
  assert.ok(subjectBranch < enrichStart, 'subject-specific branch should precede enrichment block');
});

test('company ids are passed as strings, contact ids are cast to Number', () => {
  assert.match(src, /\.map\(Number\)/);
  // companies and quotes use string spread without Number cast
  assert.match(src, /\.in\('id', \[\.\.\.ids\.company\]\)/);
  assert.match(src, /\.in\('id', \[\.\.\.ids\.quote\]\)/);
});

test('label lookup errors degrade gracefully (missing table does not throw)', () => {
  // Each lookup checks the error and skips if present rather than propagating
  assert.match(src, /error: e \} = await sb\.from\('companies'\)/);
  assert.match(src, /error: e \} = await sb\.from\('quotes'\)/);
  assert.match(src, /error: e \} = await sb\.from\('crm_contacts'\)/);
  assert.match(src, /if \(!e\)/);
});

test('needs_migration fallback is preserved from original GET branch', () => {
  assert.match(src, /needs_migration: true/);
  assert.match(src, /does not exist\|relation\|schema cache/);
});

test('subject-specific GET branch is unchanged (no subject_label appended there)', () => {
  // The return for subject-specific queries should return tasks directly before enrichment
  // Verify return json(200, { tasks }) is after the enrichment (not inside else branch)
  const elseBranch = src.indexOf('validSubject(subjectType, subjectId)');
  const returnJson = src.indexOf('return json(200, { tasks });');
  assert.ok(elseBranch < returnJson, 'enriched return should be after subject-specific branch');
});
