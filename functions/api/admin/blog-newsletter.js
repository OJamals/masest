// functions/api/admin/blog-newsletter.js — secret-guarded sweep that emails the
// newsletter list any published blog post not yet sent. Called by the publish-blog
// workflow (after the static page is committed) and/or a schedule. Automation-only:
// secret header, no staff auth — same pattern as admin/review-reminders.js.
import { adminClient, json, readBody, sendEmail } from '../../_lib/supabase.js';
import { klaviyoListProfiles } from '../../_lib/klaviyo.js';
import { postFromEntry, unsentPosts, renderBlogEmail } from '../../_lib/blog-newsletter.js';

function timingSafeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i += 1) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

// Hard cap on emails per invocation — a CF Worker request can't fan out unbounded.
// For larger lists the workflow/schedule re-invokes; Resend idempotency keys make
// re-sends within 24h no-ops.
const MAX_EMAILS_PER_RUN = 200;
const MAX_POSTS_PER_RUN = 5;

export async function onRequestPost({ request, env }) {
  const body = await readBody(request).catch(() => ({}));
  if (body.action && body.action !== 'sweep') return json(400, { error: 'bad_action' });
  if (!env.BLOG_NEWSLETTER_SECRET
    || !timingSafeEqual(request.headers.get('x-blog-newsletter-secret'), env.BLOG_NEWSLETTER_SECRET)) {
    return json(401, { error: 'unauthorized' });
  }

  const sb = adminClient(env);
  const { data: rows, error } = await sb.from('content_entries')
    .select('slug,title,payload,published_at')
    .eq('type', 'blog_post').eq('status', 'published').eq('locale', 'en')
    .order('published_at', { ascending: true });
  if (error) return json(500, { error: 'load_failed' });

  // If the dedup ledger is missing, ABORT — never send without it, or every existing
  // post would blast (the backlog guard lives as seeded rows in this table).
  const { data: sentRows, error: sentErr } = await sb.from('blog_newsletter_sends').select('slug');
  if (sentErr) return json(503, { error: 'ledger_unavailable' });
  const sentSlugs = (sentRows || []).map((r) => r.slug);

  const posts = (rows || []).map(postFromEntry).filter((p) => p.slug && p.excerpt);
  const todo = unsentPosts(posts, sentSlugs).slice(0, MAX_POSTS_PER_RUN);
  if (!todo.length) return json(200, { ok: true, sent: [], skipped: 'nothing_unsent' });

  const listId = env.KLAVIYO_LIST_ID;
  const subscribers = await klaviyoListProfiles(env, listId);
  if (!subscribers.length) return json(200, { ok: true, sent: [], skipped: 'no_subscribers' });

  const results = [];
  let budget = MAX_EMAILS_PER_RUN;
  for (const post of todo) {
    if (budget <= 0) break;
    const { subject, html } = renderBlogEmail(post);
    const recipients = subscribers.slice(0, budget);
    let ok = 0;
    for (const email of recipients) {
      const sent = await sendEmail(env, {
        to: [email], subject, html, category: 'blog_newsletter',
        idempotencyKey: `blog-newsletter:${post.slug}:${email}`,
      });
      if (sent) ok += 1;
    }
    budget -= recipients.length;
    // Record the send so re-runs skip it. Only mark complete when the whole list
    // was covered this run; a truncated run leaves it unrecorded to finish next time.
    if (recipients.length >= subscribers.length) {
      await sb.from('blog_newsletter_sends')
        .upsert({ slug: post.slug, recipient_count: ok, sent_at: new Date().toISOString() }, { onConflict: 'slug' });
    }
    results.push({ slug: post.slug, recipients: recipients.length, delivered: ok, recorded: recipients.length >= subscribers.length });
  }
  return json(200, { ok: true, sent: results });
}
