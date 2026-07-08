import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBlogEmail, postFromEntry, unsentPosts } from '../functions/_lib/blog-newsletter.js';
import { klaviyoListProfiles } from '../functions/_lib/klaviyo.js';
import { MARKETING_CATEGORIES, categoryStream } from '../functions/_lib/email.js';

test('blog_newsletter is a marketing category (suppression + unsub apply)', () => {
  assert.ok(MARKETING_CATEGORIES.has('blog_newsletter'));
  assert.equal(categoryStream('blog_newsletter'), 'marketing');
});

test('postFromEntry flattens a content_entries row', () => {
  const p = postFromEntry({ slug: 's', title: 'T', payload: { title: 'PT', excerpt: 'e', hero: 'img/blog/x.webp', category: 'news' } });
  assert.equal(p.slug, 's');
  assert.equal(p.title, 'PT'); // payload title wins
  assert.equal(p.excerpt, 'e');
  assert.equal(p.hero, 'img/blog/x.webp');
});

test('unsentPosts filters out already-sent slugs', () => {
  const posts = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
  assert.deepEqual(unsentPosts(posts, ['b']).map((p) => p.slug), ['a', 'c']);
  assert.deepEqual(unsentPosts(posts, []).map((p) => p.slug), ['a', 'b', 'c']);
});

test('renderBlogEmail: hero, title, excerpt, escaped CTA to the live post', () => {
  const { subject, html, url } = renderBlogEmail({
    slug: 'hmis-000-explained', title: 'What HMIS 0-0-0 Means', excerpt: 'Lower hazard.',
    hero: 'img/blog/hmis-000-explained.webp', hero_alt: 'HCR jug', category: 'technical',
    author: 'MASEST', date: '2026-07-01',
  });
  assert.equal(url, 'https://masest.co/blog/hmis-000-explained');
  assert.match(subject, /New from MASEST: What HMIS 0-0-0 Means/);
  assert.match(html, /https:\/\/masest\.co\/img\/blog\/hmis-000-explained\.webp/);
  assert.match(html, /What HMIS 0-0-0 Means/);
  assert.match(html, /Lower hazard\./);
  assert.match(html, /Read the full post/);
  assert.match(html, /href="https:\/\/masest\.co\/blog\/hmis-000-explained"/);
});

test('renderBlogEmail: escapes HTML in title/excerpt (no injection)', () => {
  const { html, subject } = renderBlogEmail({ slug: 'x', title: '<script>alert(1)</script>', excerpt: '<b>hi</b>' });
  assert.ok(!html.includes('<script>alert(1)'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/);
  assert.ok(subject.includes('<script>')); // subject is plain-text (Resend), not HTML
});

test('renderBlogEmail: no hero -> no img tag', () => {
  const { html } = renderBlogEmail({ slug: 'x', title: 'T', excerpt: 'e', hero: '' });
  assert.ok(!html.includes('<img'));
});

test('klaviyoListProfiles: paginates links.next, dedupes, lowercases', async () => {
  const pages = {
    'https://a.klaviyo.com/api/lists/L1/profiles/?page%5Bsize%5D=100': {
      ok: true, json: async () => ({ data: [{ attributes: { email: 'A@x.com' } }, { attributes: { email: 'b@x.com' } }], links: { next: 'https://a.klaviyo.com/next2' } }),
    },
    'https://a.klaviyo.com/next2': {
      ok: true, json: async () => ({ data: [{ attributes: { email: 'b@x.com' } }, { attributes: { email: 'c@x.com' } }], links: { next: null } }),
    },
  };
  const fetchImpl = async (url) => pages[url];
  const emails = await klaviyoListProfiles({ KLAVIYO_PRIVATE_KEY: 'k' }, 'L1', { fetchImpl });
  assert.deepEqual(emails, ['a@x.com', 'b@x.com', 'c@x.com']);
});

test('klaviyoListProfiles: no key -> [] (best-effort)', async () => {
  assert.deepEqual(await klaviyoListProfiles({}, 'L1'), []);
});

import { onRequestPost } from '../functions/api/admin/blog-newsletter.js';

const req = (secretHeader, body = {}) => ({
  headers: { get: (k) => (k === 'x-blog-newsletter-secret' ? secretHeader : null) },
  json: async () => body,
});

test('endpoint: 401 when no secret configured', async () => {
  const res = await onRequestPost({ request: req('anything'), env: {} });
  assert.equal(res.status, 401);
});

test('endpoint: 401 on wrong secret', async () => {
  const res = await onRequestPost({ request: req('wrong'), env: { BLOG_NEWSLETTER_SECRET: 'right' } });
  assert.equal(res.status, 401);
});

test('endpoint: 400 on bad action', async () => {
  const res = await onRequestPost({ request: req('right', { action: 'nope' }), env: { BLOG_NEWSLETTER_SECRET: 'right' } });
  assert.equal(res.status, 400);
});
