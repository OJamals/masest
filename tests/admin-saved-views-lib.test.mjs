import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeViews, upsertView, removeView, findView } from '../js/admin/saved-views.js';

test('sanitizeViews drops junk + normalizes shape', () => {
  assert.deepEqual(sanitizeViews(null), []);
  assert.deepEqual(sanitizeViews([{ name: '  ' }, { name: 'Hot', filters: { status: 'new' } }, 7]),
    [{ name: 'Hot', filters: { status: 'new' } }]);
  // missing/invalid filters -> {}
  assert.deepEqual(sanitizeViews([{ name: 'X' }]), [{ name: 'X', filters: {} }]);
});

test('upsertView adds, replaces case-insensitively, sorts', () => {
  let v = upsertView([], 'My Leads', { status: 'new' });
  assert.deepEqual(v, [{ name: 'My Leads', filters: { status: 'new' } }]);
  v = upsertView(v, 'Closed', { status: 'closed' });
  assert.deepEqual(v.map((x) => x.name), ['Closed', 'My Leads']); // sorted
  v = upsertView(v, 'my leads', { status: 'qualified' }); // same name diff case -> replace
  assert.equal(v.filter((x) => x.name.toLowerCase() === 'my leads').length, 1);
  assert.equal(findView(v, 'My Leads').filters.status, 'qualified');
});

test('upsertView ignores blank names', () => {
  assert.deepEqual(upsertView([{ name: 'A', filters: {} }], '   ', { x: 1 }), [{ name: 'A', filters: {} }]);
});

test('removeView + findView are case-insensitive', () => {
  const v = [{ name: 'Hot', filters: {} }, { name: 'Cold', filters: {} }];
  assert.deepEqual(removeView(v, 'hot').map((x) => x.name), ['Cold']);
  assert.equal(findView(v, 'COLD').name, 'Cold');
  assert.equal(findView(v, 'nope'), null);
});
