import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('newsletter recipient controls include row-specific accessible names', () => {
  const src = read('js/admin/newsletter.js');
  assert.match(src, /aria-label="Include \$\{esc\(r\.email\)\} in newsletters"/);
  assert.match(src, /aria-label="Remove \$\{esc\(r\.email\)\} from imported recipients"/);
});

test('company member controls include member-specific accessible names', () => {
  const src = read('js/admin/companies.js');
  assert.match(src, /aria-label="Role for \$\{memberLabel\}"/);
  assert.match(src, /aria-label="Remove \$\{memberLabel\} from company"/);
});

test('admin table links retain a visible keyboard focus indicator', () => {
  const src = read('admin.html');
  const rule = src.match(/\.adm-main table\.adm \.link-name:focus-visible\s*\{[^}]*\}/s)?.[0] || '';
  assert.match(rule, /box-shadow:\s*0 0 0 3px var\(--accent-soft\)/);
});
