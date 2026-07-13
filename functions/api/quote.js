// /api/quote - public contact/quote intake. Stores the lead in Supabase
// best-effort, emails sales and the buyer, and subscribes quote leads to the
// matching Klaviyo industry nurture list when configured.
import { adminClient, emailLayout, htmlEscape, json, sendEmail } from '../_lib/supabase.js';
import { clientIp, rateLimit } from '../_lib/ratelimit.js';
import { subscribeLeadByIndustry } from '../_lib/klaviyo.js';
import {
  RequestBodyTooLargeError,
  readBoundedFormData,
  readBoundedJson,
} from '../_lib/request-body.js';
import { verifyTurnstile } from '../_lib/turnstile.js';

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
  samples: 'Sample products',
  ship_to: 'Ship-to address',
  territory: 'Territory / region',
  message: 'Notes',
};

function fieldValues(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeRequestType(value) {
  return String(value || 'quote').trim().toLowerCase().slice(0, 40) || 'quote';
}

function sampleProductSummary(fields) {
  const samples = fieldValues(fields.samples);
  if (samples.length) return samples.join(', ');
  return String(fields.product || '').trim();
}

function pipelineStageForType(type) {
  return type === 'sample' ? 'sample_audit' : 'new';
}

function nextStepForType(type) {
  if (type === 'sample') return 'Confirm sample fit, ship-to address, and trial follow-up.';
  return null;
}

function scoreLead(fields) {
  const text = Object.values(fields).join(' ').toLowerCase();
  let score = 20;
  if (fields.company) score += 10;
  if (fields.phone) score += 8;
  if (fields.product) score += 8;
  if (fields.samples) score += 10;
  if (fields.industry) score += 6;
  if (fields.location || fields.ship_to) score += 6;
  if (fields.volume) score += /pallet|case|bulk|truck|monthly|weekly|\d{3,}/i.test(String(fields.volume)) ? 18 : 8;
  if (/urgent|asap|this week|immediate|rush|today|tomorrow/.test(text)) score += 18;
  if (/distributor|dealer|reseller|net terms|standing order|program/.test(text)) score += 14;
  if (String(fields.type || '').toLowerCase().includes('audit')) score += 8;
  if (String(fields.type || '').toLowerCase().includes('sample')) score += 10;
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

export async function handleQuote({ request, env }, dependencies = {}) {
  const checkRateLimit = dependencies.rateLimit || rateLimit;
  const verifyCaptcha = dependencies.verifyTurnstile || verifyTurnstile;
  const getAdminClient = dependencies.adminClient || adminClient;
  const sendMessage = dependencies.sendEmail || sendEmail;
  const subscribeLead = dependencies.subscribeLeadByIndustry || subscribeLeadByIndustry;
  const ct = request.headers.get('content-type') || '';
  const rl = await checkRateLimit(env, 'quote', clientIp(request), { limit: 8, windowSec: 60 });
  if (!rl.ok) return json(429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfter || 60) });

  const fields = {};
  try {
    if (ct.includes('application/json')) {
      Object.assign(fields, await readBoundedJson(request, 64 * 1024));
    } else {
      const fd = await readBoundedFormData(request, 64 * 1024);
      for (const [key, value] of fd.entries()) {
        fields[key] = key in fields ? [].concat(fields[key], value) : value;
      }
    }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json(413, { error: 'request_too_large' });
    }
    return json(400, { error: 'bad_request' });
  }

  if (String(fields._gotcha || '').trim()) return json(200, { ok: true });

  const name = String(fields.name || '').trim();
  const email = String(fields.email || '').trim();
  const company = String(fields.company || '').trim();
  if (!name || !EMAIL_RE.test(email)) return json(400, { error: 'invalid_input' });

  const token = fields['cf-turnstile-response'];
  const secret = env.TURNSTILE_SECRET || env.MASEST_TURNSTILE_SECRET;
  const captcha = await verifyCaptcha({
    secret,
    token,
    remoteip: request.headers.get('cf-connecting-ip') || '',
  });
  if (captcha.status === 'rejected') return json(400, { error: 'captcha_failed' });
  if (captcha.status === 'unavailable') return json(503, { error: 'captcha_unavailable' });

  const type = normalizeRequestType(fields.type);
  const payload = { ...fields };
  delete payload._gotcha;
  delete payload['cf-turnstile-response'];

  const leadScore = scoreLead(fields);
  const priority = priorityForScore(leadScore);
  const pipelineStage = pipelineStageForType(type);
  const nextStep = nextStepForType(type);
  const product = type === 'sample'
    ? (sampleProductSummary(fields) || fields.product || null)
    : (fields.product || null);
  let saved = false;

  try {
    const sb = getAdminClient(env);
    const row = {
      type,
      name,
      email,
      company,
      phone: fields.phone || null,
      product,
      industry: fields.industry || null,
      location: fields.location || fields.ship_to || null,
      message: fields.message || null,
      payload,
      source: 'contact',
      status: 'new',
      lead_score: leadScore,
      priority: priorityForScore(leadScore),
      pipeline_stage: pipelineStage,
      next_step: nextStep,
    };
    let { error } = await sb.from('quotes').insert(row);
    if (error && /pipeline_stage|next_step|schema cache|column/i.test(error.message || '')) {
      const fallback = { ...row };
      delete fallback.pipeline_stage;
      delete fallback.next_step;
      ({ error } = await sb.from('quotes').insert(fallback));
    }
    saved = !error;
  } catch {
    saved = false;
  }

  const reqLabel = type.charAt(0).toUpperCase() + type.slice(1);
  const rows = displayRows(payload);

  await sendMessage(env, {
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

  await sendMessage(env, {
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
    await subscribeLead(env, { email, industry: fields.industry });
  } catch (error) {
    console.warn('klaviyo_quote_subscribe_failed', error);
  }

  return json(200, { ok: true, saved, lead_score: leadScore });
}

export function createQuoteHandler(dependencies = {}) {
  return (context) => handleQuote(context, dependencies);
}

export async function onRequestPost(context) {
  return handleQuote(context);
}
