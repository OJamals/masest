import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'parse5';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const document = parse(html);
const elements = [];
function walk(node) {
  if (node.tagName) elements.push(node);
  for (const child of node.childNodes || []) walk(child);
}
walk(document);
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
const ids = new Map(elements.filter(n => attr(n, 'id')).map(n => [attr(n, 'id'), n]));
const links = elements.filter(n => n.tagName === 'a');
const section = id => ids.get(id);

test('landing content remains semantic and available without the scroll engine', () => {
  assert.equal(elements.filter(n => n.tagName === 'h1').length, 1);
  assert.equal(ids.size, elements.filter(n => attr(n, 'id')).length, 'unique IDs');
  for (const node of elements.filter(n => attr(n, 'aria-labelledby'))) {
    for (const id of attr(node, 'aria-labelledby').split(/\s+/)) assert.ok(ids.has(id), `label ${id} exists`);
  }
  const sources = elements.filter(n => n.tagName === 'script').map(n => attr(n, 'src') || '');
  assert.ok(!sources.some(src => /story|gsap|ScrollTrigger/.test(src)));
  assert.doesNotMatch(html, /class="[^"]*\breveal\b|data-act=|type="range"/);
  assert.match(html, /<noscript>[\s\S]*href="products"[\s\S]*href="cart"[\s\S]*<\/noscript>/);
});

test('all homepage destinations resolve to files or real local sections', () => {
  for (const link of links) {
    const href = attr(link, 'href');
    assert.ok(href && (attr(link, 'aria-label') || text(link).trim()), 'links have destinations and names');
    if (href.startsWith('#')) { assert.ok(ids.has(href.slice(1)), href); continue; }
    const url = new URL(href, 'https://masest.co/');
    if (url.origin !== 'https://masest.co') continue;
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    assert.ok([path, `${path}.html`, `${path}/index.html`].some(p => existsSync(new URL(p, root))), href);
  }
});

test('one cleaner finder retains every buyer category and a full catalog route', () => {
  const finder = text(section('find-cleaner'));
  assert.match(finder, /What needs to come off/);
  for (const category of ['descale', 'degrease', 'exterior', 'water']) {
    assert.ok(links.some(n => attr(n, 'href') === `products?category=${category}`));
  }
  assert.ok(links.some(n => attr(n, 'href') === 'products' && /All products/.test(text(n))));
  for (const product of ['hcr', 'lam3', 'alumibrite', 'torque']) {
    assert.ok(links.some(n => attr(n, 'href') === `products/${product}`), product);
  }
  for (const route of ['products?q=HVAC', 'products?q=CIP', 'products?category=marine']) {
    assert.ok(links.some(n => attr(n, 'href') === route), route);
  }
});

test('HMIS is prominent without expanding the rating into a non-toxic claim', () => {
  assert.match(text(ids.get('home-title').parentNode), /HMIS 0-0-0/);
  assert.doesNotMatch(text(document), /non[ -]?toxic|zero[- ]hazard|risk[- ]free/i);
  const terms = elements.filter(n => n.tagName === 'dt').map(text);
  const values = elements.filter(n => n.tagName === 'dd').map(text);
  assert.deepEqual(terms, ['Health', 'Flammability', 'Physical hazard']);
  assert.deepEqual(values, ['0', '0', '0']);
  assert.ok(links.some(n => attr(n, 'href') === 'blog/hmis-000-explained'));
  assert.ok(links.some(n => attr(n, 'href') === 'resources'));
});

test('cleaning and equipment claims retain their evidence and limits', () => {
  const proof = text(section('results'));
  assert.match(proof, /36-hour CLR attempt.*30 minutes/s);
  assert.match(proof, /One documented job.*Results depend/s);
  assert.ok(links.some(n => attr(n, 'href') === 'blog/hcr-brevard-hvac-rust-case-study'));
  assert.match(text(section('support')), /280 times less corrosion.*hydrochloric acid on steel under the test conditions/s);
  assert.ok(links.some(n => attr(n, 'href') === 'blog/descaling-without-acid'));
  assert.match(text(section('support')), /cleaning time, repeat passes, water, waste, and downtime/);
  assert.ok(links.some(n => attr(n, 'href') === 'programs#pilot'));
});

test('hero is prioritized while documentary proof images remain lazy and labeled', () => {
  const images = elements.filter(n => n.tagName === 'img');
  assert.equal(elements.filter(n => attr(n, 'class') === 'home-job').length, 8);
  assert.ok(images.length >= 16, 'job and industry images accompany the hero and proof');
  for (const image of images) {
    assert.ok(attr(image, 'alt'));
    assert.ok(Number(attr(image, 'width')) > 0 && Number(attr(image, 'height')) > 0);
    assert.ok(existsSync(new URL(attr(image, 'src'), root)));
  }
  assert.equal(attr(images[0], 'fetchpriority'), 'high');
  assert.match(attr(images[0], 'alt'), /Studio illustration/);
  assert.ok(statSync(new URL(attr(images[0], 'src'), root)).size < 250_000, 'hero delivery budget');
  for (const image of images.slice(1)) assert.equal(attr(image, 'loading'), 'lazy');
  assert.ok(images.some(image => /hcr-brevard-before/.test(attr(image, 'src'))));
  assert.ok(images.some(image => /hcr-brevard-after/.test(attr(image, 'src'))));
  assert.ok(!ids.has('science-title'));
  assert.doesNotMatch(text(section('find-cleaner')), /Specialty acid jobs/);
  assert.ok(!images.some(image => /acid-association-visual/.test(attr(image, 'src'))));
});

test('conversion paths and global reach remain available', () => {
  for (const href of ['contact?type=audit', 'contact?type=quote', 'products/hcr', 'proof']) {
    assert.ok(links.some(n => attr(n, 'href') === href), href);
  }
  assert.ok(links.some(n => attr(n, 'href') === 'about' && /50\+ countries/.test(text(n))));
  assert.match(html, /data-cms-page="home"/);
});
