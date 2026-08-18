// /api/quote - public contact/quote intake. A durable, idempotent lead record is the
// acknowledgement boundary; email and nurture delivery happen only after that commit.
import { adminClient, emailLayout, htmlEscape, json, sendEmail } from '../_lib/supabase.js';
import { clientIp, rateLimit } from '../_lib/ratelimit.js';
import { subscribeLeadByIndustry } from '../_lib/klaviyo.js';
import {
  RequestBodyTooLargeError,
  readBoundedFormData,
  readBoundedJson,
} from '../_lib/request-body.js';
import { verifyTurnstile } from '../_lib/turnstile.js';
import { QUOTE_TASK_DETAILS } from '../../js/quote-task-details.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_FIELD_LIMITS = Object.fromEntries(
  QUOTE_TASK_DETAILS.map(({ name, limit }) => [name, limit]),
);

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
  ...Object.fromEntries(QUOTE_TASK_DETAILS.map(({ name, label }) => [name, label])),
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

function normalizeTaskDetails(fields) {
  for (const [key, limit] of Object.entries(TASK_FIELD_LIMITS)) {
    const value = fieldValues(fields[key]).join(', ').slice(0, limit);
    if (value) fields[key] = value;
    else delete fields[key];
  }
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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function quoteIntakeFingerprint(row) {
  const bytes = new TextEncoder().encode(stableJson(row));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function saveQuoteIntake(sb, { intakeId, fingerprint, row }) {
  const { data, error } = await sb.rpc('save_quote_intake', {
    p_intake_id: intakeId,
    p_fingerprint: fingerprint,
    p_quote: row,
  });
  if (error) {
    const collision = /quote_intake_identity_collision/i.test(error.message || '');
    return { error: collision ? 'idempotency_conflict' : 'intake_unavailable' };
  }
  const quoteId = String(data?.quote_id || '');
  if (!UUID.test(quoteId)) return { error: 'intake_unavailable' };
  return { quoteId, duplicate: data?.duplicate === true };
}

export async function handleQuote({ request, env }, dependencies = {}) {
  const checkRateLimit = dependencies.rateLimit || rateLimit;
  const verifyCaptcha = dependencies.verifyTurnstile || verifyTurnstile;
  const getAdminClient = dependencies.adminClient || adminClient;
  const persistIntake = dependencies.saveIntake || saveQuoteIntake;
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
  normalizeTaskDetails(fields);

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

  const intakeId = String(fields.submission_id || '').trim();
  if (!UUID.test(intakeId)) return json(400, { error: 'submission_id_required' });

  const type = normalizeRequestType(fields.type);
  const payload = { ...fields };
  delete payload._gotcha;
  delete payload['cf-turnstile-response'];
  delete payload.submission_id;

  // Transport-only identity/CAPTCHA fields must never change the durable fingerprint or
  // lead score across an otherwise identical retry.
  const leadScore = scoreLead(payload);
  const priority = priorityForScore(leadScore);
  const pipelineStage = pipelineStageForType(type);
  const nextStep = nextStepForType(type);
  const product = type === 'sample'
    ? (sampleProductSummary(fields) || fields.product || null)
    : (fields.product || null);
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
  let durable;
  try {
    const sb = getAdminClient(env);
    durable = await persistIntake(sb, {
      intakeId,
      fingerprint: await quoteIntakeFingerprint(row),
      row,
    });
  } catch (error) {
    console.error('quote_intake_persist_failed', error?.name || 'error');
    durable = { error: 'intake_unavailable' };
  }
  if (durable?.error === 'idempotency_conflict') return json(409, { error: durable.error });
  if (!durable?.quoteId) return json(503, { error: 'intake_unavailable', retryable: true });

  if (!durable.duplicate) {
    const reqLabel = type.charAt(0).toUpperCase() + type.slice(1);
    const rows = displayRows(payload);
    const followUps = await Promise.allSettled([
      sendMessage(env, {
        to: salesRecipients(env),
        subject: `New ${priority} ${reqLabel} request - ${company || name}`,
        category: 'lead_internal',
        html: emailLayout({
          heading: `New ${htmlEscape(reqLabel)} request`,
          bodyHtml: `
            <p><b>Lead score:</b> ${leadScore} (${htmlEscape(priority)})</p>
            <table style="border-collapse:collapse">${rows}</table>
          `,
        }),
      }),
      sendMessage(env, {
        to: [email],
        subject: 'We received your MASEST request',
        category: 'lead_autoreply',
        html: emailLayout({
          heading: `Thanks for reaching out, ${htmlEscape(name)}`,
          bodyHtml: '<p>We received your request. A MASEST team member will review it and follow up with next steps.</p>',
          ctaText: 'Visit MASEST',
          ctaUrl: env.SITE_URL || 'https://masest.co',
        }),
      }),
      subscribeLead(env, { email, industry: fields.industry }),
    ]);
    if (followUps.some(({ status }) => status === 'rejected')) {
      console.warn('quote_intake_follow_up_failed', durable.quoteId);
    }
  }

  return json(durable.duplicate ? 200 : 201, {
    ok: true,
    durable: true,
    quote_id: durable.quoteId,
    duplicate: durable.duplicate,
    lead_score: leadScore,
  });
}

export function createQuoteHandler(dependencies = {}) {
  return (context) => handleQuote(context, dependencies);
}

export async function onRequestPost(context) {
  return handleQuote(context);
}
