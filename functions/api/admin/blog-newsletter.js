// functions/api/admin/blog-newsletter.js — secret-guarded composition/materialization
// for published blog posts. Transport is handled by the shared leased worker invoked
// from the newsletter cron, never by this publish-triggered request.
import { adminClient, json, readBody } from '../../_lib/supabase.js';
import { klaviyoListProfiles } from '../../_lib/klaviyo.js';
import { postFromEntry, unsentPosts, renderBlogEmail } from '../../_lib/blog-newsletter.js';
import { createSupabaseDeliveryStore, materializeDeliverySource } from '../../_lib/newsletter-delivery.js';
import { timingSafeEqual } from '../../_lib/secret.js';

const MAX_POSTS_PER_RUN = 5;

export async function onRequestPost({ request, env }) {
  const body = await readBody(request).catch(() => ({}));
  if (body.action && body.action !== 'sweep') return json(400, { error: 'bad_action' });
  if (!env.BLOG_NEWSLETTER_SECRET
    || !timingSafeEqual(request.headers.get('x-blog-newsletter-secret'), env.BLOG_NEWSLETTER_SECRET)) {
    return json(401, { error: 'unauthorized' });
  }

  const sb = adminClient(env);
  // Gated by the newsletter settings toggle — off by default so blog publishes don't
  // auto-email until an admin opts in (Newsletter tab → Settings). Missing table/row
  // reads as off.
  const { data: settings } = await sb.from('newsletter_settings').select('auto_send_latest_blog').eq('id', 1).maybeSingle();
  if (!settings?.auto_send_latest_blog) return json(200, { ok: true, sent: [], skipped: 'auto_send_disabled' });

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

  const sourceIds = todo.map((post) => post.slug);
  const { data: existingRows, error: deliveryLedgerError } = await sb
    .from('newsletter_delivery_sources')
    .select('source_id,total_count')
    .eq('source_type', 'blog_post')
    .in('source_id', sourceIds);
  if (deliveryLedgerError) return json(503, { error: 'delivery_ledger_unavailable' });
  const existing = new Map((existingRows || []).map((row) => [row.source_id, row]));
  const unqueued = todo.filter((post) => !existing.has(post.slug));
  let subscribers = [];
  if (unqueued.length) {
    try {
      subscribers = await klaviyoListProfiles(env, env.KLAVIYO_LIST_ID, { strict: true });
    } catch {
      return json(503, { error: 'audience_unavailable', retryable: true });
    }
  }

  const queued = [];
  for (const post of todo) {
    const prior = existing.get(post.slug);
    if (prior) {
      try {
        await createSupabaseDeliveryStore(sb).reconcile('blog_post', post.slug);
      } catch {
        return json(503, { error: 'delivery_reconcile_failed', retryable: true });
      }
      queued.push({ slug: post.slug, created: false, total: Number(prior.total_count) || 0 });
      continue;
    }
    const { subject, html } = renderBlogEmail(post);
    const materialized = await materializeDeliverySource(sb, {
      sourceType: 'blog_post',
      sourceId: post.slug,
      parentId: post.slug,
      subject,
      html,
      category: 'blog_newsletter',
      metadata: {},
      emails: subscribers,
    });
    if (materialized.error) return json(503, { error: 'delivery_materialization_failed', retryable: true });
    if (materialized.total === 0) {
      await sb.from('blog_newsletter_sends')
        .upsert({
          slug: post.slug,
          recipient_count: 0,
          delivery_source_id: post.slug,
          delivery_total: 0,
          suppressed_count: 0,
          dead_count: 0,
          sent_at: new Date().toISOString(),
        }, { onConflict: 'slug' });
    }
    queued.push({ slug: post.slug, created: materialized.created, total: materialized.total });
  }
  return json(202, { ok: true, queued });
}
