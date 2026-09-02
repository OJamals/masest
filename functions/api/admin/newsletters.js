// /api/admin/newsletters — staff campaign composer + Klaviyo campaign lifecycle.
// Supabase stores composition and provider identity only. Klaviyo owns recipients,
// consent, fanout, suppression, and delivery; no per-recipient local queue remains active.
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';
import {
  getKlaviyoCampaignStatus,
  klaviyoSubscribe,
  publishKlaviyoCampaign,
} from '../../_lib/klaviyo.js';
import { htmlToText } from '../../_lib/email.js';
import { renderNewsletterEmail, nextRunAt, dueNewsletters } from '../../_lib/newsletter.js';
import { staffCanWrite } from '../../_lib/authz.js';
import { timingSafeEqual } from '../../_lib/secret.js';
import { recordAutomationRun } from '../../_lib/automation-runs.js';

const COMPLETE_PROVIDER_STATES = new Set(['complete', 'sent']);
const SENDABLE_NEWSLETTER_STATES = ['draft', 'scheduled', 'failed'];

export async function claimNewsletter(sb, id, allowedStatuses = SENDABLE_NEWSLETTER_STATES) {
  const statuses = [...new Set(allowedStatuses)].filter((status) => typeof status === 'string' && status);
  if (!id || !statuses.length) return { newsletter: null, error: new Error('newsletter_claim_invalid') };
  const { data, error } = await sb.from('newsletters')
    .update({
      status: 'queueing',
      provider_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', statuses)
    .select('*')
    .maybeSingle();
  return { newsletter: data || null, error: error || null };
}

function campaignPatch(result) {
  return {
    provider: 'klaviyo',
    provider_campaign_id: result.campaignId,
    provider_message_id: result.messageId,
    provider_template_id: result.templateId,
    provider_status: result.status || 'queued',
    provider_error: null,
    status: 'sending',
    updated_at: new Date().toISOString(),
  };
}

async function publishNewsletter(env, sb, newsletter, { scheduled = false, listId } = {}) {
  const { subject, html } = renderNewsletterEmail(newsletter);
  const result = await publishKlaviyoCampaign(env, {
    name: `MASEST newsletter · ${newsletter.id || subject}`,
    subject,
    previewText: subject,
    html,
    text: htmlToText(html),
    listId: listId || env.KLAVIYO_LIST_ID,
  });
  if (!result.ok) {
    await sb.from('newsletters').update({
      provider: 'klaviyo',
      status: 'failed',
      provider_status: 'failed_to_queue',
      provider_error: result.error || 'klaviyo_campaign_failed',
      updated_at: new Date().toISOString(),
    }).eq('id', newsletter.id).eq('status', 'queueing');
    return { error: result.error || 'klaviyo_campaign_failed', retryable: result.retryable === true };
  }

  const patch = campaignPatch(result);
  if (scheduled && newsletter.schedule?.mode === 'recurring') {
    patch.schedule = {
      ...newsletter.schedule,
      next_run_at: nextRunAt(newsletter.schedule, Date.now()),
    };
  }
  const { error } = await sb.from('newsletters').update(patch).eq('id', newsletter.id);
  if (error) return { error: 'newsletter_provider_identity_save_failed', retryable: true };
  return {
    queued: true,
    provider: 'klaviyo',
    campaign_id: result.campaignId,
    provider_status: result.status,
  };
}

async function reconcileNewsletter(env, sb, newsletter) {
  const result = await getKlaviyoCampaignStatus(env, newsletter.provider_campaign_id);
  if (!result.ok) return { id: newsletter.id, ok: false, error: result.error, retryable: result.retryable === true };
  const providerStatus = result.status;
  const patch = { provider_status: providerStatus, updated_at: new Date().toISOString() };
  if (COMPLETE_PROVIDER_STATES.has(providerStatus)) {
    patch.sent_at = new Date().toISOString();
    patch.status = newsletter.schedule?.mode === 'recurring' ? 'scheduled' : 'sent';
  } else if (providerStatus.startsWith('cancel')) {
    patch.status = 'failed';
    patch.provider_error = providerStatus;
  }
  const { error } = await sb.from('newsletters').update(patch).eq('id', newsletter.id);
  return { id: newsletter.id, ok: !error, provider_status: providerStatus, error: error?.message };
}

async function reconcileProviderSends(env, sb) {
  const { data, error } = await sb.from('newsletters')
    .select('id,status,schedule,provider_campaign_id,provider_status')
    .eq('status', 'sending')
    .not('provider_campaign_id', 'is', null)
    .limit(100);
  if (error) return { failed: true, error: 'provider_reconcile_load_failed' };
  const results = [];
  for (const newsletter of data || []) results.push(await reconcileNewsletter(env, sb, newsletter));
  return { failed: false, results };
}

async function sweepDue(env) {
  const sb = adminClient(env);
  const reconciled = await reconcileProviderSends(env, sb);
  if (reconciled.failed) return json(503, { error: reconciled.error, retryable: true });

  const { data, error } = await sb.from('newsletters').select('*').eq('status', 'scheduled');
  if (error) return json(503, { error: 'unavailable' });
  const due = dueNewsletters(data || [], Date.now());
  const queued = [];
  const failed = [];
  for (const candidate of due) {
    const claim = await claimNewsletter(sb, candidate.id, ['scheduled']);
    if (claim.error) {
      failed.push({ id: candidate.id, error: 'newsletter_claim_failed', retryable: true });
      continue;
    }
    const newsletter = claim.newsletter;
    if (!newsletter) continue;
    const result = await publishNewsletter(env, sb, newsletter, { scheduled: true });
    if (result.error) failed.push({ id: newsletter.id, ...result });
    else queued.push({ id: newsletter.id, ...result });
  }
  return json(failed.length ? 503 : 200, {
    ok: !failed.length,
    queued,
    failed,
    reconciled: reconciled.results,
  });
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
      .select('id,subject,source,status,schedule,recipient_count,provider,provider_campaign_id,provider_status,provider_error,sent_at,updated_at')
      .order('updated_at', { ascending: false }).limit(200);
    const { data: settings } = await sb.from('newsletter_settings')
      .select('auto_send_latest_blog').eq('id', 1).maybeSingle();
    return json(200, {
      newsletters: data || [],
      settings: settings || { auto_send_latest_blog: false },
      setup_ready: !error,
      provider: 'klaviyo',
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
      audience: { provider: 'klaviyo', list: 'KLAVIYO_LIST_ID' },
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
    if (current?.status === 'sending' || current?.status === 'queueing') {
      return json(409, { error: 'campaign_in_flight' });
    }
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
    if (!env.KLAVIYO_TEST_LIST_ID) return json(503, { error: 'klaviyo_test_list_not_configured' });
    const subscribed = await klaviyoSubscribe(env, to, env.KLAVIYO_TEST_LIST_ID, {
      source: 'admin_newsletter_test',
    });
    if (!subscribed.ok) return json(502, { error: 'klaviyo_test_recipient_failed' });
    const { subject, html } = renderNewsletterEmail({ subject: body.subject, body_md: body.body_md });
    const queued = await publishKlaviyoCampaign(env, {
      name: `MASEST newsletter test · ${to}`,
      subject: `[TEST] ${subject}`,
      previewText: subject,
      html,
      text: htmlToText(html),
      listId: env.KLAVIYO_TEST_LIST_ID,
    });
    return json(queued.ok ? 202 : 502, queued.ok
      ? { ok: true, queued: true, provider: 'klaviyo', campaign_id: queued.campaignId }
      : { ok: false, error: queued.error || 'klaviyo_test_send_failed' });
  }

  if (action === 'send_now') {
    if (!body.id) return json(400, { error: 'id_required' });
    const claim = await claimNewsletter(sb, body.id);
    if (claim.error) return json(503, { error: 'newsletter_claim_failed', retryable: true });
    const newsletter = claim.newsletter;
    if (!newsletter) {
      const { data: current, error } = await sb.from('newsletters')
        .select('status').eq('id', body.id).maybeSingle();
      if (error) return json(503, { error: 'newsletter_state_load_failed', retryable: true });
      if (!current) return json(404, { error: 'not_found' });
      if (current.status === 'sent') return json(409, { error: 'already_sent' });
      return json(409, { error: 'campaign_in_flight' });
    }
    const queued = await publishNewsletter(env, sb, newsletter);
    if (queued.error) return json(503, { error: queued.error, retryable: queued.retryable });
    return json(202, { ok: true, ...queued });
  }

  return json(400, { error: 'bad_action' });
}
