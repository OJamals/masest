import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rootFile = (path, encoding) => readFileSync(new URL(`../${path}`, import.meta.url), encoding);

test('homepage prioritizes the initial field frame while preserving later scene assets', () => {
  const html = rootFile('index.html', 'utf8');
  const storyImage = (src) => html.match(new RegExp(`<img[^>]+src="${src.replaceAll('/', '\\/')}"[^>]*>`))?.[0] || '';
  const before = storyImage('img/blog/cases/hcr-brevard-before.webp');
  const after = storyImage('img/blog/cases/hcr-brevard-after.webp');
  const product = storyImage('img/updates/vertkleen-hvac-hcr-5gal.webp');

  assert.match(before, /fetchpriority="high"/);
  for (const [name, image] of [['before', before], ['after', after], ['product', product]]) {
    assert.ok(image, `${name} story asset should remain in the persistent visual object`);
    assert.match(image, /decoding="async"/);
    assert.match(image, /width="\d+" height="\d+"/);
  }
  assert.doesNotMatch(after, /loading="eager"|fetchpriority="high"/);
  assert.doesNotMatch(product, /loading="eager"|fetchpriority="high"/);
});

test('story controller updates persistent scene state without image-source churn', () => {
  const story = rootFile('js/story.js', 'utf8');
  assert.match(story, /var SCENE_DEFS = \[/);
  assert.match(story, /function activateState\(/);
  assert.match(story, /story\.dataset\.activeScene = st\.sceneDef\.id/);
  assert.match(story, /function renderStaticStory\(/);
  assert.doesNotMatch(story, /data-reel-src|loadStoryImage|loadReelSlide|loadAllStoryImages/);
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
