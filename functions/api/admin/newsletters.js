// /api/admin/newsletters — staff composer backed by Supabase + Cloudflare Queue + SES.
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';
import { renderNewsletterEmail } from '../../_lib/newsletter.js';
import { materializeDeliverySource } from '../../_lib/newsletter-delivery.js';
import { enqueueMarketingDelivery } from '../../_lib/marketing-delivery-queue.js';
import {
  claimNewsletter,
  recoverNewsletterPreparation,
  queueNewsletter,
  sweepNewsletterPreparation,
} from '../../_lib/newsletter-preparation.js';
import { staffCanWrite } from '../../_lib/authz.js';
import { timingSafeEqual } from '../../_lib/secret.js';
import { recordAutomationRun } from '../../_lib/automation-runs.js';

export { claimNewsletter, recoverNewsletterPreparation, queueNewsletter };

async function sweepDue(env) {
  const result = await sweepNewsletterPreparation(env);
  return json(result.ok ? 200 : 503, result);
}

export async function onRequest({ request, env }) {
  const body = request.method === 'POST' ? await readBody(request) : {};
  if (body.action === 'sweep_due') {
    if (!env.NEWSLETTER_CRON_SECRET
      || !timingSafeEqual(request.headers.get('x-newsletter-cron-secret'), env.NEWSLETTER_CRON_SECRET)) {
      return json(401, { error: 'unauthorized' });
    }
    return recordAutomationRun(adminClient(env), 'newsletter_sweep', () => sweepDue(env));
  }

  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);

  if (request.method === 'GET') {
    const id = new URL(request.url).searchParams.get('id');
    if (id) {
      const { data } = await sb.from('newsletters').select('*').eq('id', id).maybeSingle();
      return json(200, { newsletter: data || null });
    }
    const { data, error } = await sb.from('newsletters')
      .select('id,subject,source,status,schedule,recipient_count,provider,provider_status,provider_error,delivery_summary,sent_at,updated_at')
      .order('updated_at', { ascending: false }).limit(200);
    const { data: settings } = await sb.from('newsletter_settings')
      .select('auto_send_latest_blog').eq('id', 1).maybeSingle();
    return json(200, {
      newsletters: data || [],
      settings: settings || { auto_send_latest_blog: false },
      setup_ready: !error,
      provider: 'ses',
    });
  }

  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
  const action = body.action || 'save';

  if (action === 'settings') {
    const patch = { updated_at: new Date().toISOString() };
    if (typeof body.auto_send_latest_blog === 'boolean') patch.auto_send_latest_blog = body.auto_send_latest_blog;
    await sb.from('newsletter_settings').upsert({ id: 1, ...patch }, { onConflict: 'id' });
    return json(200, { ok: true });
  }

  if (action === 'save') {
    const row = {
      subject: String(body.subject || '').slice(0, 300),
      body_md: String(body.body_md || ''),
      source: body.source === 'blog_post' ? 'blog_post' : 'compose',
      blog_slug: body.blog_slug ? String(body.blog_slug).slice(0, 120) : null,
      audience: { provider: 'ses', source: 'newsletter_recipients' },
      updated_at: new Date().toISOString(),
    };
    if (!row.subject) return json(400, { error: 'subject_required' });
    if (body.id) {
      const { error } = await sb.from('newsletters').update(row).eq('id', body.id);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, id: body.id });
    }
    const { data, error } = await sb.from('newsletters')
      .insert({ ...row, created_by: user.id, status: 'draft' }).select('id').single();
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, id: data.id });
  }

  if (action === 'delete') {
    if (!body.id) return json(400, { error: 'id_required' });
    const { data: current } = await sb.from('newsletters').select('status').eq('id', body.id).maybeSingle();
    if (current?.status === 'sending' || current?.status === 'queueing') return json(409, { error: 'campaign_in_flight' });
    await sb.from('newsletters').delete().eq('id', body.id);
    return json(200, { ok: true });
  }

  if (action === 'schedule') {
    if (!body.id) return json(400, { error: 'id_required' });
    const input = body.schedule || {};
    const mode = input.mode === 'recurring' ? 'recurring' : 'once';
    const schedule = mode === 'recurring'
      ? { mode, interval_days: Math.max(1, Number(input.interval_days) || 14), next_run_at: input.send_at || new Date().toISOString() }
      : { mode, send_at: input.send_at || new Date().toISOString(), next_run_at: input.send_at || new Date().toISOString() };
    const { data: scheduled, error } = await sb.from('newsletters')
      .update({ status: 'scheduled', schedule, provider_error: null, updated_at: new Date().toISOString() })
      .eq('id', body.id)
      .in('status', ['draft', 'scheduled', 'sent', 'failed', 'canceled'])
      .select('id')
      .maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!scheduled) return json(409, { error: 'campaign_in_flight' });
    return json(200, { ok: true, schedule });
  }

  if (action === 'cancel') {
    if (!body.id) return json(400, { error: 'id_required' });
    await sb.from('newsletters').update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', body.id).eq('status', 'scheduled');
    return json(200, { ok: true });
  }

  if (action === 'test_send') {
    const to = String(body.to || user.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json(400, { error: 'invalid_test_email' });
    const rendered = renderNewsletterEmail({ subject: body.subject, body_md: body.body_md });
    const sourceId = crypto.randomUUID();
    const materialized = await materializeDeliverySource(sb, {
      sourceType: 'test',
      sourceId,
      parentId: sourceId,
      subject: `[TEST] ${rendered.subject}`,
      html: rendered.html,
      category: 'newsletter',
      metadata: { requested_by: user.id },
      emails: [to],
    });
    if (materialized.error || materialized.total !== 1) {
      return json(503, { ok: false, error: 'ses_test_materialize_failed', retryable: true });
    }
    const wake = await enqueueMarketingDelivery(env, { sourceType: 'test', sourceId });
    return json(wake.ok ? 202 : 503, wake.ok
      ? { ok: true, queued: true, provider: 'ses', source_id: sourceId }
      : { ok: false, error: wake.error, retryable: wake.retryable, source_id: sourceId });
  }

  if (action === 'send_now') {
    if (!body.id) return json(400, { error: 'id_required' });
    const claim = await claimNewsletter(sb, body.id);
    if (claim.error) return json(503, { error: 'newsletter_claim_failed', retryable: true });
    if (!claim.newsletter) {
      const { data: current, error } = await sb.from('newsletters').select('status').eq('id', body.id).maybeSingle();
      if (error) return json(503, { error: 'newsletter_state_load_failed', retryable: true });
      if (!current) return json(404, { error: 'not_found' });
      if (current.status === 'sent') return json(409, { error: 'already_sent' });
      return json(409, { error: 'campaign_in_flight' });
    }
    const result = await queueNewsletter(env, sb, claim.newsletter);
    if (result.error) return json(503, { error: result.error, retryable: result.retryable });
    return json(202, { ok: true, ...result });
  }

  return json(400, { error: 'bad_action' });
}
