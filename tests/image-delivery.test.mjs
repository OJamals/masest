import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rootFile = (path, encoding) => readFileSync(new URL(`../${path}`, import.meta.url), encoding);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the homepage ships no oversized above-the-fold imagery', () => {
  const html = rootFile('index.html', 'utf8');
  // The homepage used to open with a 1200x1017 / 177KB photograph rendered into a 367x179
  // box -- the single biggest contributor to a 3.8s mobile LCP. The hero is text now, so the
  // contract is simply that no story media came back with it.
  assert.doesNotMatch(html, /img\/proof\/story\//, 'story media should not return to the homepage');
  assert.doesNotMatch(html, /data-before-src|data-after-src|data-product-src/);
  assert.doesNotMatch(html, /supabase\.co\/storage\/v1\/object/i);
});

test('the shared PNG favicon is delivery-sized', () => {
  const manifest = JSON.parse(rootFile('data/content/site-images.json', 'utf8'));
  const favicon = manifest.assets.find((asset) => asset.public_url === '/img/favicon-enhanced.png');
  assert.ok(favicon, 'favicon should remain registered in the CMS image ledger');
  assert.equal(favicon.mime_type, 'image/png');
  assert.equal(favicon.width, 64);
  assert.equal(favicon.height, 64);
  assert.ok(favicon.byte_size < 20_000, 'favicon should stay below 20 KB');
});
