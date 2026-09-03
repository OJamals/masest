// /api/admin/offers — staff broadcasts. GET → past sends · POST → in-app notification fan-out
// (+ optional marketing email when a compliant marketing provider is configured).
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';
import { emailEscape } from '../../_lib/email-template.js';
import { renderMarketingEmail } from '../../_lib/email-renderers.js';
import { queueMarketingEmail } from '../../_lib/marketing-email.js';
import { syncSesSuppressions } from '../../_lib/ses-email.js';
import { normalizeMarketingEmails } from '../../_lib/marketing-subscribers.js';
import { staffCanWrite } from '../../_lib/authz.js';

const AUDIENCES = ['all', 'approved', 'pending', 'company'];

function cleanOfferCtaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')) return raw.slice(0, 500);
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString().slice(0, 500);
  } catch {
    return '';
  }
  return '';
}

async function targetCompanies(sb, audience, companyId) {
  let q = sb.from('companies').select('id');
  if (audience === 'company') q = q.eq('id', companyId);
  else if (audience !== 'all') q = q.eq('status', audience);
  const { data } = await q;
  return (data || []).map((c) => c.id);
}

export async function memberEmails(sb, companyIds) {
  if (!companyIds.length) return [];
  const { data, error } = await sb.rpc('marketing_company_emails', {
    p_company_ids: companyIds,
  });
  if (error) throw new Error('marketing_company_emails_unavailable');
  return normalizeMarketingEmails((data || []).map((row) => row.email));
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const { data, error } = await sb.from('offers').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) return json(500, { error: error.message });
    return json(200, { offers: data || [] });
  }

  if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });

  if (request.method === 'POST') {
    const body = await readBody(request);
    const title = String(body.title || '').trim();
    const audience = AUDIENCES.includes(body.audience) ? body.audience : 'approved';
    if (!title) return json(400, { error: 'title_required' });
    if (audience === 'company' && !body.company_id) return json(400, { error: 'company_id_required' });
    const bodyText = String(body.body || '');
    const ctaUrl = cleanOfferCtaUrl(body.cta_url);

    const companyIds = await targetCompanies(sb, audience, body.company_id);
    if (!companyIds.length) return json(200, { ok: true, recipients: 0, message: 'No companies match.' });

    const { data: offer, error: offerError } = await sb.from('offers').insert({
      title, body: bodyText || null, cta_url: ctaUrl || null,
      audience, company_id: audience === 'company' ? body.company_id : null,
      created_by: user.email || null, recipients: companyIds.length, emailed: false,
      email_provider: body.send_email ? 'ses' : null,
      email_status: body.send_email ? 'queueing' : 'not_requested',
    }).select('id').single();
    if (offerError || !offer?.id) return json(500, { error: 'offer_create_failed' });

    await sb.from('notifications').insert(companyIds.map((cid) => ({
      company_id: cid, type: 'offer', title,
      body: bodyText.slice(0, 1000) || null, link: ctaUrl || '/products.html',
    }))).then(() => {}, () => {});

    let emailQueued = 0;
    let emailFailed = 0;
    let emailError = null;
    if (body.send_email) {
      const suppressionSync = await syncSesSuppressions(env, sb);
      if (!suppressionSync.ok) {
        emailFailed = 1;
        emailError = suppressionSync.error;
      } else {
        try {
          const emails = await memberEmails(sb, companyIds);
          if (emails.length) {
            const rendered = renderMarketingEmail({
              kind: 'promotion',
              campaign: {
                subject: title,
                heading: title,
                previewText: bodyText || title,
                eyebrow: 'VertKleen offer',
                bodyHtml: `<p>${emailEscape(bodyText).replace(/\r?\n/g, '<br>')}</p>`,
                ctaText: ctaUrl ? 'View offer' : undefined,
                ctaUrl: ctaUrl || undefined,
              },
              recipientContext: {
                reason: 'You received this offer because marketing email is enabled for your MASEST account.',
              },
            });
            for (let offset = 0; offset < emails.length; offset += 5) {
              const results = await Promise.all(emails.slice(offset, offset + 5).map((email) => queueMarketingEmail(env, {
                category: 'offer',
                email,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
                idempotencyKey: `offer/${offer.id}/${email}`,
                properties: { offer_id: offer.id, cta_url: ctaUrl || '', audience },
              })));
              emailQueued += results.filter((result) => result.ok).length;
              emailFailed += results.filter((result) => !result.ok).length;
              emailError ||= results.find((result) => !result.ok)?.error || null;
            }
          } else {
            emailError = 'no_email_recipients';
          }
        } catch (error) {
          emailFailed = 1;
          emailError = error.message || 'marketing_company_emails_unavailable';
        }
      }
    }

    const emailStatus = !body.send_email ? 'not_requested'
      : emailQueued && !emailFailed ? 'queued'
        : emailQueued ? 'partially_queued'
          : 'failed';
    await sb.from('offers').update({
      email_status: emailStatus,
      email_queued_count: emailQueued,
      email_failed_count: emailFailed,
    }).eq('id', offer.id);

    return json(201, {
      ok: true,
      id: offer.id,
      recipients: companyIds.length,
      emailed: false,
      email_queued: emailQueued > 0,
      email_queued_count: emailQueued,
      email_failed_count: emailFailed,
      email_status: emailStatus,
      email_error: emailError,
    });
  }

  return json(405, { error: 'method_not_allowed' });
}
