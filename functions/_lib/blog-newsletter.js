// Blog newsletter: render the "new post" email + pure helpers for the send sweep.
// Sending itself goes through _lib/supabase.js sendEmail (per-recipient), which
// handles suppression, per-recipient List-Unsubscribe, and email_event logging.
import { emailLayout, htmlEscape } from './supabase.js';

const BASE = 'https://masest.co';

// Normalize a published content_entries blog_post row into a flat post object.
export function postFromEntry(row = {}) {
  const p = row && typeof row.payload === 'object' && row.payload ? row.payload : {};
  return {
    slug: String(row.slug || ''),
    title: String(p.title || row.title || ''),
    excerpt: String(p.excerpt || ''),
    hero: String(p.hero || ''),
    hero_alt: String(p.hero_alt || ''),
    category: String(p.category || ''),
    author: String(p.author || ''),
    date: String(p.date || ''),
  };
}

// Published posts not yet recorded as sent (dedup guard). Pure.
export function unsentPosts(posts, sentSlugs) {
  const sent = new Set(sentSlugs || []);
  return (posts || []).filter((p) => p && p.slug && !sent.has(p.slug));
}

// Branded "new blog post" email: hero, eyebrow, title, byline, excerpt, CTA to the
// live post. Returns { subject, html, url }. All interpolated fields are escaped.
export function renderBlogEmail(post = {}) {
  const slug = String(post.slug || '');
  const title = String(post.title || 'New from the VertKlean Briefing');
  const excerpt = String(post.excerpt || '');
  const category = String(post.category || '');
  const author = String(post.author || '');
  const date = String(post.date || '');
  const url = `${BASE}/blog/${slug}`;
  const heroPath = String(post.hero || '').replace(/^\/+/, '');
  const hero = heroPath
    ? `<img src="${htmlEscape(`${BASE}/${heroPath}`)}" alt="${htmlEscape(post.hero_alt || title)}" width="524" style="width:100%;max-width:524px;height:auto;border-radius:10px;margin:0 0 18px;display:block">`
    : '';
  const eyebrow = category
    ? `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0e7c86;font-weight:700;margin:0 0 6px">${htmlEscape(category)}</div>`
    : '';
  const byline = [author, date].filter(Boolean).map((s) => htmlEscape(s)).join(' &middot; ');
  const bodyHtml = `${hero}${eyebrow}`
    + `${byline ? `<div style="color:#667;font-size:13px;margin:0 0 14px">${byline}</div>` : ''}`
    + `<p style="margin:0 0 8px">${htmlEscape(excerpt)}</p>`;
  const html = emailLayout({
    heading: htmlEscape(title),
    bodyHtml,
    ctaText: 'Read the full post',
    ctaUrl: url,
  });
  return { subject: `New from MASEST: ${title}`.slice(0, 180), html, url };
}
