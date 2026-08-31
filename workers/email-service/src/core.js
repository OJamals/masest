const EMAIL_RE = /^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/;
const EMAIL_IN_TEXT_RE = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MESSAGE_ID_RE = /^<[^<>\s]{1,510}>$/;
const TRANSIENT_CODES = new Map([
  ['E_RATE_LIMIT_EXCEEDED', { status: 429, error: 'email_rate_limited' }],
  ['E_DAILY_LIMIT_EXCEEDED', { status: 429, error: 'email_daily_limit_exceeded' }],
  ['E_INTERNAL_SERVER_ERROR', { status: 503, error: 'email_provider_unavailable' }],
]);
const HARD_CODES = new Map([
  ['E_SENDER_NOT_VERIFIED', 'email_sender_not_verified'],
  ['E_SENDER_DOMAIN_NOT_AVAILABLE', 'email_sender_domain_unavailable'],
  ['E_RECIPIENT_NOT_ALLOWED', 'email_recipient_not_allowed'],
  ['E_RECIPIENT_SUPPRESSED', 'email_recipient_suppressed'],
  ['E_TOO_MANY_RECIPIENTS', 'email_too_many_recipients'],
  ['E_TOO_MANY_ATTACHMENTS', 'email_too_many_attachments'],
  ['E_CONTENT_TOO_LARGE', 'email_content_too_large'],
  ['E_VALIDATION_ERROR', 'email_validation_failed'],
  ['E_FIELD_MISSING', 'email_validation_failed'],
  ['E_DELIVERY_FAILED', 'email_delivery_failed'],
  ['E_HEADER_NOT_ALLOWED', 'email_header_not_allowed'],
  ['E_HEADER_USE_API_FIELD', 'email_header_not_allowed'],
  ['E_HEADER_VALUE_INVALID', 'email_header_invalid'],
  ['E_HEADER_VALUE_TOO_LONG', 'email_header_invalid'],
  ['E_HEADER_NAME_INVALID', 'email_header_invalid'],
  ['E_HEADERS_TOO_LARGE', 'email_header_invalid'],
  ['E_HEADERS_TOO_MANY', 'email_header_invalid'],
]);
// Live Email Service binding currently rejects Thread-Topic despite its docs allowlist.
// Standards-based In-Reply-To + References remain authoritative for threading.
const ALLOWED_HEADERS = new Set(['in-reply-to', 'references']);

function invalid(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function requestError(code, status) {
  const error = new Error(code);
  error.status = status;
  return error;
}

export async function readBoundedJsonRequest(request, maxBytes) {
  const declared = request.headers.get('content-length');
  if (/^\d+$/.test(declared || '') && Number(declared) > maxBytes) {
    throw requestError('request_too_large', 413);
  }
  const reader = request.body?.getReader?.();
  if (!reader) throw requestError('bad_request', 400);
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw requestError('request_too_large', 413);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw requestError('bad_request', 400);
  }
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  const separator = email.lastIndexOf('@');
  const local = separator > 0 ? email.slice(0, separator) : '';
  const domain = separator > 0 ? email.slice(separator + 1) : '';
  return EMAIL_RE.test(email) && local.length <= 64 && domain.length <= 253 && email.length <= 254 ? email : '';
}

function cleanRecipients(values) {
  if (!Array.isArray(values)) return [];
  const recipients = values.map(cleanEmail);
  if (recipients.some((value) => !value)) invalid('invalid_recipient');
  return [...new Set(recipients)];
}

function cleanHeaders(input) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) invalid('invalid_headers');
  const headers = {};
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = String(rawName || '');
    const lower = name.toLowerCase();
    const isCustom = /^X-[A-Za-z0-9_-]{1,98}$/i.test(name);
    if (!ALLOWED_HEADERS.has(lower) && !isCustom) invalid('header_not_allowed');
    const value = String(rawValue || '');
    if (!value || new TextEncoder().encode(value).byteLength > 2048 || /[\r\n]/.test(value)) {
      invalid('invalid_header_value');
    }
    const canonical = lower === 'in-reply-to' ? 'In-Reply-To'
      : lower === 'references' ? 'References' : name;
    headers[canonical] = value;
  }
  return headers;
}

function cleanAttachments(input) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 32) invalid('invalid_attachments');
  return input.map((attachment) => {
    if (!attachment || typeof attachment !== 'object') invalid('invalid_attachment');
    const content = String(attachment.content || '');
    const filename = String(attachment.filename || '').trim();
    const type = String(attachment.type || '').trim().toLowerCase();
    const disposition = attachment.disposition === 'inline' ? 'inline' : 'attachment';
    if (!content || content.length > 6 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
      invalid('invalid_attachment_content');
    }
    if (!filename || filename.length > 180 || /[\r\n/\\]/.test(filename)) invalid('invalid_attachment_filename');
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type)) invalid('invalid_attachment_type');
    const cleaned = { content, filename, type, disposition };
    if (disposition === 'inline' && attachment.contentId) {
      const contentId = String(attachment.contentId);
      if (contentId.length > 180 || /[\r\n]/.test(contentId)) invalid('invalid_attachment_content_id');
      cleaned.contentId = contentId;
    }
    return cleaned;
  });
}

export function normalizeSendRequest(input, { fromAddress, fromName = '' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('invalid_request');
  if (input.stream !== 'transactional') invalid('marketing_provider_required');
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!idempotencyKey) invalid('idempotency_key_required');
  if (idempotencyKey.length > 256) invalid('idempotency_key_too_long');

  const sender = cleanEmail(fromAddress);
  if (!sender) invalid('sender_not_configured');
  const to = cleanRecipients(input.to);
  const bcc = cleanRecipients(input.bcc);
  if (!to.length && !bcc.length) invalid('recipient_required');
  if (to.length + bcc.length > 50) invalid('too_many_recipients');

  const subject = String(input.subject || '').replace(/[\r\n]+/g, ' ').trim();
  const html = input.html == null ? '' : String(input.html);
  const text = input.text == null ? '' : String(input.text);
  if (!subject || subject.length > 300) invalid('invalid_subject');
  if (!html && !text) invalid('email_body_required');
  if (new TextEncoder().encode(`${html}${text}`).byteLength > 1024 * 1024) invalid('email_body_too_large');

  const replyTo = input.replyTo == null ? '' : cleanEmail(input.replyTo);
  if (input.replyTo && !replyTo) invalid('invalid_reply_to');
  const headers = cleanHeaders(input.headers);
  const attachments = cleanAttachments(input.attachments);
  const visibleTo = to.length ? to : [sender];
  const message = {
    from: fromName ? { email: sender, name: String(fromName).slice(0, 120) } : sender,
    to: visibleTo,
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
    ...(bcc.length ? { bcc } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(attachments.length ? { attachments } : {}),
  };
  return { idempotencyKey, message };
}

export function classifyEmailSendError(error) {
  const code = String(error?.code || '');
  const transient = TRANSIENT_CODES.get(code);
  if (transient) return { ...transient, retryable: true };
  const hard = HARD_CODES.get(code);
  if (hard) return { status: 400, retryable: false, error: hard };
  return { status: 502, retryable: false, error: 'email_delivery_state_unknown' };
}

export function emailSendErrorDetail(error) {
  const raw = String(error?.message || error?.cause?.message || '').replace(EMAIL_IN_TEXT_RE, '[email]');
  return raw.replace(/\s+/g, ' ').trim().slice(0, 300) || null;
}

function headerValue(headers, name) {
  if (headers?.get) return String(headers.get(name) || '');
  if (!headers || typeof headers !== 'object') return '';
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key] || '') : '';
}

export function shouldIgnoreInboundEmail(headers, envelopeFrom) {
  const automatic = headerValue(headers, 'auto-submitted').trim().toLowerCase();
  const precedence = headerValue(headers, 'precedence').trim().toLowerCase();
  const sender = String(envelopeFrom || '').toLowerCase();
  return (automatic && automatic !== 'no')
    || ['bulk', 'list', 'junk'].includes(precedence)
    || /(?:mailer-daemon|postmaster|no-?reply)@/.test(sender);
}

export function normalizeInboundEmail({ envelopeFrom, envelopeTo, parsed = {}, headers, rawDigest }) {
  const from = cleanEmail(envelopeFrom);
  const to = cleanEmail(envelopeTo);
  if (!from || !to) invalid('invalid_envelope');
  const messageId = headerValue(headers, 'message-id').trim();
  const inReplyTo = headerValue(headers, 'in-reply-to').trim();
  const references = headerValue(headers, 'references').trim();
  const digest = String(rawDigest || '').toLowerCase();
  if (!MESSAGE_ID_RE.test(messageId) && !/^[a-f0-9]{64}$/.test(digest)) invalid('inbound_identity_missing');
  const subject = String(parsed.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  const text = String(parsed.text || '').slice(0, 64 * 1024) || null;
  const html = text ? null : String(parsed.html || '').slice(0, 128 * 1024) || null;
  return {
    id: MESSAGE_ID_RE.test(messageId) ? messageId : `sha256:${digest}`,
    from,
    to: [to],
    subject,
    text,
    html,
    headers: {
      'message-id': MESSAGE_ID_RE.test(messageId) ? messageId : '',
      'in-reply-to': inReplyTo.slice(0, 2048),
      references: references.slice(0, 4096),
    },
  };
}
