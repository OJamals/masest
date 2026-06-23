// /api/admin/quotes - staff view of inbound /api/quote leads.
import { adminClient, emailLayout, htmlEscape, json, logEmailEvent, readBody, requireStaff, sendEmail } from '../../_lib/supabase.js';
import { buildConvertItems, netOrderRow } from '../../_lib/quote-convert.js';
import { staffCanWrite } from '../../_lib/authz.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';
import { csvResponse } from '../../_lib/reports.js';

const STATUSES = ['new', 'contacted', 'closed', 'spam'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

function timingSafeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

function dueAt(value) {
  if (value === null || value === '') return null;
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? false : date.toISOString();
}

function batchLimit(value) {
  const requested = Number(value || 25);
  return Math.min(50, Math.max(1, Math.floor(requested) || 25));
}

function plusDays(days, base = new Date()) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

function staffRecipients(env) {
  return String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
}

function appendNote(existing, note) {
  return [existing, note].filter(Boolean).join('\n').slice(0, 4000);
}

async function companyIdForQuote(sb, { companyId, email }) {
  if (companyId) {
    const { data } = await sb.from('companies').select('id').eq('id', companyId).maybeSingle();
    return data?.id || null;
  }
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;
  try {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = (data?.users || []).find((item) => String(item.email || '').toLowerCase() === target);
    if (!user?.id) return null;
    const { data: profile } = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
    return profile?.company_id || null;
  } catch {
    return null;
  }
}

async function postQuoteThreadHandoff({ sb, quote, companyId, text, actor }) {
  const resolvedCompanyId = await companyIdForQuote(sb, { companyId, email: quote.email });
  if (!resolvedCompanyId) return { posted: false, reason: 'company_not_found' };

  const messageBody = `Quote follow-up: ${text}`.slice(0, 4000);
  const { data: message, error } = await sb.from('messages').insert({
    company_id: resolvedCompanyId,
    sender_role: 'staff',
    body: messageBody,
    read_by_staff: true,
    read_by_user: false,
  }).select('id').single();
  if (error) return { posted: false, company_id: resolvedCompanyId, error: error.message };

  await sb.from('notifications').insert({
    company_id: resolvedCompanyId,
    type: 'message',
    title: 'Quote follow-up posted',
    body: `A MASEST quote follow-up from ${actor} is ready in your message thread.`,
    link: '/dashboard.html#messages',
  });
  return { posted: true, company_id: resolvedCompanyId, message_id: message?.id || null };
}

async function sendTrackedLeadEmail(env, options) {
  const recipients = [...(Array.isArray(options.to) ? options.to : []), ...(Array.isArray(options.bcc) ? options.bcc : [])]
    .filter(Boolean);
  if (!recipients.length || !env.RESEND_API_KEY) {
    await logEmailEvent(env, {
      to_email: recipients.join(', ') || 'none',
      category: options.category,
      subject: options.subject,
      status: 'failed',
      error: recipients.length ? 'resend_not_configured' : 'no_recipients',
    });
    return false;
  }
  return sendEmail(env, options);
}

async function sweepDueQuotes({ sb, env, actor, batch }) {
  const now = new Date();
  const nowIso = now.toISOString();
  const { data: quotes, error } = await sb.from('quotes')
    .select('id,name,email,company,status,priority,next_step,due_at,notes')
    .lte('due_at', nowIso)
    .neq('status', 'closed')
    .neq('status', 'spam')
    .order('due_at', { ascending: true })
    .limit(batchLimit(batch));
  if (error) return { ok: false, error: error.message };

  const staff = staffRecipients(env);
  const results = [];
  let buyer_reminders = 0;
  let staff_alerts = 0;

  for (const quote of quotes || []) {
    const label = quote.company || quote.name || quote.email || quote.id;
    const nextStep = quote.next_step || 'We are checking in on your quote request.';
    const dueText = quote.due_at ? new Date(quote.due_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }) : 'now';
    const hasBuyerEmail = Boolean(quote.email);

    const sent = hasBuyerEmail ? await sendTrackedLeadEmail(env, {
      to: [quote.email],
      subject: 'MASEST quote follow-up reminder',
      category: 'lead_followup_reminder',
      html: emailLayout({
        heading: `Follow-up for ${htmlEscape(label)}`,
        bodyHtml: `<p>${htmlEscape(nextStep)}</p><p>This follow-up was due ${htmlEscape(dueText)} ET.</p>`,
        ctaText: 'Reply to MASEST',
        ctaUrl: 'mailto:matthew@masest.co',
      }),
    }) : await sendTrackedLeadEmail(env, {
      to: staff,
      subject: `Quote follow-up needed: ${label}`,
      category: 'lead_followup_alert',
      html: emailLayout({
        heading: `Quote follow-up needed: ${htmlEscape(label)}`,
        bodyHtml: `<p>${htmlEscape(nextStep)}</p><p>This lead has no buyer email on file. Follow-up was due ${htmlEscape(dueText)} ET.</p>`,
      }),
    });

    if (hasBuyerEmail) buyer_reminders += 1;
    else staff_alerts += 1;

    const note = `Automated due follow-up by ${actor}: ${hasBuyerEmail ? 'buyer reminder' : 'staff alert'} ${sent ? 'sent' : 'attempted'} for ${nextStep}`;
    const nextDue = plusDays(hasBuyerEmail ? 2 : 1, now);
    const update = {
      status: quote.status === 'new' ? 'contacted' : quote.status,
      handled_at: nowIso,
      handled_by: actor,
      next_step: hasBuyerEmail ? 'Automated reminder sent' : 'Staff alert sent',
      due_at: nextDue,
      notes: appendNote(quote.notes, note),
    };

    const { error: updateError } = await sb.from('quotes').update(update).eq('id', quote.id);
    results.push({ id: quote.id, ok: !updateError, emailed: sent, error: updateError?.message });
  }

  return { ok: true, processed: (quotes || []).length, buyer_reminders, staff_alerts, results };
}

export async function onRequest({ request, env }) {
  let body;
  if (request.method === 'POST') {
    body = await readBody(request);
    if (body.action === 'sweep_due' && env.QUOTE_CRM_SECRET && timingSafeEqual(request.headers.get('x-quote-crm-secret'), env.QUOTE_CRM_SECRET)) {
      const sb = adminClient(env);
      const result = await sweepDueQuotes({ sb, env, actor: 'automation', batch: body.batch });
      return json(result.ok ? 200 : 500, result);
    }
  }

  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    if (new URL(request.url).searchParams.get('export') === 'csv') {
      const { data, error } = await sb.from('quotes')
        .select('id,created_at,type,name,email,company,phone,product,industry,location,status,priority,next_step,due_at,lead_score,assigned_to')
        .order('created_at', { ascending: false }).limit(5000);
      if (error) return json(500, { error: error.message });
      const rows = [['Quote', 'Date', 'Type', 'Name', 'Email', 'Company', 'Phone', 'Product', 'Industry', 'Location', 'Status', 'Priority', 'Next step', 'Due', 'Lead score', 'Assigned']];
      for (const qt of data || []) {
        rows.push([qt.id, qt.created_at, qt.type || '', qt.name || '', qt.email || '', qt.company || '', qt.phone || '', qt.product || '', qt.industry || '', qt.location || '', qt.status || '', qt.priority || '', qt.next_step || '', qt.due_at || '', qt.lead_score ?? '', qt.assigned_to || '']);
      }
      return csvResponse(rows, 'masest-quotes');
    }
    const { limit, offset } = parsePage(new URL(request.url).searchParams, { defaultLimit: 100, maxLimit: 300 });
    const { data, error, count } = await sb.from('quotes')
      .select('id,created_at,type,name,email,company,phone,product,industry,location,message,payload,status,notes,handled_at,handled_by,priority,next_step,due_at,lead_score,assigned_to,assigned_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) {
      if (/does not exist|relation|schema cache/i.test(error.message)) {
        return json(200, { quotes: [], new_count: 0, needs_migration: true });
      }
      return json(500, { error: error.message });
    }

    const quotes = data || [];
    // Badge counts must reflect ALL quotes, not just the current page.
    const newCount = await sb.from('quotes').select('id', { count: 'exact', head: true }).eq('status', 'new');
    const urgentCount = await sb.from('quotes').select('id', { count: 'exact', head: true }).eq('priority', 'urgent');
    return json(200, {
      quotes,
      new_count: newCount.count || 0,
      urgent_count: urgentCount.count || 0,
      ...pageEnvelope(quotes, { limit, offset, count }),
    });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    body = body || await readBody(request);
    if (body.action === 'sweep_due') {
      const result = await sweepDueQuotes({ sb, env, actor: user.email || 'staff', batch: body.batch });
      return json(result.ok ? 200 : 500, result);
    }

    if (!body.id) return json(400, { error: 'id_required' });

    if (body.action === 'convert') {
      const companyId = String(body.company_id || '');
      const { data: company, error: coErr } = await sb.from('companies').select('id,status').eq('id', companyId).single();
      if (coErr || !company) return json(404, { error: 'company_not_found' });

      const built = buildConvertItems(body.items);
      if (built.error) return json(400, { error: built.error });
      const clean = built.items;

      const { data: order, error: oErr } = await sb.from('orders')
        .insert(netOrderRow(companyId, built.subtotal))
        .select('id').single();
      if (oErr) return json(500, { error: oErr.message });

      const { error: iErr } = await sb.from('order_items').insert(clean.map((item) => ({ order_id: order.id, ...item })));
      if (iErr) return json(500, { error: iErr.message });

      await sb.from('quotes').update({
        status: 'closed',
        handled_at: new Date().toISOString(),
        handled_by: user.email || null,
        next_step: 'Converted to order',
        due_at: null,
      }).eq('id', body.id);
      await sb.from('notifications').insert({
        company_id: companyId,
        type: 'order',
        title: 'Order created from your quote',
        body: 'We turned your quote request into an order. See it in your dashboard.',
        link: '/dashboard.html#orders',
      });

      return json(200, { ok: true, order_id: order.id });
    }

    if (body.action === 'followup') {
      const { data: quote, error: qErr } = await sb.from('quotes').select('id,name,email,company,status,priority,next_step,due_at,notes').eq('id', body.id).single();
      if (qErr || !quote) return json(404, { error: 'quote_not_found' });
      if (!quote.email) return json(400, { error: 'quote_email_required' });

      const nextStep = String(body.next_step || quote.next_step || 'We are reviewing your request and will follow up with next steps.').slice(0, 500);
      const due = dueAt(body.due_at ?? quote.due_at);
      if (due === false) return json(400, { error: 'invalid_due_at' });
      const dueText = due ? new Date(due).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }) : null;

      await sendEmail(env, {
        to: [quote.email],
        subject: body.subject || 'MASEST quote follow-up',
        category: 'lead_followup',
        html: emailLayout({
          heading: `Follow-up for ${htmlEscape(quote.company || quote.name || 'your request')}`,
          bodyHtml: `<p>${htmlEscape(nextStep)}</p>${dueText ? `<p><b>Target follow-up:</b> ${htmlEscape(dueText)} ET</p>` : ''}`,
          ctaText: 'Reply to MASEST',
          ctaUrl: `mailto:${user.email || 'matthew@masest.co'}`,
        }),
      });

      const thread = await postQuoteThreadHandoff({
        sb,
        quote,
        companyId: body.company_id,
        text: nextStep,
        actor: user.email || 'staff',
      });
      const handoffNote = thread.posted ? `Buyer message thread updated (${thread.message_id || 'message'})` : `Buyer message thread not updated (${thread.reason || thread.error || 'no account match'})`;
      const notes = [quote.notes, `Follow-up sent by ${user.email || 'staff'}: ${nextStep}`, handoffNote].filter(Boolean).join('\n');
      const { data, error } = await sb.from('quotes').update({
        status: quote.status === 'closed' ? quote.status : 'contacted',
        handled_at: new Date().toISOString(),
        handled_by: user.email || null,
        next_step: 'Follow-up sent',
        due_at: due || null,
        notes: notes.slice(0, 4000),
      }).eq('id', body.id)
        .select('id,status,notes,handled_at,priority,next_step,due_at,lead_score,assigned_to,assigned_at')
        .single();
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, quote: data });
    }

    const patch = {};
    if (body.status) {
      if (!STATUSES.includes(body.status)) return json(400, { error: 'invalid_status' });
      patch.status = body.status;
      patch.handled_at = body.status === 'new' ? null : new Date().toISOString();
      patch.handled_by = body.status === 'new' ? null : (user.email || null);
    }
    if (body.priority) {
      if (!PRIORITIES.includes(body.priority)) return json(400, { error: 'invalid_priority' });
      patch.priority = body.priority;
    }
    if (typeof body.assigned_to === 'string') {
      const assignedTo = body.assigned_to.trim().slice(0, 160);
      Object.assign(patch, {
        assigned_to: assignedTo || null,
        assigned_at: assignedTo ? new Date().toISOString() : null,
      });
    }
    if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 4000);
    if (typeof body.next_step === 'string') patch.next_step = body.next_step.slice(0, 500);

    const parsedDueAt = dueAt(body.due_at);
    if (parsedDueAt === false) return json(400, { error: 'invalid_due_at' });
    if (parsedDueAt !== undefined) patch.due_at = parsedDueAt;

    if (!Object.keys(patch).length) return json(400, { error: 'nothing_to_update' });

    const { data, error } = await sb.from('quotes').update(patch).eq('id', body.id)
      .select('id,status,notes,handled_at,priority,next_step,due_at,lead_score,assigned_to,assigned_at')
      .single();
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, quote: data });
  }

  return json(405, { error: 'method_not_allowed' });
}
