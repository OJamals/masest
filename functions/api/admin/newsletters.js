// /api/admin/newsletters — staff CRUD + durable queue creation for admin newsletters.
// The secret-gated sweep materializes due campaigns, then runs the bounded shared
// delivery worker. send_now only composes/materializes and returns before transport.
import { adminClient, requireStaff, json, readBody, sendEmail, allUserEmails } from '../../_lib/supabase.js';
import { klaviyoListProfiles } from '../../_lib/klaviyo.js';
import { renderNewsletterEmail, resolveAudience, nextRunAt, dueNewsletters } from '../../_lib/newsletter.js';
import {
  createSupabaseDeliveryStore,
  getDeliverySource,
  materializeDeliverySource,
  runSupabaseDeliveryWorker,
} from '../../_lib/newsletter-delivery.js';
import { staffCanWrite } from '../../_lib/authz.js';
import { timingSafeEqual } from '../../_lib/secret.js';

async function resolveNewsletterAudience(env, sb, n) {
  const populations = Array.isArray(n.audience?.populations) ? n.audience.populations : [];
  const [usersMap, leads, importedRes] = await Promise.all([
    populations.includes('users') ? allUserEmails(sb, { strict: true }) : Promise.resolve(new Map()),
    populations.includes('leads')
      ? klaviyoListProfiles(env, env.KLAVIYO_LIST_ID, { strict: true })
      : Promise.resolve([]),
    populations.includes('imported')
      ? sb.from('newsletter_recipients').select('email').eq('subscribed', true)
      : Promise.resolve({ data: [] }),
  ]);
  if (importedRes.error) throw new Error('newsletter_imported_audience_failed');
  return resolveAudience({
    populations,
    users: [...usersMap.values()],
    leads,
    imported: (importedRes.data || []).map((r) => r.email),
  }).sort();
}

function newsletterSourceId(n, scheduled) {
  if (!scheduled || n.schedule?.mode !== 'recurring') return String(n.id);
  const occurrence = n.schedule?.next_run_at || n.schedule?.send_at;
  return occurrence ? `${n.id}@${occurrence}` : String(n.id);
}

async function queueNewsletter(env, sb, n, { scheduled = false } = {}) {
  const sourceId = newsletterSourceId(n, scheduled);
  const existing = await getDeliverySource(sb, 'newsletter', sourceId);
  if (existing.error) return { error: 'ledger_unavailable' };

  let queued = {
    created: false,
    total: Number(existing.source?.total_count) || 0,
    error: null,
  };
  if (!existing.source) {
    let audience;
    try {
      audience = await resolveNewsletterAudience(env, sb, n);
    } catch {
      return { error: 'audience_unavailable' };
    }
    const { subject, html } = renderNewsletterEmail(n);
    const next = scheduled ? nextRunAt(n.schedule, Date.now()) : null;
    queued = await materializeDeliverySource(sb, {
      sourceType: 'newsletter',
      sourceId,
      parentId: n.id,
      subject,
      html,
      category: 'newsletter',
      metadata: {
        ...(next ? { next_schedule: { ...n.schedule, next_run_at: next } } : {}),
      },
      emails: audience,
    });
  }
  if (queued.error) return { error: 'ledger_unavailable' };

  const summary = {
    total: queued.total,
    pending: queued.total,
    processing: 0,
    retry: 0,
    sent: 0,
    suppressed: 0,
    dead: 0,
    terminal: 0,
    complete: queued.total === 0,
  };
  const { error } = await sb.from('newsletters').update({
    status: 'sending',
    recipient_count: 0,
    delivery_source_id: sourceId,
    delivery_summary: summary,
    updated_at: new Date().toISOString(),
  }).eq('id', n.id);
  if (error) return { error: 'newsletter_queue_update_failed' };

  if (!queued.created || queued.total === 0) {
    try {
      await createSupabaseDeliveryStore(sb).reconcile('newsletter', sourceId);
    } catch {
      return { error: 'newsletter_reconcile_failed' };
    }
  }
  return { source_id: sourceId, created: queued.created, total: queued.total };
}

async function sweepDue(env) {
  const sb = adminClient(env);
  const { data, error } = await sb.from('newsletters').select('*').eq('status', 'scheduled');
  if (error) return json(503, { error: 'unavailable' });
  const due = dueNewsletters(data || [], Date.now());
  const queued = [];
  const failed = [];
  for (const n of due) {
    const result = await queueNewsletter(env, sb, n, { scheduled: true });
    if (result.error) failed.push({ id: n.id, error: result.error });
    else queued.push({ id: n.id, ...result });
  }
  let worker;
  try {
    worker = {
      newsletter: await runSupabaseDeliveryWorker(env, sb, { sourceType: 'newsletter' }),
      blog_post: await runSupabaseDeliveryWorker(env, sb, { sourceType: 'blog_post' }),
    };
  } catch (workerError) {
    return json(503, {
      error: 'newsletter_worker_failed',
      retryable: true,
      queued,
      failed,
      detail: String(workerError).slice(0, 200),
    });
  }
  return json(failed.length ? 503 : 200, { ok: !failed.length, queued, failed, worker });
}

export async function onRequest({ request, env }) {
  const body = request.method === 'POST' ? await readBody(request) : {};

  // Cron sweep — secret-gated, no staff session (documented non-staff pre-guard gate).
  if (body.action === 'sweep_due') {
    if (!env.NEWSLETTER_CRON_SECRET
      || !timingSafeEqual(request.headers.get('x-newsletter-cron-secret'), env.NEWSLETTER_CRON_SECRET)) {
      return json(401, { error: 'unauthorized' });
    }
    return sweepDue(env);
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
    const { data, error } = await sb.from('newsletters').select('id,subject,source,status,schedule,recipient_count,delivery_summary,sent_at,updated_at').order('updated_at', { ascending: false }).limit(200);
    // A missing-relation error means the newsletter schema hasn't been applied yet —
    // signal that so the admin UI shows a clear setup notice instead of a blank editor
    // whose Save/Send would fail cryptically.
    const setup_ready = !error;
    const { data: settings } = await sb.from('newsletter_settings').select('auto_send_latest_blog').eq('id', 1).maybeSingle();
    return json(200, { newsletters: data || [], settings: settings || { auto_send_latest_blog: false }, setup_ready });
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
      audience: body.audience && typeof body.audience === 'object' ? body.audience : { populations: [], recipient_tags: [] },
      updated_at: new Date().toISOString(),
    };
    if (!row.subject) return json(400, { error: 'subject_required' });
    if (body.id) {
      const { error } = await sb.from('newsletters').update(row).eq('id', body.id);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, id: body.id });
    }
    const { data, error } = await sb.from('newsletters').insert({ ...row, created_by: user.id, status: 'draft' }).select('id').single();
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, id: data.id });
  }

  if (action === 'delete') {
    if (!body.id) return json(400, { error: 'id_required' });
    await sb.from('newsletters').delete().eq('id', body.id);
    return json(200, { ok: true });
  }

  if (action === 'schedule') {
    if (!body.id) return json(400, { error: 'id_required' });
    const s = body.schedule || {};
    const mode = s.mode === 'recurring' ? 'recurring' : 'once';
    const schedule = mode === 'recurring'
      ? { mode, interval_days: Math.max(1, Number(s.interval_days) || 14), next_run_at: s.send_at || new Date().toISOString() }
      : { mode, send_at: s.send_at || new Date().toISOString(), next_run_at: s.send_at || new Date().toISOString() };
    // Never re-schedule a newsletter that is mid-dispatch, or it could re-arm and re-send.
    const { error } = await sb.from('newsletters').update({ status: 'scheduled', schedule, updated_at: new Date().toISOString() }).eq('id', body.id).neq('status', 'sending');
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, schedule });
  }

  if (action === 'cancel') {
    if (!body.id) return json(400, { error: 'id_required' });
    // Don't yank a send that is already in flight back to draft (would let a fresh
    // send_now re-claim and dispatch it a second time).
    await sb.from('newsletters').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', body.id).neq('status', 'sending');
    return json(200, { ok: true });
  }

  if (action === 'test_send') {
    const to = String(body.to || user.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json(400, { error: 'invalid_test_email' });
    const { subject, html } = renderNewsletterEmail({ subject: body.subject, body_md: body.body_md });
    const ok = await sendEmail(env, { to: [to], subject: `[TEST] ${subject}`, html, category: 'newsletter' });
    return json(ok ? 200 : 502, { ok });
  }

  if (action === 'send_now') {
    if (!body.id) return json(400, { error: 'id_required' });
    const { data: n } = await sb.from('newsletters').select('*').eq('id', body.id).maybeSingle();
    if (!n) return json(404, { error: 'not_found' });
    if (n.status === 'sent') return json(409, { error: 'already_sent' });
    const queued = await queueNewsletter(env, sb, n);
    if (queued.error) return json(503, { error: queued.error, retryable: true });
    // Transport runs only in the secret-gated cron worker. Returning 202 proves the
    // staff request ends after durable queue creation, before any recipient fanout.
    return json(202, { ok: true, queued: true, ...queued });
  }

  return json(400, { error: 'bad_action' });
}
