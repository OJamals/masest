// /api/quote - public contact/quote intake. Stores the lead in Supabase
// best-effort, emails sales and the buyer, and subscribes quote leads to the
// matching Klaviyo industry nurture list when configured.
import { adminClient, emailLayout, htmlEscape, json, sendEmail } from '../_lib/supabase.js';
import { clientIp, rateLimit } from '../_lib/ratelimit.js';
import { subscribeLeadByIndustry } from '../_lib/klaviyo.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const LABELS = {
  name: 'Name',
  company: 'Company',
  email: 'Email',
  phone: 'Phone',
  type: 'Request type',
  product: 'Product',
  industry: 'Industry',
  volume: 'Volume',
  location: 'Location',
  timeline: 'Timeline',
  system: 'System / asset',
  audit_timeframe: 'Preferred timeframe',
  ship_to: 'Ship-to address',
  territory: 'Territory / region',
  message: 'Notes',
};

function scoreLead(fields) {
  const text = Object.values(fields).join(' ').toLowerCase();
  let score = 20;
  if (fields.company) score += 10;
  if (fields.phone) score += 8;
  if (fields.product) score += 8;
  if (fields.industry) score += 6;
  if (fields.location || fields.ship_to) score += 6;
  if (fields.volume) score += /pallet|case|bulk|truck|monthly|weekly|\d{3,}/i.test(String(fields.volume)) ? 18 : 8;
  if (/urgent|asap|this week|immediate|rush|today|tomorrow/.test(text)) score += 18;
  if (/distributor|dealer|reseller|net terms|standing order|program/.test(text)) score += 14;
  if (String(fields.type || '').toLowerCase().includes('audit')) score += 8;
  return Math.min(100, score);
}

function priorityForScore(leadScore) {
  if (leadScore >= 75) return 'urgent';
  if (leadScore >= 55) return 'high';
  if (leadScore >= 35) return 'normal';
  return 'low';
}

function salesRecipients(env) {
  return String(env.SALES_EMAIL || env.ORDER_NOTIFY_EMAIL || env.CONTACT_EMAIL || env.ADMIN_EMAILS || env.ADMIN_EMAIL || 'matthew@masest.co')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
}

function displayRows(payload) {
  return Object.entries(payload)
    .filter(([, value]) => String(Array.isArray(value) ? value.join(', ') : value || '').trim())
    .map(([key, value]) => {
      const label = LABELS[key] || key;
      const display = Array.isArray(value) ? value.join(', ') : value;
      return `<tr><td style="padding:6px 10px;color:#667">${htmlEscape(label)}</td><td style="padding:6px 10px">${htmlEscape(display)}</td></tr>`;
    })
    .join('');
}

export async function onRequestPost({ request, env }) {
  const fields = {};
  const ct = request.headers.get('content-type') || '';

  try {
    if (ct.includes('application/json')) {
      Object.assign(fields, await request.json());
    } else {
      const fd = await request.formData();
      for (const [key, value] of fd.entries()) {
        fields[key] = key in fields ? [].concat(fields[key], value) : value;
      }
    }
  } catch {
    return json(400, { error: 'bad_request' });
  }

  if (String(fields._gotcha || '').trim()) return json(200, { ok: true });

  const rl = await rateLimit(env, 'quote', clientIp(request), { limit: 8, windowSec: 60 });
  if (!rl.ok) return json(429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfter || 60) });

  const name = String(fields.name || '').trim();
  const email = String(fields.email || '').trim();
  const company = String(fields.company || '').trim();
  if (!name || !EMAIL_RE.test(email)) return json(400, { error: 'invalid_input' });

  const token = fields['cf-turnstile-response'];
  const secret = env.TURNSTILE_SECRET || env.MASEST_TURNSTILE_SECRET;
  if (token && secret) {
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret,
          response: String(token),
          remoteip: request.headers.get('cf-connecting-ip') || '',
        }),
      });
      const out = await response.json();
      if (!out.success) return json(400, { error: 'captcha_failed' });
    } catch (error) {
      console.warn('captcha_verify_failed', error);
    }
  }

  const type = String(fields.type || 'quote').slice(0, 40);
  const payload = { ...fields };
  delete payload._gotcha;
  delete payload['cf-turnstile-response'];

  const leadScore = scoreLead(fields);
  const priority = priorityForScore(leadScore);
  let saved = false;

  try {
    const sb = adminClient(env);
    const { error } = await sb.from('quotes').insert({
      type,
      name,
      email,
      company,
      phone: fields.phone || null,
      product: fields.product || null,
      industry: fields.industry || null,
      location: fields.location || fields.ship_to || null,
      message: fields.message || null,
      payload,
      source: 'contact',
      status: 'new',
      lead_score: leadScore,
      priority: priorityForScore(leadScore),
    });
    saved = !error;
  } catch {
    saved = false;
  }

  const reqLabel = type.charAt(0).toUpperCase() + type.slice(1);
  const rows = displayRows(payload);

  await sendEmail(env, {
    to: salesRecipients(env),
    subject: `New ${priority} ${reqLabel} request - ${company || name}`,
    category: 'lead_internal',
    html: emailLayout({
      heading: `New ${htmlEscape(reqLabel)} request`,
      bodyHtml: `
        <p><b>Lead score:</b> ${leadScore} (${htmlEscape(priority)})</p>
        <table style="border-collapse:collapse">${rows}</table>
        ${saved ? '' : '<p style="color:#b42318">Lead email sent, but database save did not complete.</p>'}
      `,
    }),
  });

  await sendEmail(env, {
    to: [email],
    subject: 'We received your MASEST request',
    category: 'lead_autoreply',
    html: emailLayout({
      heading: `Thanks for reaching out, ${htmlEscape(name)}`,
      bodyHtml: '<p>We received your request. A MASEST team member will review it and follow up with next steps.</p>',
      ctaText: 'Visit MASEST',
      ctaUrl: env.SITE_URL || 'https://masest.co',
    }),
  });

  try {
    await subscribeLeadByIndustry(env, { email, industry: fields.industry });
  } catch (error) {
    console.warn('klaviyo_quote_subscribe_failed', error);
  }

  return json(200, { ok: true, saved, lead_score: leadScore });
}
