import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('shared dialogs explicitly restore focus after every close path', () => {
  const util = read('js/util.js');
  assert.match(util, /export const restoreFocusOnClose/);
  assert.match(util, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.equal((util.match(/document\.createElement\(['"]dialog['"]\)/g) || []).length, 2);
  assert.equal((util.match(/restoreFocusOnClose\(dlg\)/g) || []).length, 2);
});

for (const path of [
  'js/admin/newsletter.js',
  'js/admin/image-library-picker.js',
  'js/admin/quotes.js',
  'js/admin/companies.js',
  'js/admin/crm.js',
]) {
  test(`${path} restores focus for each custom dialog`, () => {
    const source = read(path);
    const dialogs = (source.match(/document\.createElement\(['"]dialog['"]\)/g) || []).length;
    const restorers = (source.match(/restoreFocusOnClose\(dlg(?:,\s*[^)]*)?\)/g) || []).length;
    assert.ok(dialogs > 0, `${path} should contain a custom dialog`);
    assert.equal(restorers, dialogs, `${path} must restore the invoker for every dialog`);
  });
}
