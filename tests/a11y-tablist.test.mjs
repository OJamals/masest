// a11y (#33): WAI-ARIA tablist keyboard pattern + live status regions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { nextTabIndex } from '../js/util.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- nextTabIndex (roving focus math) ----
test('nextTabIndex moves forward/back and wraps', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 3), 1);
  assert.equal(nextTabIndex('ArrowRight', 2, 3), 0);
  assert.equal(nextTabIndex('ArrowDown', 1, 3), 2);
  assert.equal(nextTabIndex('ArrowLeft', 0, 3), 2);
  assert.equal(nextTabIndex('ArrowUp', 2, 3), 1);
});

test('nextTabIndex Home/End jump to the ends', () => {
  assert.equal(nextTabIndex('Home', 2, 3), 0);
  assert.equal(nextTabIndex('End', 0, 3), 2);
});

test('nextTabIndex returns -1 for keys it does not handle', () => {
  assert.equal(nextTabIndex('Enter', 0, 3), -1);
  assert.equal(nextTabIndex(' ', 1, 3), -1);
  assert.equal(nextTabIndex('x', 1, 3), -1);
});

// ---- util helpers ----
test('util exposes wireTablist + rovingTabindex with key handling', () => {
  const src = read('js/util.js');
  assert.match(src, /export const wireTablist/);
  assert.match(src, /export const rovingTabindex/);
  assert.match(src, /export const linkTabsToPanels/);
  assert.match(src, /aria-controls/);
  assert.match(src, /aria-labelledby/);
  assert.match(src, /preventDefault\(\)/, 'arrow keys must not scroll the page');
});

// ---- both dashboards wire the pattern ----
test('admin + dashboard wire the tablist keyboard pattern + roving tabindex', () => {
  for (const p of ['js/admin.js', 'js/dashboard.js']) {
    const src = read(p);
    assert.match(src, /import\s*\{[^}]*wireTablist[^}]*\}\s*from\s*['"]\.\/util\.js['"]/, `${p} must import the helper`);
    assert.match(src, /wireTablist\(/, `${p} must wire keyboard nav`);
    assert.match(src, /rovingTabindex\(/, `${p} must apply roving tabindex on tab change`);
    assert.match(src, /linkTabsToPanels\(/, `${p} must connect tabs to their panels`);
  }
});

// ---- live status regions ----
test('admin status regions announce updates (aria-live)', () => {
  const html = read('admin.html');
  for (const id of ['gateStatus', 'ordStatus', 'prodStatus', 'qStatus', 'offerStatus']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-live="polite"`), `${id} must be aria-live`);
  }
});
