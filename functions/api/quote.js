// /api/quote — public contact/quote intake. Replaces the Formspree endpoint.
// Stores the lead in Supabase (best-effort) and emails sales + an autoreply via Resend.
// Spam defense: honeypot (_gotcha) + SOFT Turnstile — a token is verified only when one is
// present AND a secret is set, so a misconfigured/absent CAPTCHA never blocks a real lead.
import { adminClient, json, sendEmail, htmlEscape, emailLayout } from '../_lib/supabase.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LABELS = {
  name: 'Name', company: 'Company', email: 'Email', phone: 'Phone', type: 'Request type',
  product: 'Product', industry: 'Industry', volume: 'Volume', location: 'Location',
  timeline: 'Timeline', system: 'System / asset', audit_timeframe: 'Preferred timeframe',
  samples: 'Sample products', ship_to: 'Ship-to address', company_type: 'Company type',
  territory: 'Territory / region', message: 'Notes',
};

export async function onRequestPost({ request, env }) {
  // Accept multipart/form-data (the site form posts FormData) or JSON.
  const fields = {};
  const ct = request.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) Object.assign(fields, await request.json());
    else {
      const fd = await request.formData();
      for (const [k, v] of fd.entries()) fields[k] = (k in fields) ? [].concat(fields[k], v) : v;
    }
  } catch { return json(400, { error: 'bad_request' }); }

  // Honeypot: real users leave _gotcha empty. Pretend success so bots don't retry.
  if (String(fields._gotcha || '').trim()) return json(200, { ok: true });

  const name = String(fields.name || '').trim();
  const email = String(fields.email || '').trim();
  const company = String(fields.company || '').trim();
  if (!name || !EMAIL_RE.test(email)) return json(400, { error: 'invalid_input' });

  // Soft Turnstile — verify only when a token is present and a secret is configured.
  const token = fields['cf-turnstile-response'];
  const secret = env.TURNSTILE_SECRET || env.MASEST_TURNSTILE_SECRET;
  if (token && secret) {
    try {
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: String(token), remoteip: request.headers.get('cf-connecting-ip') || '' }),
      });
      const out = await r.json();
      if (!out.success) return json(400, { error: 'captcha_failed' });
    } catch (e) { console.warn('captcha_verify_failed', e?.message || e); /* unreachable verify → don't strand the lead */ }
  }

  const type = String(fields.type || 'quote').slice(0, 40);
  const payload = { ...fields };
  delete payload._gotcha;
  delete payload['cf-turnstile-response'];

  // Persist (best-effort). Pre-migration the table is absent → insert fails, email still sends.
  let saved = false;
  try {
    const sb = adminClient(env);
    const { error } = await sb.from('quotes').insert({
      type, name, email, company: company || null,
      phone: String(fields.phone || '') || null,
      product: String(fields.product || '') || null,
      industry: String(fields.industry || '') || null,
      location: String(fields.location || '') || null,
      message: String(fields.message || '') || null,
      payload, source: 'contact', status: 'new',
    });
    saved = !error;
  } catch { /* email is the guaranteed path */ }

  // Notify sales + autoreply (best-effort; sendEmail is a no-op without RESEND_API_KEY).
  const rows = Object.entries(payload)
    .filter(([, v]) => String(Array.isArray(v) ? v.join('') : (v ?? '')).trim())
    .map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:#667;vertical-align:top"><b>${htmlEscape(LABELS[k] || k)}</b></td><td>${htmlEscape(Array.isArray(v) ? v.join(', ') : v)}</td></tr>`)
    .join('');
  const salesTo = String(env.SALES_EMAIL || env.ORDER_NOTIFY_EMAIL || 'matthew@masest.co')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const reqLabel = type.charAt(0).toUpperCase() + type.slice(1);
  await sendEmail(env, {
    to: salesTo,
    subject: `New ${reqLabel} request — ${company || name}`,
    html: emailLayout({ heading: `New ${htmlEscape(reqLabel)} request`, bodyHtml: `<table style="font-size:14px;border-collapse:collapse">${rows}</table>` }),
  });
  await sendEmail(env, {
    to: [email],
    subject: 'We received your MASEST request',
    html: emailLayout({
      heading: `Thanks for reaching out, ${htmlEscape(name)}`,
      bodyHtml: `<p>We received your ${htmlEscape(type)} request — a sales or technical contact will follow up directly.</p><p style="color:#667">If it's urgent, email <a href="mailto:matthew@masest.co">matthew@masest.co</a> or call (813) 406-3852.</p>`,
    }),
  });

  return json(200, { ok: true, saved });
}
