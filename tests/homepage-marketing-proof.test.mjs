import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'parse5';

const root = new URL('../', import.meta.url);
const home = readFileSync(new URL('index.html', root), 'utf8');
const privateLabel = readFileSync(new URL('private-label.html', root), 'utf8');
const elements = [];
function walk(node) {
  if (node.tagName) elements.push(node);
  for (const child of node.childNodes || []) walk(child);
}
const attr = (node, key) => node.attrs?.find(a => a.name === key)?.value;

test('both landing pages have semantic labels and valid local destinations', () => {
  for (const html of [home, privateLabel]) {
    elements.length = 0;
    walk(parse(html));
    const ids = new Set(elements.map(n => attr(n, 'id')).filter(Boolean));
    assert.equal(elements.filter(n => n.tagName === 'h1').length, 1);
    assert.equal(ids.size, elements.filter(n => attr(n, 'id')).length);
    for (const n of elements) {
      for (const id of (attr(n, 'aria-labelledby') || '').split(/\s+/).filter(Boolean)) assert.ok(ids.has(id), id);
      if (n.tagName !== 'a') continue;
      const href = attr(n, 'href');
      if (href.startsWith('#')) { assert.ok(ids.has(href.slice(1)), href); continue; }
      const url = new URL(href, 'https://masest.co/');
      if (url.origin !== 'https://masest.co') continue;
      const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      assert.ok([path, path + '.html', path + '/index.html'].some(p => existsSync(new URL(p, root))), href);
    }
  }
});

test('homepage presents product selection before scoped field evidence and technical guidance', () => {
  assert.ok(home.indexOf('id="find-cleaner"') < home.indexOf('id="results"'));
  assert.ok(home.indexOf('id="results"') < home.indexOf('id="support"'));
  assert.match(home, /36-hour CLR attempt.*30 minutes/s);
  assert.match(home, /One documented job\. Results depend/);
  assert.match(home, /href="blog\/hcr-brevard-hvac-rust-case-study"/);
  assert.match(home, /href="industries\/hvac-water"/);
  assert.match(home, /href="resources"/);
  assert.doesNotMatch(home + privateLabel, /non-toxic|safe for all|water-based|Purgo N|Fusion/);
});

test('hero delivery stays small while field photographs remain lazy and labeled', () => {
  elements.length = 0;
  walk(parse(home));
  const images = elements.filter(n => n.tagName === 'img');
  assert.equal(images.length, 19);
  for (const img of images) {
    assert.ok(attr(img, 'alt'));
    assert.ok(Number(attr(img, 'width')) > 0 && Number(attr(img, 'height')) > 0);
    assert.ok(existsSync(new URL(attr(img, 'src'), root)));
  }
  assert.match(attr(images[0], 'alt'), /illustration/);
  assert.equal(attr(images[0], 'fetchpriority'), 'high');
  assert.ok(statSync(new URL(attr(images[0], 'src'), root)).size < 250000);
  for (const img of images.slice(1)) assert.equal(attr(img, 'loading'), 'lazy');
});
