// Styled confirm dialog (#31): replace jarring native confirm() with an accessible modal.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('util exposes an accessible confirmDialog built on native <dialog>', () => {
  const src = read('js/util.js');
  assert.match(src, /export const confirmDialog/);
  assert.match(src, /showModal/, 'must use the native modal dialog (focus-trapped, Esc-dismissable)');
  assert.match(src, /textContent\s*=\s*message/, 'message set via textContent (no HTML injection)');
  assert.match(src, /returnValue/, 'resolves from the dialog returnValue');
});

test('admin.js uses confirmDialog instead of native confirm()', () => {
  // confirmDialog usage moved into the per-tab modules (#36 split); scan the whole admin surface.
  const dir = new URL('../js/admin/', import.meta.url);
  const all = read('js/admin.js') + readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(new URL(f, dir), 'utf8'))
    .join('\n');
  assert.doesNotMatch(all, /\bconfirm\(/, 'no native confirm() calls remain');
  assert.match(all, /await confirmDialog\(/, 'must await the styled dialog');
  assert.match(all, /import\s*\{[^}]*confirmDialog[^}]*\}\s*from\s*['"]\.\.?\/util\.js['"]/, 'must import confirmDialog');
});
