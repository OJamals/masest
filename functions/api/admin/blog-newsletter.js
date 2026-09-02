// Secret-gated published-blog campaign sweep. Klaviyo owns subscriber consent,
// fanout, and delivery. Supabase keeps one provider-identity row per post for dedupe.
import { adminClient, json, readBody } from '../../_lib/supabase.js';
import { getKlaviyoCampaignStatus, publishKlaviyoCampaign } from '../../_lib/klaviyo.js';
import { htmlToText } from '../../_lib/email.js';
import { postFromEntry, unsentPosts, renderBlogEmail } from '../../_lib/blog-newsletter.js';
import { timingSafeEqual } from '../../_lib/secret.js';
import { recordAutomationRun } from '../../_lib/automation-runs.js';

const MAX_POSTS_PER_RUN = 5;
const FINAL = new Set(['complete', 'sent']);

async function reconcileQueued(env, sb) {
  const { data, error } = await sb.from('blog_newsletter_sends')
    .select('slug,provider_campaign_id,provider_status')
    .in('provider_status', ['queued', 'processing'])
    .limit(50);
  if (error) return { error: 'provider_reconcile_load_failed' };
  const results = [];
  for (const row of data || []) {
    if (!row.provider_campaign_id) continue;
    const status = await getKlaviyoCampaignStatus(env, row.provider_campaign_id);
    if (!status.ok) {
      results.push({ slug: row.slug, ok: false, error: status.error });
      continue;
    }
    const patch = { provider_status: status.status, provider_error: null };
    if (FINAL.has(status.status)) patch.sent_at = new Date().toISOString();
    if (status.status.startsWith('cancel')) patch.provider_error = status.status;
    const { error: updateError } = await sb.from('blog_newsletter_sends').update(patch).eq('slug', row.slug);
    results.push({ slug: row.slug, ok: !updateError, provider_status: status.status });
  }
  return { results };
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
    const reconciled = await reconcileQueued(env, sb);
    if (reconciled.error) return json(503, { error: reconciled.error, retryable: true });

    const { data: settings } = await sb.from('newsletter_settings')
      .select('auto_send_latest_blog').eq('id', 1).maybeSingle();
    if (!settings?.auto_send_latest_blog) {
      return json(200, { ok: true, queued: [], reconciled: reconciled.results, skipped: 'auto_send_disabled' });
    }

    const { data: rows, error } = await sb.from('content_entries')
      .select('slug,title,payload,published_at')
      .eq('type', 'blog_post').eq('status', 'published').eq('locale', 'en')
      .order('published_at', { ascending: true });
    if (error) return json(500, { error: 'load_failed' });

    const { data: ledger, error: ledgerError } = await sb.from('blog_newsletter_sends').select('slug');
    if (ledgerError) return json(503, { error: 'ledger_unavailable' });
    const sentSlugs = (ledger || []).map((row) => row.slug);
    const posts = (rows || []).map(postFromEntry).filter((post) => post.slug && post.excerpt);
    const todo = unsentPosts(posts, sentSlugs).slice(0, MAX_POSTS_PER_RUN);
    if (!todo.length) {
      return json(200, { ok: true, queued: [], reconciled: reconciled.results, skipped: 'nothing_unsent' });
    }

    const queued = [];
    const failed = [];
    for (const post of todo) {
      const { subject, html } = renderBlogEmail(post);
      const published = await publishKlaviyoCampaign(env, {
        name: `MASEST blog · ${post.slug}`,
        subject,
        previewText: post.excerpt,
        html,
        text: htmlToText(html),
        listId: env.KLAVIYO_LIST_ID,
      });
      if (!published.ok) {
        failed.push({ slug: post.slug, error: published.error, retryable: published.retryable === true });
        continue;
      }
      const { error: saveError } = await sb.from('blog_newsletter_sends').insert({
        slug: post.slug,
        queued_at: new Date().toISOString(),
        sent_at: null,
        provider: 'klaviyo',
        provider_campaign_id: published.campaignId,
        provider_message_id: published.messageId,
        provider_template_id: published.templateId,
        provider_status: published.status || 'queued',
        provider_error: null,
        recipient_count: 0,
      });
      if (saveError) {
        failed.push({ slug: post.slug, error: 'provider_identity_save_failed', retryable: true });
        continue;
      }
      queued.push({ slug: post.slug, campaign_id: published.campaignId, provider_status: published.status });
    }
    run.processed = queued.length;
    return json(failed.length ? 503 : 202, {
      ok: !failed.length,
      queued,
      failed,
      reconciled: reconciled.results,
    });
  });
}
