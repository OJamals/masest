// Event delegation on the admin table containers (#36 acceptance item 2).
// Row actions used to be re-bound on every innerHTML render (one addEventListener
// per row, per render). They are now bound ONCE on each stable tab container via the
// shared delegate() helper, and wired from admin.js wire() at boot.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('util exposes a delegate() helper built on closest + a single container listener', () => {
  const util = read('js/util.js');
  assert.match(util, /export const delegate\b/, 'delegate must be exported');
  assert.match(util, /container\.addEventListener\(/, 'binds one listener on the container');
  assert.match(util, /event\.target\.closest\(selector\)/, 'dispatches to the nearest matching ancestor');
  assert.match(util, /container\.contains\(target\)/, 'ignores matches outside the container');
});

// Each tab module delegates its table-container row actions once, on the matching
// container, and exposes a wireX() that admin.js calls at boot.
const TABS = [
  { mod: 'orders', wire: 'wireOrders', container: 'admOrders' },
  { mod: 'companies', wire: 'wireCompanies', container: 'admCompanies' },
  { mod: 'products', wire: 'wireProducts', container: 'admProducts' },
  { mod: 'pricing', wire: 'wirePricing', container: 'admPricing' },
  { mod: 'quotes', wire: 'wireQuotes', container: 'admQuotes' },
  { mod: 'threads', wire: 'wireThreads', container: 'admThreads' },
];

for (const { mod, wire, container } of TABS) {
  test(`admin ${mod} tab delegates row actions on #${container} (bound once via ${wire})`, () => {
    const src = read(`js/admin/${mod}.js`);
    assert.match(src, /import \{[^}]*\bdelegate\b[^}]*\} from '\.\.\/util\.js'/, `${mod} must import delegate`);
    assert.match(src, new RegExp(`function ${wire}\\s*\\(`), `${mod} must define ${wire}`);
    assert.match(src, new RegExp(`const box = \\$\\('${container}'\\)`), `${wire} must target #${container}`);
    assert.match(src, /delegate\(box,/, `${mod} must bind row actions through delegate(box, ...)`);
    assert.match(src, new RegExp(`\\b${wire}\\b`), `${mod} must return ${wire}`);
  });
}

test('admin.js binds every tab\'s delegated row actions once in wire()', () => {
  const admin = read('js/admin.js');
  for (const { wire } of TABS) {
    assert.match(admin, new RegExp(`\\n\\s*${wire}\\(\\);`), `wire() must call ${wire}()`);
  }
});
