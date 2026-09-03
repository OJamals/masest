import { adminClient } from './supabase.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeMarketingEmails(values = []) {
  const seen = new Set();
  const emails = [];
  for (const value of values || []) {
    const email = String(value || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

export async function setMarketingPreferences(env, {
  emails = [],
  enabled,
  source = 'preference',
  userId = null,
  name = null,
  tags = [],
} = {}, { sb = adminClient(env) } = {}) {
  const normalized = normalizeMarketingEmails(emails);
  if (!normalized.length || typeof enabled !== 'boolean') {
    return { ok: false, count: 0, retryable: false, error: 'invalid_marketing_preference' };
  }
  const { data, error } = await sb.rpc('set_marketing_email_preferences', {
    p_emails: normalized,
    p_enabled: enabled,
    p_source: String(source || 'preference').slice(0, 80),
    p_user_id: userId || null,
    p_name: name ? String(name).slice(0, 120) : null,
    p_tags: (Array.isArray(tags) ? tags : []).map((tag) => String(tag).slice(0, 40)).slice(0, 10),
  });
  if (error) {
    return { ok: false, count: 0, retryable: true, error: 'marketing_preference_write_failed' };
  }
  const count = Number(data) || 0;
  if (count !== normalized.length) {
    return { ok: false, count, retryable: true, error: 'marketing_preference_partial_write' };
  }
  return { ok: true, count };
}

export async function setMarketingPreference(env, {
  email,
  enabled,
  source,
  userId,
  name,
  tags,
} = {}, dependencies) {
  return setMarketingPreferences(env, {
    emails: [email], enabled, source, userId, name, tags,
  }, dependencies);
}

export async function loadMarketingAudience(sb, { pageSize = 1000, maxPages = 100 } = {}) {
  const size = Math.min(1000, Math.max(1, Number(pageSize) || 1000));
  const pages = Math.min(100, Math.max(1, Number(maxPages) || 100));
  const emails = [];
  let complete = false;
  for (let page = 0; page < pages; page += 1) {
    const start = page * size;
    const { data, error } = await sb.from('newsletter_recipients')
      .select('email')
      .eq('subscribed', true)
      .range(start, start + size - 1);
    if (error) throw new Error('marketing_audience_unavailable');
    const rows = data || [];
    emails.push(...rows.map((row) => row.email));
    if (rows.length < size) {
      complete = true;
      break;
    }
  }
  if (!complete) throw new Error('marketing_audience_truncated');
  return normalizeMarketingEmails(emails);
}
