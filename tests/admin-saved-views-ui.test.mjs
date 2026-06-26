import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../js/admin/saved-views.js', import.meta.url), 'utf8');

test('persists per-tab under a namespaced localStorage key', () => {
  assert.match(src, /masest:adm:views:\$\{key\}/);
  assert.match(src, /localStorage\.getItem/);
  assert.match(src, /localStorage\.setItem/);
});

test('injects the control once, like the view toggle', () => {
  assert.match(src, /parentElement\.querySelector\('\.saved-views'\)\) return/);
  assert.match(src, /insertBefore\(box, anchorEl\)/);
});

test('control wires select-apply, save, delete', () => {
  assert.match(src, /data-sv-select/);
  assert.match(src, /data-sv-save/);
  assert.match(src, /data-sv-del/);
  assert.match(src, /applyFilters\(view\.filters\)/);
  assert.match(src, /upsertView\(read\(\), name, getFilters\(\)\)/);
  assert.match(src, /removeView\(read\(\), name\)/);
});

test('localStorage writes are guarded against quota / private mode', () => {
  assert.match(src, /try \{ localStorage\.setItem/);
});
