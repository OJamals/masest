// /api/admin/newsletters — staff composer backed by Supabase delivery ledger + SES.
import { adminClient, requireStaff, json, readBody, sendEmailResult } from '../../_lib/supabase.js';
import { renderNewsletterEmail, nextRunAt, dueNewsletters } from '../../_lib/newsletter.js';
import {
  materializeDeliverySource,
  runSupabaseDeliveryWorker,
} from '../../_lib/newsletter-delivery.js';
import { loadMarketingAudience } from '../../_lib/marketing-subscribers.js';
import { syncSesSuppressions } from '../../_lib/ses-email.js';
import { staffCanWrite } from '../../_lib/authz.js';
import { timingSafeEqual } from '../../_lib/secret.js';
import { recordAutomationRun } from '../../_lib/automation-runs.js';

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

function sourceIdFor(newsletter) {
  if (newsletter.schedule?.mode !== 'recurring') return String(newsletter.id);
  const occurrence = newsletter.schedule.next_run_at || newsletter.schedule.send_at || newsletter.updated_at;
  return `${newsletter.id}:${String(occurrence || 'recurring')}`;
}

async function failQueue(sb, newsletterId, error) {
  await sb.from('newsletters').update({
    provider: 'ses',
    status: 'failed',
    provider_status: 'failed_to_queue',
    provider_error: String(error || 'newsletter_queue_failed').slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq('id', newsletterId).eq('status', 'queueing');
}

async function queueNewsletter(env, sb, newsletter, { scheduled = false, suppressionsSynced = false } = {}) {
  if (!suppressionsSynced) {
    const suppressionSync = await syncSesSuppressions(env, sb);
    if (!suppressionSync.ok) {
      await failQueue(sb, newsletter.id, suppressionSync.error);
      return { error: suppressionSync.error, retryable: suppressionSync.retryable };
    }
  }
  let emails;
  try {
    emails = await loadMarketingAudience(sb);
  } catch (error) {
    await failQueue(sb, newsletter.id, error.message);
    return { error: error.message || 'marketing_audience_unavailable', retryable: true };
  }
  const rendered = renderNewsletterEmail(newsletter);
  const sourceId = sourceIdFor(newsletter);
  const nextSchedule = scheduled && newsletter.schedule?.mode === 'recurring'
    ? { ...newsletter.schedule, next_run_at: nextRunAt(newsletter.schedule, Date.now()) }
    : null;
  const materialized = await materializeDeliverySource(sb, {
    sourceType: 'newsletter',
    sourceId,
    parentId: newsletter.id,
    subject: rendered.subject,
    html: rendered.html,
    category: 'newsletter',
    metadata: { next_schedule: nextSchedule },
    emails,
  });
  if (materialized.error) {
    await failQueue(sb, newsletter.id, 'newsletter_delivery_materialize_failed');
    return { error: 'newsletter_delivery_materialize_failed', retryable: true };
  }

  const empty = materialized.total === 0;
  const { error: updateError } = await sb.from('newsletters').update({
    provider: 'ses',
    provider_campaign_id: null,
    provider_message_id: null,
    provider_template_id: null,
    provider_status: empty ? 'complete' : 'processing',
    provider_error: null,
    status: empty ? (nextSchedule ? 'scheduled' : 'sent') : 'sending',
    schedule: nextSchedule || newsletter.schedule || {},
    delivery_source_id: empty ? null : sourceId,
    delivery_summary: empty ? {
      total: 0, pending: 0, processing: 0, retry: 0,
      sent: 0, suppressed: 0, dead: 0, terminal: 0, complete: true,
    } : {},
    recipient_count: 0,
    ...(empty && !nextSchedule ? { sent_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', newsletter.id).eq('status', 'queueing');
  if (updateError) return { error: 'newsletter_queue_state_save_failed', retryable: true };

  let processed = 0;
  if (!empty) {
    try {
      processed = (await runSupabaseDeliveryWorker(env, sb, { sourceType: 'newsletter' })).claimed;
    } catch {
      // Queue is durable; cron resumes. Returning 202 remains truthful.
    }
  }
  return {
    queued: !empty,
    provider: 'ses',
    source_id: sourceId,
    total: materialized.total,
    processed,
    provider_status: empty ? 'complete' : 'processing',
  };
}

async function drainDeliveryQueues(env, sb) {
  const results = [];
  for (const sourceType of ['newsletter', 'blog_post', 'nurture']) {
    results.push(await runSupabaseDeliveryWorker(env, sb, { sourceType }));
  }
  return results;
}

async function sweepDue(env) {
  const sb = adminClient(env);
  const suppressionSync = await syncSesSuppressions(env, sb);
  if (!suppressionSync.ok) {
    return json(503, { error: suppressionSync.error, retryable: suppressionSync.retryable });
  }
  let drained;
  try {
    drained = await drainDeliveryQueues(env, sb);
  } catch {
    return json(503, { error: 'newsletter_delivery_worker_failed', retryable: true });
  }
  const { data, error } = await sb.from('newsletters').select('*').eq('status', 'scheduled');
  if (error) return json(503, { error: 'unavailable' });
  const queued = [];
  const failed = [];
  for (const candidate of dueNewsletters(data || [], Date.now())) {
    const claim = await claimNewsletter(sb, candidate.id, ['scheduled']);
    if (claim.error) {
      failed.push({ id: candidate.id, error: 'newsletter_claim_failed', retryable: true });
      continue;
    }
    if (!claim.newsletter) continue;
    const result = await queueNewsletter(env, sb, claim.newsletter, {
      scheduled: true,
      suppressionsSynced: true,
    });
    if (result.error) failed.push({ id: candidate.id, ...result });
    else queued.push({ id: candidate.id, ...result });
  }
  return json(failed.length ? 503 : 200, {
    ok: !failed.length,
    queued,
    failed,
    drained: drained.map(({ claimed, summaries }) => ({ claimed, summaries })),
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
    const result = await sendEmailResult(env, {
      to: [to],
      subject: `[TEST] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
      category: 'newsletter',
      idempotencyKey: `newsletter-test:${crypto.randomUUID()}:${to}`,
    });
    return json(result.ok ? 202 : 502, result.ok
      ? { ok: true, queued: true, provider: 'ses', provider_message_id: result.providerMessageId }
      : { ok: false, error: result.error || 'ses_test_send_failed', retryable: result.retryable });
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
