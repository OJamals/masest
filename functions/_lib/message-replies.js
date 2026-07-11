// Signed reply-to addresses for first-party support threads. The UUID identifies
// the company; the HMAC prevents forged addresses from routing arbitrary inbound mail.

const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const TOKEN_HEX_LENGTH = 20;

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signature(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

export function inboundDomain(env) {
  const domain = String(env?.RESEND_INBOUND_DOMAIN || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) return '';
  let appDomain = '';
  try { appDomain = new URL(String(env?.APP_URL || '')).hostname.toLowerCase(); }
  catch { appDomain = ''; }
  const primary = appDomain.replace(/^www\./, '');
  if (primary && domain.replace(/^www\./, '') === primary) return '';
  return domain;
}

export async function messageReplyAddress(env, companyId) {
  const domain = inboundDomain(env);
  const secret = String(env?.MESSAGE_REPLY_SECRET || '');
  const id = String(companyId || '').toLowerCase();
  if (!domain || !secret || !UUID_RE.test(id)) return null;
  const token = (await signature(`message-reply:${id}`, secret)).slice(0, TOKEN_HEX_LENGTH);
  return `reply+${id}.${token}@${domain}`;
}

export async function companyIdFromReplyAddress(env, recipients) {
  const domain = inboundDomain(env);
  const secret = String(env?.MESSAGE_REPLY_SECRET || '');
  if (!domain || !secret) return null;
  const values = Array.isArray(recipients) ? recipients : [recipients];
  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matchRe = new RegExp(`^reply\\+(${UUID_RE.source.slice(1, -1)})\\.([a-f0-9]{${TOKEN_HEX_LENGTH}})@${escapedDomain}$`, 'i');
  for (const recipient of values) {
    const match = String(recipient || '').trim().toLowerCase().match(matchRe);
    if (!match) continue;
    const [, id, token] = match;
    const expected = (await signature(`message-reply:${id}`, secret)).slice(0, TOKEN_HEX_LENGTH);
    if (token === expected) return id;
  }
  return null;
}

export function inboundReplyText(value) {
  const text = String(value || '').replace(/\r/g, '').trim();
  const beforeQuotedReply = text.split(/\nOn .+wrote:\n/i)[0].split(/^From:\s.+$/im)[0];
  return beforeQuotedReply.replace(/^>.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}
