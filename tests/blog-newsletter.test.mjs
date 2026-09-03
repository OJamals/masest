import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBlogEmail, postFromEntry, unsentPosts } from '../functions/_lib/blog-newsletter.js';
import { loadMarketingAudience } from '../functions/_lib/marketing-subscribers.js';
import { MARKETING_CATEGORIES, categoryStream } from '../functions/_lib/email.js';

test('blog_newsletter is a marketing category (suppression + unsub apply)', () => {
  assert.ok(MARKETING_CATEGORIES.has('blog_newsletter'));
  assert.equal(categoryStream('blog_newsletter'), 'marketing');
});

test('postFromEntry flattens a content_entries row', () => {
  const p = postFromEntry({ slug: 's', title: 'T', payload: { title: 'PT', excerpt: 'e', hero: 'img/blog/x.webp', hero_width: 1440, hero_height: 811, category: 'news' } });
  assert.equal(p.slug, 's');
  assert.equal(p.title, 'PT'); // payload title wins
  assert.equal(p.excerpt, 'e');
  assert.equal(p.hero, 'img/blog/x.webp');
  assert.equal(p.hero_width, 1440);
  assert.equal(p.hero_height, 811);
});

test('unsentPosts filters out already-sent slugs', () => {
  const posts = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
  assert.deepEqual(unsentPosts(posts, ['b']).map((p) => p.slug), ['a', 'c']);
  assert.deepEqual(unsentPosts(posts, []).map((p) => p.slug), ['a', 'b', 'c']);
});

test('renderBlogEmail: hero, title, excerpt, escaped CTA to the live post', () => {
  const { subject, html, text, url } = renderBlogEmail({
    slug: 'hmis-000-explained', title: 'What HMIS 0-0-0 Means', excerpt: 'Lower hazard.',
    hero: 'img/blog/hmis-000-explained.webp', hero_alt: 'HCR jug', category: 'technical',
    hero_width: 1440, hero_height: 811,
    author: 'MASEST', date: '2026-07-01',
  });
  assert.equal(url, 'https://masest.co/blog/hmis-000-explained');
  assert.match(subject, /New from MASEST: What HMIS 0-0-0 Means/);
  assert.match(html, /https:\/\/media\.masest\.co\/site\/img\/blog\/hmis-000-explained\.webp/);
  assert.match(html, /hmis-000-explained\.webp" width="600" height="338"/);
  assert.match(html, /What HMIS 0-0-0 Means/);
  assert.match(html, /Lower hazard\./);
  assert.match(html, /Read the full post/);
  assert.match(html, /href="https:\/\/masest\.co\/blog\/hmis-000-explained"/);
  assert.match(html, /\{\{unsubscribe_url\}\}/);
  assert.match(html, /1361 Grand Cayman Dr/);
  assert.match(text, /Read the full post: https:\/\/masest\.co\/blog\/hmis-000-explained/);
});

test('renderBlogEmail: escapes HTML in title/excerpt (no injection)', () => {
  const { html, subject } = renderBlogEmail({ slug: 'x', title: '<script>alert(1)</script>', excerpt: '<b>hi</b>' });
  assert.ok(!html.includes('<script>alert(1)'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/);
  assert.ok(subject.includes('<script>')); // subject is plain text, not HTML
});

test('renderBlogEmail: no hero keeps shared R2 header and footer logos only', () => {
  const { html } = renderBlogEmail({ slug: 'x', title: 'T', excerpt: 'e', hero: '' });
  const images = html.match(/<img\b[^>]*>/g) || [];
  assert.equal(images.length, 2);
  assert.ok(images.every((image) => /https:\/\/media\.masest\.co\/site\/img\/masest-logo\.png/.test(image)));
});

test('loadMarketingAudience paginates, dedupes, and lowercases', async () => {
  const pages = [
    [{ email: 'A@x.com' }, { email: 'b@x.com' }],
    [{ email: 'b@x.com' }, { email: 'c@x.com' }],
    [],
  ];
  const sb = {
    from: () => ({ select: () => ({ eq: () => ({
      range: async (start) => ({ data: pages[start / 2], error: null }),
    }) }) }),
  };
  const emails = await loadMarketingAudience(sb, { pageSize: 2 });
  assert.deepEqual(emails, ['a@x.com', 'b@x.com', 'c@x.com']);
});

test('loadMarketingAudience fails closed on DB errors', async () => {
  const sb = {
    from: () => ({ select: () => ({ eq: () => ({
      range: async () => ({ data: null, error: new Error('db_down') }),
    }) }) }),
  };
  await assert.rejects(loadMarketingAudience(sb), /marketing_audience_unavailable/);
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
