import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rootFile = (path, encoding) => readFileSync(new URL(`../${path}`, import.meta.url), encoding);
test('story controller swaps one persistent pair and preloads only the next scene', () => {
  const story = rootFile('js/story.js', 'utf8');
  assert.match(story, /var states = acts\.map/);
  assert.match(story, /config: sceneConfig\(act\)/);
  assert.match(story, /function activateState\(/);
  assert.match(story, /story\.dataset\.activeScene = st\.config\.id/);
  assert.match(story, /function activateSceneMedia\(/);
  assert.match(story, /Promise\.all\(\[/);
  assert.match(story, /function preloadNextScene\(/);
  assert.match(story, /var next = states\[st\.index \+ 1\]/);
  assert.match(story, /requestIdleCallback\(preload, \{ timeout: 1200 \}\)/);
  assert.match(story, /function renderStaticStory\(/);
  assert.doesNotMatch(story, /data-reel-src|loadStoryImage|loadReelSlide|loadAllStoryImages/);
  assert.doesNotMatch(story, /supabase\.co\/storage\/v1\/object/i);
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
