import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { shouldReplaceCandidate } from '../tools/optimize-site-images.mjs';

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
  const png = rootFile('img/favicon-enhanced.png');
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.equal(png.readUInt32BE(16), 64, 'favicon width should be 64px');
  assert.equal(png.readUInt32BE(20), 64, 'favicon height should be 64px');
  assert.ok(png.byteLength < 20_000, 'favicon should stay below 20 KB');
});

test('image optimization requires meaningful, high-quality byte savings', () => {
  assert.equal(shouldReplaceCandidate({
    originalBytes: 100_000,
    optimizedBytes: 80_000,
    ssimDb: 18.4,
  }), true);

  assert.equal(shouldReplaceCandidate({
    originalBytes: 100_000,
    optimizedBytes: 99_000,
    ssimDb: 24,
  }), false, 'sub-2% savings do not justify generation loss');

  assert.equal(shouldReplaceCandidate({
    originalBytes: 100_000,
    optimizedBytes: 80_000,
    ssimDb: 17.9,
  }), false, 'low-SSIM candidates retain the source');

  assert.equal(shouldReplaceCandidate({
    originalBytes: 100_000,
    optimizedBytes: 110_000,
    ssimDb: 30,
  }), false, 'larger candidates retain the source');
});
