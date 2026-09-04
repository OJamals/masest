// Secret-gated published-blog sweep backed by Supabase + Cloudflare Queue + SES.
import { adminClient, json, readBody } from '../../_lib/supabase.js';
import { postFromEntry, unsentPosts, renderBlogEmail } from '../../_lib/blog-newsletter.js';
import {
  materializeDeliverySource,
} from '../../_lib/newsletter-delivery.js';
import { enqueueMarketingDelivery } from '../../_lib/marketing-delivery-queue.js';
import { loadMarketingAudience } from '../../_lib/marketing-subscribers.js';
import { timingSafeEqual } from '../../_lib/secret.js';
import { recordAutomationRun } from '../../_lib/automation-runs.js';

const MAX_POSTS_PER_RUN = 5;

export async function claimBlogNewsletter(sb, slug) {
  const { error } = await sb.from('blog_newsletter_sends').insert({
    slug,
    queued_at: new Date().toISOString(),
    sent_at: null,
    provider: 'ses',
    provider_status: 'queueing',
    provider_error: null,
    recipient_count: 0,
  });
  if (!error) return { claimed: true, error: null };
  if (String(error.code || '') === '23505') return { claimed: false, error: null };
  return { claimed: false, error };
}

export async function onRequestPost({ request, env }) {
  const body = await readBody(request).catch(() => ({}));
  if (body.action && body.action !== 'sweep') return json(400, { error: 'bad_action' });
  if (!env.BLOG_NEWSLETTER_SECRET
    || !timingSafeEqual(request.headers.get('x-blog-newsletter-secret'), env.BLOG_NEWSLETTER_SECRET)) {
    return json(401, { error: 'unauthorized' });
  }

  const sb = adminClient(env);
  return recordAutomationRun(sb, 'blog_newsletter', async (run) => {
    const { data: settings } = await sb.from('newsletter_settings')
      .select('auto_send_latest_blog').eq('id', 1).maybeSingle();
    if (!settings?.auto_send_latest_blog) {
      return json(200, { ok: true, queued: [], skipped: 'auto_send_disabled' });
    }

    const { data: rows, error } = await sb.from('content_entries')
      .select('slug,title,payload,published_at')
      .eq('type', 'blog_post').eq('status', 'published').eq('locale', 'en')
      .order('published_at', { ascending: true });
    if (error) return json(500, { error: 'load_failed' });
    const { data: ledger, error: ledgerError } = await sb.from('blog_newsletter_sends').select('slug');
    if (ledgerError) return json(503, { error: 'ledger_unavailable' });

    const posts = (rows || []).map(postFromEntry).filter((post) => post.slug && post.excerpt);
    const todo = unsentPosts(posts, (ledger || []).map((row) => row.slug)).slice(0, MAX_POSTS_PER_RUN);
    if (!todo.length) return json(200, { ok: true, queued: [], skipped: 'nothing_unsent' });

    let emails;
    try {
      emails = await loadMarketingAudience(sb);
    } catch {
      return json(503, { error: 'marketing_audience_unavailable', retryable: true });
    }

    const queued = [];
    const failed = [];
    for (const post of todo) {
      const claim = await claimBlogNewsletter(sb, post.slug);
      if (claim.error) {
        failed.push({ slug: post.slug, error: 'blog_newsletter_claim_failed', retryable: true });
        continue;
      }
      if (!claim.claimed) continue;
      const rendered = renderBlogEmail(post);
      const materialized = await materializeDeliverySource(sb, {
        sourceType: 'blog_post',
        sourceId: post.slug,
        parentId: post.slug,
        subject: rendered.subject,
        html: rendered.html,
        category: 'blog_newsletter',
        metadata: { canonical_url: rendered.url },
        emails,
      });
      if (materialized.error) {
        await sb.from('blog_newsletter_sends').update({
          provider_status: 'failed_to_queue',
          provider_error: 'blog_delivery_materialize_failed',
        }).eq('slug', post.slug).eq('provider_status', 'queueing');
        failed.push({ slug: post.slug, error: 'blog_delivery_materialize_failed', retryable: true });
        continue;
      }
      const empty = materialized.total === 0;
      const { error: saveError } = await sb.from('blog_newsletter_sends').update({
        provider: 'ses',
        provider_status: empty ? 'complete' : 'processing',
        provider_error: null,
        delivery_source_id: post.slug,
        delivery_total: materialized.total,
        ...(empty ? { sent_at: new Date().toISOString() } : {}),
      }).eq('slug', post.slug).eq('provider_status', 'queueing');
      if (saveError) {
        failed.push({ slug: post.slug, error: 'blog_delivery_state_save_failed', retryable: true });
        continue;
      }
      queued.push({ slug: post.slug, source_id: post.slug, total: materialized.total });
    }

    let wake = { ok: true, queued: false };
    if (queued.some((item) => item.total > 0)) {
      wake = await enqueueMarketingDelivery(env, { sourceType: 'blog_post' });
      if (!wake.ok) failed.push({ error: wake.error, retryable: wake.retryable });
    }
    run.processed = queued.reduce((total, item) => total + item.total, 0);
    return json(failed.length ? 503 : 202, {
      ok: !failed.length,
      provider: 'ses',
      queued,
      processed: 0,
      queue_wake: wake.ok,
      failed,
    });
  });
}
