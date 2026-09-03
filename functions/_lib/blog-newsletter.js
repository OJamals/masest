// Blog newsletter: render the "new post" email + pure helpers for the send sweep.
// Klaviyo owns consent, suppression, unsubscribe state, fanout, and delivery.
import { emailEscape } from './email-template.js';
import { renderMarketingEmail } from './email-renderers.js';

const BASE = 'https://masest.co';
const MEDIA_BASE = 'https://media.masest.co/site';

function imageDimension(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 10000 ? Math.round(parsed) : 0;
}

function mediaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https:\/\/media\.masest\.co\//i.test(raw)) return raw;
  const local = raw.replace(/^https?:\/\/(?:www\.)?masest\.co\//i, '').replace(/^\/+/, '');
  if (/^https?:\/\//i.test(local)) return '';
  return `${MEDIA_BASE}/${local}`;
}

// Normalize a published content_entries blog_post row into a flat post object.
export function postFromEntry(row = {}) {
  const p = row && typeof row.payload === 'object' && row.payload ? row.payload : {};
  return {
    slug: String(row.slug || ''),
    title: String(p.title || row.title || ''),
    excerpt: String(p.excerpt || ''),
    hero: String(p.hero || ''),
    hero_alt: String(p.hero_alt || ''),
    hero_width: imageDimension(p.hero_width || p.hero_w),
    hero_height: imageDimension(p.hero_height || p.hero_h),
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
  const title = String(post.title || 'New from the VertKleen Briefing');
  const excerpt = String(post.excerpt || '');
  const category = String(post.category || '');
  const author = String(post.author || '');
  const date = String(post.date || '');
  const url = `${BASE}/blog/${slug}`;
  const heroUrl = mediaUrl(post.hero);
  const byline = [author, date].filter(Boolean).map((value) => emailEscape(value)).join(' &middot; ');
  const rendered = renderMarketingEmail({
    kind: 'newsletter',
    campaign: {
      subject: `New from MASEST: ${title}`.slice(0, 180),
      heading: title,
      previewText: excerpt || title,
      eyebrow: category || 'The VertKleen Briefing',
      heroImage: heroUrl,
      heroAlt: post.hero_alt || title,
      heroWidth: imageDimension(post.hero_width) || 600,
      heroHeight: imageDimension(post.hero_height) || 338,
      bodyHtml: `${byline ? `<p style="margin:0 0 14px;color:#5f656d;font-size:13px">${byline}</p>` : ''}<p style="margin:0">${emailEscape(excerpt)}</p>`,
      ctaText: 'Read the full post',
      ctaUrl: url,
    },
    recipientContext: {
      reason: 'You received this because you subscribed to the VertKleen Briefing or enabled marketing email in your MASEST account.',
    },
  });
  return { ...rendered, url };
}
