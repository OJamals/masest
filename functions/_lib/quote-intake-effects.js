import { emailLayout, sendEmailResult } from './supabase.js';
import { htmlEscape } from './supabase.js';
import { QUOTE_TASK_DETAILS, PRIVATE_LABEL_DETAILS } from '../../js/quote-task-details.js';
import { normalizeRequestPhone } from '../../js/request-phone.js';
import { leadAttribution, leadAcquisitionLabel } from '../../js/lead-attribution.js';

export const QUOTE_LABELS = {
  name: 'Name', company: 'Company', email: 'Email', phone: 'Phone', type: 'Request type', product: 'Product',
  request_topic: 'Request topic', contact_preference: 'Preferred reply',
  industry: 'Industry', volume: 'Volume', location: 'Location', timeline: 'Timeline', system: 'System / asset',
  audit_timeframe: 'Preferred timeframe', samples: 'Sample products', ship_to: 'Ship-to address', territory: 'Territory / region',
  program_assets: 'Sites, vehicles, or technicians', pilot_size: 'First pilot scope', current_sku_count: 'Current chemical count',
  monthly_usage: 'Estimated monthly usage', preferred_packs: 'Preferred packs', current_vendor: 'Current supplier or program',
  program_services: 'Program services', marketing_email_enabled: 'Marketing email consent', message: 'Notes',
  ...Object.fromEntries(QUOTE_TASK_DETAILS.map(({ name, label }) => [name, label])),
  ...Object.fromEntries(PRIVATE_LABEL_DETAILS.map(({ name, label }) => [name, label])),
};

function displayRows(payload) {
  const metadata = new Set(['attribution', 'utm_source', 'utm_medium', 'utm_campaign']);
  const entries = Object.entries(payload || {}).filter(([key, value]) => !metadata.has(key)
    && String(Array.isArray(value) ? value.join(', ') : value || '').trim());
  const attribution = leadAttribution({ payload });
  if (attribution) {
    entries.push(['Acquisition source', leadAcquisitionLabel(attribution)]);
    if (attribution.landing_path) entries.push(['Entry page', attribution.landing_path]);
  }
  return entries.map(([key, value]) => `<tr><td style="padding:6px 10px;color:#667">${htmlEscape(QUOTE_LABELS[key] || key)}</td><td style="padding:6px 10px">${htmlEscape(Array.isArray(value) ? value.join(', ') : value)}</td></tr>`).join('');
}

export async function deliverQuoteIntakeEmail(env, sb, quote, kind, dependencies = {}) {
  const send = dependencies.sendEmail || sendEmailResult;
  const email = String(quote?.email || '').trim().toLowerCase();
  const callback = quote?.type === 'callback';
  const name = String(quote?.name || '').trim() || 'there';
  if (kind === 'autoreply') {
    if (callback) return { ok: false, retryable: false, error: 'callback_no_email_requested' };
    if (!email) return { ok: false, retryable: false, error: 'quote_email_missing' };
    return send(env, {
      to: [email],
      subject: 'We received your MASEST request',
      category: 'lead_autoreply',
      html: emailLayout({
        heading: `Thanks for reaching out, ${name}`,
        bodyHtml: '<p>We received your request. A MASEST team member will review it and follow up with next steps.</p>',
        ctaText: 'Visit MASEST',
        ctaUrl: env.SITE_URL || 'https://masest.co',
      }),
      idempotencyKey: `quote-intake/${quote.id}/autoreply`,
    });
  }
  const priority = String(quote?.priority || 'normal');
  const type = String(quote?.type || 'quote');
  const reqLabel = type.charAt(0).toUpperCase() + type.slice(1);
  const company = String(quote?.company || quote?.name || email);
  const phone = normalizeRequestPhone(quote?.phone || quote?.payload?.phone);
  const phoneAction = phone ? `<p>${callback ? 'Please call' : 'Phone:'} <a href="tel:${htmlEscape(phone.replace(/[^+\d]/g, ''))}">${htmlEscape(phone)}</a>${callback ? ' about this request.' : ''}</p>` : '';
  const rows = displayRows(quote?.payload);
  return send(env, {
    to: ['matthew@masest.co'],
    replyTo: callback ? null : email || null,
    subject: callback ? `Call requested: ${phone}` : `New ${priority} ${reqLabel} request - ${company}`,
    category: 'lead_internal',
    html: emailLayout({
      heading: callback ? 'New call request' : `New ${reqLabel} request`,
      bodyHtml: `${callback ? '' : `<p><b>Lead score:</b> ${Number(quote?.lead_score || 0)} (${htmlEscape(priority)})</p>`}${phoneAction}<table style="border-collapse:collapse">${rows}</table>`,
    }),
    idempotencyKey: `quote-intake/${quote.id}/internal`,
  });
}
