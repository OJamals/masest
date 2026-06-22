// Email resolution without O(all-users) listUsers (#35).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { emailsByIds, allUserEmails } from '../functions/_lib/supabase.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- emailsByIds: getUserById per unique id ----
test('emailsByIds resolves via getUserById for each unique id', async () => {
  const calls = [];
  const sb = { auth: { admin: { getUserById: async (id) => { calls.push(id); return { data: { user: { id, email: `${id}@x.com` } } }; } } } };
  const out = await emailsByIds(sb, ['a', 'b', 'a', null, '']);
  assert.deepEqual(out, { a: 'a@x.com', b: 'b@x.com' });
  assert.deepEqual(calls.sort(), ['a', 'b'], 'deduped, no blanks, one call per id');
});

test('emailsByIds skips failed/edge lookups and tolerates empty input', async () => {
  const sb = { auth: { admin: { getUserById: async (id) => { if (id === 'bad') throw new Error('nope'); return { data: { user: { id, email: `${id}@x.com` } } }; } } } };
  assert.deepEqual(await emailsByIds(sb, ['ok', 'bad']), { ok: 'ok@x.com' });
  assert.deepEqual(await emailsByIds(sb, []), {});
  assert.deepEqual(await emailsByIds(sb, null), {});
});

// ---- allUserEmails: paginated (no 1000-row truncation) ----
test('allUserEmails pages until a short page', async () => {
  const pages = {
    1: [{ id: 'p1', email: 'p1' }, { id: 'p2', email: 'p2' }],
    2: [{ id: 'p3', email: 'p3' }],
  };
  const seen = [];
  const sb = { auth: { admin: { listUsers: async ({ page }) => { seen.push(page); return { data: { users: pages[page] || [] } }; } } } };
  const map = await allUserEmails(sb, { pageSize: 2 });
  assert.equal(map.size, 3);
  assert.equal(map.get('p3'), 'p3');
  assert.deepEqual(seen, [1, 2], 'stops after the first short page');
});

// ---- call sites refactored off listUsers ----
test('companyEmails + admin/account email lookups use emailsByIds, not listUsers', () => {
  const sb = read('functions/_lib/supabase.js');
  assert.match(sb, /export async function emailsByIds/);
  assert.match(sb, /export async function allUserEmails/);
  // companyEmails must use the per-id helper now
  assert.match(sb, /companyEmails[\s\S]{0,800}emailsByIds\(/);
  for (const [path, helper] of [
    ['functions/api/account/team.js', /emailsByIds\(/],
    ['functions/api/admin/company.js', /emailsByIds\(/],
    ['functions/api/admin/offers.js', /emailsByIds\(/],
    ['functions/api/admin/customers.js', /allUserEmails\(/],
  ]) {
    const src = read(path);
    assert.match(src, helper, `${path} must use the new helper`);
    assert.doesNotMatch(src, /listUsers\(/, `${path} must not call listUsers directly`);
  }
});
