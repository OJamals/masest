// Styled confirm dialog (#31): replace jarring native confirm() with an accessible modal.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  const src = read('js/admin.js');
  assert.doesNotMatch(src, /\bconfirm\(/, 'no native confirm() calls remain');
  assert.match(src, /await confirmDialog\(/, 'must await the styled dialog');
  assert.match(src, /import\s*\{[^}]*confirmDialog[^}]*\}\s*from\s*['"]\.\/util\.js['"]/, 'must import confirmDialog');
});
