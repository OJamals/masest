import { emailLayout, sendEmailResult } from './supabase.js';
import { htmlEscape } from './supabase.js';
import { QUOTE_TASK_DETAILS } from '../../js/quote-task-details.js';

export const QUOTE_LABELS = {
  name: 'Name', company: 'Company', email: 'Email', phone: 'Phone', type: 'Request type', product: 'Product',
  industry: 'Industry', volume: 'Volume', location: 'Location', timeline: 'Timeline', system: 'System / asset',
  audit_timeframe: 'Preferred timeframe', samples: 'Sample products', ship_to: 'Ship-to address', territory: 'Territory / region',
  program_assets: 'Sites, vehicles, or technicians', pilot_size: 'First pilot scope', current_sku_count: 'Current chemical count',
  monthly_usage: 'Estimated monthly usage', preferred_packs: 'Preferred packs', current_vendor: 'Current supplier or program',
  program_services: 'Program services', marketing_email_enabled: 'Marketing email consent', message: 'Notes',
  ...Object.fromEntries(QUOTE_TASK_DETAILS.map(({ name, label }) => [name, label])),
};

function displayRows(payload) {
  return Object.entries(payload || {}).filter(([, value]) => String(Array.isArray(value) ? value.join(', ') : value || '').trim())
    .map(([key, value]) => `<tr><td style="padding:6px 10px;color:#667">${htmlEscape(QUOTE_LABELS[key] || key)}</td><td style="padding:6px 10px">${htmlEscape(Array.isArray(value) ? value.join(', ') : value)}</td></tr>`).join('');
}

export async function deliverQuoteIntakeEmail(env, sb, quote, kind, dependencies = {}) {
  const send = dependencies.sendEmail || sendEmailResult;
  const email = String(quote?.email || '').trim().toLowerCase();
  if (!email) return { ok: false, retryable: false, error: 'quote_email_missing' };
  const name = String(quote?.name || '').trim() || 'there';
  if (kind === 'autoreply') {
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
  const company = String(quote?.company || name);
  const rows = displayRows(quote?.payload);
  return send(env, {
    to: dependencies.salesRecipients
      ? dependencies.salesRecipients(env)
      : String(env.SALES_EMAIL || env.ORDER_NOTIFY_EMAIL || env.CONTACT_EMAIL || env.ADMIN_EMAILS || env.ADMIN_EMAIL || 'matthew@masest.co').split(',').map((value) => value.trim()).filter(Boolean),
    subject: `New ${priority} ${reqLabel} request - ${company}`,
    category: 'lead_internal',
    html: emailLayout({
      heading: `New ${reqLabel} request`,
      bodyHtml: `<p><b>Lead score:</b> ${Number(quote?.lead_score || 0)} (${htmlEscape(priority)})</p><table style="border-collapse:collapse">${rows}</table>`,
    }),
    idempotencyKey: `quote-intake/${quote.id}/internal`,
  });
}
