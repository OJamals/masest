import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('password recovery mode moves focus only when the visible pane changes', () => {
  const src = read('account.html');
  assert.match(src, /const modeChanged = targetPane\?\.hidden === true;/);
  assert.match(src, /if \(modeChanged\) requestAnimationFrame\(\(\) => \$\(on \? "newPassword" : "liEmail"\)\?\.focus\(\)\);/);
});

test('optional sample preferences retain an accessible group and hint', () => {
  const html = read('contact.html');
  const js = read('js/main/engagement.js');
  assert.match(html, /<fieldset class="field sample-fieldset" aria-describedby="sampleHint">/);
  assert.match(html, /id="sampleHint">Choose any products/);
  assert.doesNotMatch(js, /const minPicks/);
});

test('live preview does not announce the full document on every render', () => {
  const html = read('content-preview.html');
  assert.doesNotMatch(html, /id="contentPreviewRoot"[^>]*aria-live/);
});
