// /api/quote - public contact/quote intake. A durable, idempotent lead record is the
// acknowledgement boundary; email and nurture delivery happen only after that commit.
import { adminClient, json } from '../_lib/supabase.js';
import { clientIp, rateLimit } from '../_lib/ratelimit.js';
import {
  RequestBodyTooLargeError,
  readBoundedFormData,
  readBoundedJson,
} from '../_lib/request-body.js';
import { verifyTurnstile } from '../_lib/turnstile.js';
import { QUOTE_TASK_DETAILS, PRIVATE_LABEL_DETAILS } from '../../js/quote-task-details.js';
import { normalizeRequestPhone } from '../../js/request-phone.js';
import { normalizeLeadAttribution } from '../../js/lead-attribution.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_FIELD_LIMITS = Object.fromEntries(
  [...QUOTE_TASK_DETAILS, ...PRIVATE_LABEL_DETAILS].map(({ name, limit }) => [name, limit]),
);


function fieldValues(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeRequestType(value) {
  return String(value || 'quote').trim().toLowerCase().slice(0, 40) || 'quote';
}

function checked(value) {
  return value === true || ['1', 'true', 'on', 'yes'].includes(String(value || '').trim().toLowerCase());
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
  if (type === 'callback') return 'Matthew to call the provided number and confirm the request scope.';
  if (type === 'private-label') return 'Confirm product fit, branding, quantity, packaging, delivery location, and private-label quote scope.';
  if (type === 'sample') return 'Confirm sample fit, ship-to address, and trial follow-up.';
  if (type === 'program') return 'Confirm current chemical inventory, pilot scope, training, and supply needs.';
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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function quoteIntakeFingerprint(row, legacy = false) {
  // Optional attribution can arrive late or be blocked. It must not split one retry
  // into a second lead or conflict with the same submission from an older browser.
  const payload = { ...row.payload };
  delete payload.attribution;
  const fingerprintRow = { ...row, payload };
  if (legacy) {
    fingerprintRow.lead_score = scoreLead(payload);
    fingerprintRow.priority = priorityForScore(fingerprintRow.lead_score);
  } else {
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) delete payload[key];
  }
  const bytes = new TextEncoder().encode(stableJson(fingerprintRow));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function saveQuoteIntake(sb, { intakeId, fingerprint, legacyFingerprint, row }) {
  const candidates = [...new Set([fingerprint, legacyFingerprint].filter(Boolean))];
  for (const candidate of candidates) {
    const { data, error } = await sb.rpc('save_quote_intake', {
      p_intake_id: intakeId,
      p_fingerprint: candidate,
      p_quote: row,
    });
    if (error) {
      const collision = /quote_intake_identity_collision/i.test(error.message || '');
      // A row saved by the preceding release included campaign labels in its hash.
      // Only an exact old fingerprint may acknowledge it; never replace the row.
      if (collision && candidate !== candidates.at(-1)) continue;
      return { error: collision ? 'idempotency_conflict' : 'intake_unavailable' };
    }
    const quoteId = String(data?.quote_id || '');
    if (!UUID.test(quoteId)) return { error: 'intake_unavailable' };
    return { quoteId, duplicate: data?.duplicate === true };
  }
}

export async function handleQuote({ request, env }, dependencies = {}) {
  const checkRateLimit = dependencies.rateLimit || rateLimit;
  const verifyCaptcha = dependencies.verifyTurnstile || verifyTurnstile;
  const getAdminClient = dependencies.adminClient || adminClient;
  const persistIntake = dependencies.saveIntake || saveQuoteIntake;
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
  const attribution = normalizeLeadAttribution(fields.attribution);
  delete fields.attribution;
  // Older cached forms send campaign fields at the top level. Keep only safe labels.
  const campaign = normalizeLeadAttribution(fields);
  for (const key of Object.keys(fields).filter((key) => key.startsWith('utm_'))) {
    delete fields[key];
    if (campaign?.[key]) fields[key] = campaign[key];
  }

  const type = normalizeRequestType(fields.type);
  const callback = type === 'callback';
  if (callback) {
    const phone = normalizeRequestPhone(fields.phone);
    if (!phone) return json(400, { error: 'valid_phone_required' });
    const topic = String(fields.request_topic || 'quote');
    const topics = ['quote', 'private-label', 'audit', 'program', 'sample', 'technical', 'distributor', 'government'];
    // Phone-only callbacks must not retain inactive form details or opt into email.
    for (const key of Object.keys(fields)) {
      if (!['type', 'phone', 'product', 'submission_id', 'cf-turnstile-response'].includes(key)) delete fields[key];
    }
    fields.phone = phone;
    fields.request_topic = topics.includes(topic) ? topic : 'quote';
    if (fields.product) fields.product = String(fields.product).trim().slice(0, 240);
  }
  fields.contact_preference = callback ? 'phone' : 'email';
  const name = String(fields.name || '').trim();
  const email = String(fields.email || '').trim();
  const company = String(fields.company || '').trim();
  if (!callback && !EMAIL_RE.test(email)) return json(400, { error: 'invalid_input' });

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

  const marketingConsent = !callback && checked(fields.marketing_email_enabled);
  fields.marketing_email_enabled = marketingConsent;
  const payload = { ...fields };
  delete payload._gotcha;
  delete payload['cf-turnstile-response'];
  delete payload.submission_id;

  // Transport-only identity/CAPTCHA fields must never change the durable fingerprint or
  // lead score across an otherwise identical retry.
  const leadDetails = { ...payload };
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) delete leadDetails[key];
  const leadScore = scoreLead(leadDetails);
  if (attribution) payload.attribution = attribution;
  const priority = priorityForScore(leadScore);
  const pipelineStage = pipelineStageForType(type);
  const nextStep = nextStepForType(type);
  const product = type === 'sample'
    ? (sampleProductSummary(fields) || fields.product || null)
    : (fields.product || null);
  const row = {
    type,
    name: name || null,
    email: email || null,
    company: company || null,
    phone: fields.phone || null,
    product,
    industry: fields.industry || null,
    location: type === 'private-label'
      ? (fields.private_label_destination || fields.location || null)
      : (fields.location || fields.ship_to || null),
    message: fields.message || null,
    payload,
    source: 'contact',
    status: 'new',
    lead_score: leadScore,
    priority,
    pipeline_stage: pipelineStage,
    next_step: nextStep,
  };
  let durable;
  let sb;
  try {
    sb = getAdminClient(env);
    if (typeof sb?.rpc === 'function') {
      const readiness = await sb.rpc('assert_email_effects_ready');
      if (readiness?.error) return json(503, { error: 'durable_email_effects_not_ready', retryable: true });
    }
    durable = await persistIntake(sb, {
      intakeId,
      fingerprint: await quoteIntakeFingerprint(row),
      legacyFingerprint: await quoteIntakeFingerprint(row, true),
      row,
    });
  } catch (error) {
    console.error('quote_intake_persist_failed', error?.name || 'error');
    durable = { error: 'intake_unavailable' };
  }
  if (durable?.error === 'idempotency_conflict') return json(409, { error: durable.error });
  if (!durable?.quoteId) return json(503, { error: 'intake_unavailable', retryable: true });

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
