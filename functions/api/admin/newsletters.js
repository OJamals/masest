// /api/admin/newsletters — staff CRUD + send-now + schedule for admin newsletters,
// plus a secret-gated `sweep_due` cron path that sends scheduled newsletters that are
// due and reschedules recurring ones. Send reuses sendEmail (per-recipient suppression
// + List-Unsubscribe + logging). Audience = users + Klaviyo leads + imported recipients.
import { adminClient, requireStaff, json, readBody, sendEmail, allUserEmails } from '../../_lib/supabase.js';
import { klaviyoListProfiles } from '../../_lib/klaviyo.js';
import { renderNewsletterEmail, resolveAudience, nextRunAt, dueNewsletters } from '../../_lib/newsletter.js';

const MAX_PER_RUN = 500;

function timingSafeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i += 1) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

// Resolve + send one newsletter. Returns { audience, sent, capped }.
async function sendNewsletter(env, sb, n) {
  const populations = Array.isArray(n.audience?.populations) ? n.audience.populations : [];
  const [usersMap, leads, importedRes] = await Promise.all([
    populations.includes('users') ? allUserEmails(sb).catch(() => new Map()) : Promise.resolve(new Map()),
    populations.includes('leads') ? klaviyoListProfiles(env, env.KLAVIYO_LIST_ID).catch(() => []) : Promise.resolve([]),
    populations.includes('imported')
      ? sb.from('newsletter_recipients').select('email').eq('subscribed', true)
      : Promise.resolve({ data: [] }),
  ]);
  const audience = resolveAudience({
    populations,
    users: [...usersMap.values()],
    leads,
    imported: (importedRes.data || []).map((r) => r.email),
  });
  const { subject, html } = renderNewsletterEmail(n);
  let sent = 0;
  for (const email of audience.slice(0, MAX_PER_RUN)) {
    const ok = await sendEmail(env, {
      to: [email], subject, html, category: 'newsletter',
      idempotencyKey: `newsletter:${n.id}:${email}`,
    });
    if (ok) sent += 1;
  }
  return { audience: audience.length, sent, capped: audience.length > MAX_PER_RUN };
}

async function sweepDue(env) {
  const sb = adminClient(env);
  const { data, error } = await sb.from('newsletters').select('*').eq('status', 'scheduled');
  if (error) return json(503, { error: 'unavailable' });
  const due = dueNewsletters(data || [], Date.now());
  const results = [];
  for (const n of due) {
    // Atomic claim: flip 'scheduled'→'sending' and PROCEED ONLY IF this update matched
    // the row. A concurrent/overlapping cron sweep then finds nothing to claim and skips,
    // so the same newsletter is never dispatched twice (idempotency keys are a second backstop).
    const { data: claimed } = await sb.from('newsletters')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', n.id).eq('status', 'scheduled').select('id').maybeSingle();
    if (!claimed) continue;
    const r = await sendNewsletter(env, sb, n);
    const next = nextRunAt(n.schedule, Date.now());
    if (next) {
      await sb.from('newsletters').update({
        status: 'scheduled', recipient_count: r.sent,
        schedule: { ...n.schedule, next_run_at: next }, updated_at: new Date().toISOString(),
      }).eq('id', n.id);
    } else {
      await sb.from('newsletters').update({
        status: 'sent', recipient_count: r.sent, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', n.id);
    }
    results.push({ id: n.id, ...r, rescheduled: !!next });
  }
  return json(200, { ok: true, sent: results });
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

  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);

  if (request.method === 'GET') {
    const id = new URL(request.url).searchParams.get('id');
    if (id) {
      const { data } = await sb.from('newsletters').select('*').eq('id', id).maybeSingle();
      return json(200, { newsletter: data || null });
    }
    const { data, error } = await sb.from('newsletters').select('id,subject,source,status,schedule,recipient_count,sent_at,updated_at').order('updated_at', { ascending: false }).limit(200);
    // A missing-relation error means the newsletter schema hasn't been applied yet —
    // signal that so the admin UI shows a clear setup notice instead of a blank editor
    // whose Save/Send would fail cryptically.
    const setup_ready = !error;
    const { data: settings } = await sb.from('newsletter_settings').select('auto_send_latest_blog').eq('id', 1).maybeSingle();
    return json(200, { newsletters: data || [], settings: settings || { auto_send_latest_blog: false }, setup_ready });
  }

  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
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
    // Atomic claim: flip to 'sending' only from a not-already-in-flight state. A
    // concurrent or double-clicked send_now then finds no row to update and 409s,
    // so the same newsletter can never be dispatched to the audience twice.
    const { data: claimed } = await sb.from('newsletters')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', n.id).neq('status', 'sending').neq('status', 'sent')
      .select('id').maybeSingle();
    if (!claimed) return json(409, { error: 'send_in_progress' });
    const r = await sendNewsletter(env, sb, n);
    await sb.from('newsletters').update({ status: 'sent', recipient_count: r.sent, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', n.id);
    return json(200, { ok: true, ...r });
  }

  return json(400, { error: 'bad_action' });
}
