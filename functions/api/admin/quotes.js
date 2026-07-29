// /api/admin/quotes - staff view of inbound /api/quote leads.
import { adminClient, emailLayout, htmlEscape, json, logEmailEvent, readBody, requireStaff, sendEmail } from '../../_lib/supabase.js';
import { recordAudit } from '../../_lib/audit.js';
import { staffCanWrite } from '../../_lib/authz.js';
import { parsePage, pageEnvelope } from '../../_lib/paginate.js';
import { csvResponse } from '../../_lib/reports.js';
import { pipelineSummary, pipelineReport } from '../../_lib/crm-pipeline.js';
import { klaviyoTrack } from '../../_lib/klaviyo.js';
import { escapeLike } from '../../_lib/crm.js';
import { recordSupportMessage } from '../../_lib/support-messages.js';
import { timingSafeEqual } from '../../_lib/secret.js';
import { createQuoteLeadLifecycle, createSupabaseQuoteLeadStore } from '../../_lib/quote-leads.js';

const QUOTE_SELECT = 'id,created_at,type,name,email,company,phone,product,industry,location,message,payload,source,status,notes,handled_at,handled_by,priority,next_step,due_at,lead_score,assigned_to,assigned_at,pipeline_stage,deal_value,expected_close,stage_changed_at,lost_reason,contact_id';

function leadMutationResponse(result) {
  if (result.ok) return json(200, result);
  return json(result.status || (result.storage_error ? 500 : 400), { error: result.error });
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
  }).select('id,created_at').single();
  if (error) return { posted: false, company_id: resolvedCompanyId, error: error.message };
  await recordSupportMessage(sb, {
    companyId: resolvedCompanyId,
    senderRole: 'staff',
    body: messageBody,
    createdAt: message.created_at,
    reopen: false,
  }).catch(() => {});

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

function quoteLeadLifecycle({ sb, env }) {
  return createQuoteLeadLifecycle({
    store: createSupabaseQuoteLeadStore(sb),
    stageChanged: (quote, stage, source) => klaviyoTrack(env, {
      email: quote.email,
      metric: 'Deal Stage Changed',
      value: quote.deal_value,
      properties: {
        stage,
        deal_value: quote.deal_value,
        product: quote.product,
        company: quote.company,
        type: quote.type,
        source,
      },
    }),
    sendFollowUp: ({ quote, nextStep, dueText, subject, actor }) => sendEmail(env, {
      to: [quote.email],
      subject: subject || 'MASEST quote follow-up',
      category: 'lead_followup',
      html: emailLayout({
        heading: `Follow-up for ${htmlEscape(quote.company || quote.name || 'your request')}`,
        bodyHtml: `<p>${htmlEscape(nextStep)}</p>${dueText ? `<p><b>Target follow-up:</b> ${htmlEscape(dueText)} ET</p>` : ''}`,
        ctaText: 'Reply to MASEST',
        ctaUrl: `mailto:${actor || 'matthew@masest.co'}`,
      }),
    }),
    handoff: (input) => postQuoteThreadHandoff({ sb, ...input }),
    sendDueNotice: ({ quote, label, nextStep, dueText, hasBuyerEmail }) => sendTrackedLeadEmail(env, hasBuyerEmail ? {
      to: [quote.email],
      subject: 'MASEST quote follow-up reminder',
      category: 'lead_followup_reminder',
      html: emailLayout({
        heading: `Follow-up for ${htmlEscape(label)}`,
        bodyHtml: `<p>${htmlEscape(nextStep)}</p><p>This follow-up was due ${htmlEscape(dueText)} ET.</p>`,
        ctaText: 'Reply to MASEST',
        ctaUrl: 'mailto:matthew@masest.co',
      }),
    } : {
      to: String(env.ADMIN_EMAILS || '').split(',').map((email) => email.trim()).filter(Boolean),
      subject: `Quote follow-up needed: ${label}`,
      category: 'lead_followup_alert',
      html: emailLayout({
        heading: `Quote follow-up needed: ${htmlEscape(label)}`,
        bodyHtml: `<p>${htmlEscape(nextStep)}</p><p>This lead has no buyer email on file. Follow-up was due ${htmlEscape(dueText)} ET.</p>`,
      }),
    }),
    offerReady: ({ quote, appUrl }) => sendEmail(env, {
      to: [quote.email],
      subject: 'Your MASEST quote is ready',
      html: emailLayout({
        heading: 'Your quote is ready',
        bodyHtml: `<p>Review the pricing for ${htmlEscape(quote.product || 'your saved requisition')}, accept it, and continue to secure checkout.</p>`,
        ctaText: 'Review your quote',
        ctaUrl: `${appUrl}/dashboard.html#quotes`,
      }),
      category: 'quote',
    }),
    converted: ({ quote, recipients, appUrl }) => sendEmail(env, {
      to: recipients,
      subject: 'Your quote is now an order',
      html: emailLayout({
        heading: 'Order created from your quote',
        bodyHtml: `<p>We turned your quote request${quote?.product ? ` for ${htmlEscape(quote.product)}` : ''} into a NET order. Review the details and invoice status in your dashboard.</p>`,
        ctaText: 'View your order',
        ctaUrl: `${appUrl}/dashboard.html#orders`,
      }),
      category: 'order',
    }),
    audit: (entry) => recordAudit(sb, entry),
  });
}

export async function onRequest({ request, env }) {
  let body;
  if (request.method === 'POST') {
    body = await readBody(request);
    if (body.action === 'sweep_due' && env.QUOTE_CRM_SECRET && timingSafeEqual(request.headers.get('x-quote-crm-secret'), env.QUOTE_CRM_SECRET)) {
      const sb = adminClient(env);
      const result = await quoteLeadLifecycle({ sb, env }).sweepDue({
        actor: 'automation',
        batch: body.batch,
      });
      return json(result.ok ? 200 : 500, result);
    }
  }

  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    if (new URL(request.url).searchParams.get('view') === 'workspace') {
      const result = await quoteLeadLifecycle({ sb, env }).workspace({
        id: new URL(request.url).searchParams.get('id'),
      });
      return json(result.status, result.body, { 'cache-control': 'no-store' });
    }
    if (new URL(request.url).searchParams.get('view') === 'pipeline') {
      const { data, error } = await sb.from('quotes').select('id,pipeline_stage,deal_value').neq('status', 'spam').limit(5000);
      if (error) {
        if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { summary: pipelineSummary([]), needs_migration: true });
        return json(500, { error: error.message });
      }
      return json(200, { summary: pipelineSummary(data || []) });
    }
    if (new URL(request.url).searchParams.get('view') === 'report') {
      const { data, error } = await sb.from('quotes').select('id,pipeline_stage,deal_value,expected_close,lost_reason').neq('status', 'spam').limit(5000);
      if (error) {
        if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { report: pipelineReport([]), needs_migration: true });
        return json(500, { error: error.message });
      }
      return json(200, { report: pipelineReport(data || []) });
    }
    if (new URL(request.url).searchParams.get('view') === 'contacts') {
      const id = new URL(request.url).searchParams.get('id');
      if (!id) return json(400, { error: 'id_required' });
      const { data: q } = await sb.from('quotes').select('id,email,company').eq('id', id).maybeSingle();
      if (!q) return json(404, { error: 'not_found' });
      let companyId = await companyIdForQuote(sb, { email: q.email });
      if (!companyId && q.company) {
        // Escape LIKE metacharacters so a company name with _ or % can't wildcard-match a
        // different company (which would write a cross-company contact_id onto the quote).
        const { data: co } = await sb.from('companies').select('id').ilike('name', escapeLike(String(q.company).trim())).limit(1).maybeSingle();
        companyId = co?.id || null;
      }
      if (!companyId) return json(200, { company_id: null, contacts: [] });
      const { data: contacts, error } = await sb.from('crm_contacts')
        .select('id,name,role,title,email,is_primary').eq('company_id', companyId).is('deleted_at', null)
        .order('is_primary', { ascending: false }).order('name', { ascending: true }).limit(200);
      if (error) {
        if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { company_id: companyId, contacts: [], needs_migration: true });
        return json(500, { error: error.message });
      }
      return json(200, { company_id: companyId, contacts: contacts || [] });
    }
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
    const _singleId = new URL(request.url).searchParams.get('id');
    if (_singleId && !new URL(request.url).searchParams.get('view') && new URL(request.url).searchParams.get('export') !== 'csv') {
      const { data, error } = await sb.from('quotes').select(QUOTE_SELECT).eq('id', _singleId).maybeSingle();
      if (error) {
        if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { quote: null, needs_migration: true });
        return json(500, { error: error.message });
      }
      return json(data ? 200 : 404, data ? { quote: data } : { error: 'not_found' });
    }
    const listParams = new URL(request.url).searchParams;
    const { limit, offset } = parsePage(listParams, { defaultLimit: 100, maxLimit: 300 });
    let listQuery = sb.from('quotes')
      .select(QUOTE_SELECT, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    // Server-side search so results aren't limited to the loaded page. Commas and
    // parens are stripped — they would break the PostgREST or= filter syntax.
    const search = String(listParams.get('search') || '').trim().replace(/[,()]/g, ' ').trim();
    if (search) {
      const like = `%${escapeLike(search)}%`;
      listQuery = listQuery.or(['name', 'email', 'company', 'product', 'location'].map((col) => `${col}.ilike.${like}`).join(','));
    }
    const { data, error, count } = await listQuery;
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
      const result = await quoteLeadLifecycle({ sb, env }).sweepDue({
        actor: user.email || 'staff',
        batch: body.batch,
      });
      return json(result.ok ? 200 : 500, result);
    }

    const leadLifecycle = quoteLeadLifecycle({ sb, env });

    if (Array.isArray(body.ids) && body.ids.length) {
      return leadMutationResponse(await leadLifecycle.bulkUpdate({
        ids: body.ids,
        changes: body,
        actor: user.email || null,
      }));
    }

    if (!body.id) return json(400, { error: 'id_required' });

    if (body.action === 'send_quote') {
      const result = await leadLifecycle.sendOffer({
        id: body.id,
        items: body.items,
        actor: user.email || null,
        user,
        appUrl: env.APP_URL || new URL(request.url).origin,
      });
      return json(result.status, result.body);
    }

    if (body.action === 'convert') {
      const result = await leadLifecycle.convert({
        id: body.id,
        companyId: body.company_id,
        items: body.items,
        actor: user.email || null,
        user,
        appUrl: env.APP_URL || new URL(request.url).origin,
      });
      return json(result.status, result.body);
    }

    if (body.action === 'followup') {
      return leadMutationResponse(await leadLifecycle.followUp({
        id: body.id,
        actor: user.email || null,
        companyId: body.company_id,
        subject: body.subject,
        nextStep: body.next_step,
        dueAt: body.due_at,
      }));
    }

    return leadMutationResponse(await leadLifecycle.update({
      id: body.id,
      changes: body,
      actor: user.email || null,
    }));
  }

  return json(405, { error: 'method_not_allowed' });
}
