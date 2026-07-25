import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rootFile = (path, encoding) => readFileSync(new URL(`../${path}`, import.meta.url), encoding);

test('homepage requests only the initially visible story image during initial load', () => {
  const html = rootFile('index.html', 'utf8');
  const storyImage = (name) => html.match(new RegExp(`<img[^>]+(?:src|data-reel-src)="img/story/${name}\\.webp"[^>]*>`))?.[0] || '';

  assert.match(storyImage('scale'), /fetchpriority="high"/);
  for (const name of ['rust', 'grease', 'grime']) {
    assert.match(storyImage(name), /data-reel-src=/, `${name} should wait for the reel controller`);
    assert.doesNotMatch(storyImage(name), /\ssrc=|loading="eager"|fetchpriority="high"/);
  }
});

test('story controller hydrates deferred slides and preserves the fallback layout', () => {
  const story = rootFile('js/story.js', 'utf8');
  assert.match(story, /function loadStoryImage\(/);
  assert.match(story, /loadReelSlide\(current\)/);
  assert.match(story, /loadReelSlide\(current \+ 1\)/);
  assert.match(story, /loadAllStoryImages\(\)/);
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
