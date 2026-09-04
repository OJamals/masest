import { AwsClient } from 'aws4fetch';
import { emailViewToken, htmlToText, unsubscribeToken } from './email.js';
import { EMAIL_BASE, emailEscape, emailSafeUrl } from './email-template.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const WEB_VIEW_BLOCK_RE = /<!--WEB_VIEW_START-->([\s\S]*?)<!--WEB_VIEW_END-->/g;
const LEGACY_PROVIDER_PLACEHOLDER_RE = /\{%\s*(?:unsubscribe_link|web_view_link)\s*%\}/i;
const UNRESOLVED_PLACEHOLDER_RE = /\{\{[^{}]+\}\}|\{%[^%]+%\}/;
const SES_UNSUBSCRIBE_PLACEHOLDER = '{{amazonSESUnsubscribeUrl}}';

function cleanHeader(value, max = 255) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function recipient(value) {
  const values = Array.isArray(value) ? value : [value];
  const clean = values.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean);
  return clean.length === 1 && EMAIL_RE.test(clean[0]) ? clean[0] : '';
}

function unsubscribeUrl(email, token) {
  const params = new URLSearchParams({ email, token });
  return `${EMAIL_BASE}/api/email/unsubscribe?${params}`;
}

export async function marketingEmailViewUrl(env, { email, sourceType, sourceId } = {}) {
  const normalizedEmail = recipient(email);
  if (!normalizedEmail || !sourceType || !sourceId || !env?.EMAIL_UNSUB_SECRET) return '';
  const token = await emailViewToken(normalizedEmail, sourceType, sourceId, env.EMAIL_UNSUB_SECRET);
  const params = new URLSearchParams({
    source_type: String(sourceType),
    source_id: String(sourceId),
    email: normalizedEmail,
    token,
  });
  return `${EMAIL_BASE}/api/email/view?${params}`;
}

function replaceWebViewBlock(value, webViewUrl, { html = false } = {}) {
  const safe = emailSafeUrl(webViewUrl);
  return String(value || '').replace(WEB_VIEW_BLOCK_RE, (_match, contents) => {
    if (!safe) return '';
    return contents.replaceAll('{{web_view_url}}', html ? emailEscape(safe) : safe);
  });
}

export function sesMarketingConfigured(env = {}) {
  return Boolean(
    String(env.AWS_SES_ACCESS_KEY_ID || '').trim()
    && String(env.AWS_SES_SECRET_ACCESS_KEY || '').trim()
    && String(env.EMAIL_UNSUB_SECRET || '').trim(),
  );
}

export async function personalizeMarketingContent(env, {
  email,
  html = '',
  text = '',
  webViewUrl = '',
  unsubscribeUrlValue = '',
} = {}) {
  const normalizedEmail = recipient(email);
  if (!normalizedEmail) throw new Error('invalid_marketing_recipient');
  if (!env?.EMAIL_UNSUB_SECRET) throw new Error('unsubscribe_not_configured');
  const token = await unsubscribeToken(normalizedEmail, env.EMAIL_UNSUB_SECRET);
  const url = unsubscribeUrl(normalizedEmail, token);
  const replacement = unsubscribeUrlValue || url;
  return {
    html: replaceWebViewBlock(html, webViewUrl, { html: true })
      .replaceAll('{{unsubscribe_url}}', unsubscribeUrlValue ? replacement : emailEscape(replacement)),
    text: replaceWebViewBlock(text, webViewUrl)
      .replaceAll('{{unsubscribe_url}}', replacement),
    unsubscribeUrl: replacement,
  };
}

function hasUnresolvedPlaceholder(value) {
  return UNRESOLVED_PLACEHOLDER_RE.test(String(value || '').replaceAll(SES_UNSUBSCRIBE_PLACEHOLDER, ''));
}

function errorMessage(payload, status) {
  const value = payload?.message || payload?.Message || payload?.error || payload?.__type;
  return cleanHeader(value || `ses_${status}`, 200);
}

function defaultSigner(env, region) {
  return new AwsClient({
    accessKeyId: String(env.AWS_SES_ACCESS_KEY_ID),
    secretAccessKey: String(env.AWS_SES_SECRET_ACCESS_KEY),
    region,
    service: 'ses',
  });
}

function sesContactSettings(env = {}) {
  const contactListName = cleanHeader(env.AWS_SES_CONTACT_LIST || 'masest-marketing', 64);
  const topicName = cleanHeader(env.AWS_SES_CONTACT_TOPIC || 'marketing', 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(contactListName)) throw new Error('invalid_ses_contact_list');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topicName)) throw new Error('invalid_ses_contact_topic');
  return { contactListName, topicName };
}

function sesFailure(response, body) {
  return {
    ok: false,
    provider: 'ses',
    status: response.status,
    retryable: response.status === 429 || response.status >= 500,
    error: errorMessage(body, response.status),
  };
}

function isAlreadyExists(body) {
  return /already\s*exists/i.test([
    body?.__type,
    body?.code,
    body?.Code,
    body?.message,
    body?.Message,
  ].filter(Boolean).join(' '));
}

export async function syncSesMarketingContact(env, {
  email,
  enabled,
} = {}, {
  fetchImpl = globalThis.fetch,
  signer = null,
} = {}) {
  if (!String(env?.AWS_SES_ACCESS_KEY_ID || '').trim()
    || !String(env?.AWS_SES_SECRET_ACCESS_KEY || '').trim()) {
    return { ok: false, provider: 'ses', retryable: false, error: 'ses_not_configured' };
  }
  const normalizedEmail = recipient(email);
  if (!normalizedEmail || typeof enabled !== 'boolean') {
    return { ok: false, provider: 'ses', retryable: false, error: 'invalid_ses_contact' };
  }

  let settings;
  try {
    settings = sesContactSettings(env);
  } catch (error) {
    return { ok: false, provider: 'ses', retryable: false, error: cleanHeader(error, 200) };
  }
  const region = cleanHeader(env.AWS_SES_REGION || 'us-east-1', 64);
  const activeSigner = signer || defaultSigner(env, region);
  const base = `https://email.${region}.amazonaws.com/v2/email/contact-lists/${encodeURIComponent(settings.contactListName)}/contacts`;
  const preference = {
    UnsubscribeAll: !enabled,
    TopicPreferences: [{
      TopicName: settings.topicName,
      SubscriptionStatus: enabled ? 'OPT_IN' : 'OPT_OUT',
    }],
  };

  async function request(url, method, body) {
    const signed = await activeSigner.sign(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const response = await fetchImpl(signed);
    const responseBody = await response.json().catch(() => null);
    return { response, responseBody };
  }

  try {
    const updated = await request(`${base}/${encodeURIComponent(normalizedEmail)}`, 'PUT', preference);
    if (updated.response.ok) return { ok: true, provider: 'ses', operation: 'updated' };
    if (updated.response.status !== 404) return sesFailure(updated.response, updated.responseBody);

    const created = await request(base, 'POST', { EmailAddress: normalizedEmail, ...preference });
    if (created.response.ok) return { ok: true, provider: 'ses', operation: 'created' };
    if (isAlreadyExists(created.responseBody)) {
      const raced = await request(`${base}/${encodeURIComponent(normalizedEmail)}`, 'PUT', preference);
      if (raced.response.ok) {
        return { ok: true, provider: 'ses', operation: 'updated_after_create_race' };
      }
      return sesFailure(raced.response, raced.responseBody);
    }
    return sesFailure(created.response, created.responseBody);
  } catch (error) {
    return {
      ok: false,
      provider: 'ses',
      network: true,
      ambiguous: true,
      retryable: true,
      error: cleanHeader(error, 200) || 'ses_contact_sync_error',
    };
  }
}

export async function listSesSuppressions(env, {
  fetchImpl = globalThis.fetch,
  signer = null,
  maxPages = 10,
  pageSize = 1000,
} = {}) {
  if (!String(env?.AWS_SES_ACCESS_KEY_ID || '').trim()
    || !String(env?.AWS_SES_SECRET_ACCESS_KEY || '').trim()) {
    return { ok: false, provider: 'ses', retryable: false, error: 'ses_not_configured' };
  }
  const region = cleanHeader(env.AWS_SES_REGION || 'us-east-1', 64);
  const activeSigner = signer || defaultSigner(env, region);
  const pageLimit = Math.min(25, Math.max(1, Number(maxPages) || 10));
  const size = Math.min(1000, Math.max(1, Number(pageSize) || 1000));
  const suppressions = new Map();
  let nextToken = '';

  try {
    for (let page = 0; page < pageLimit; page += 1) {
      const url = new URL(`https://email.${region}.amazonaws.com/v2/email/suppression/addresses`);
      url.searchParams.set('PageSize', String(size));
      if (nextToken) url.searchParams.set('NextToken', nextToken);
      const request = await activeSigner.sign(url, { method: 'GET' });
      const response = await fetchImpl(request);
      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          ok: false,
          provider: 'ses',
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
          error: errorMessage(responseBody, response.status),
        };
      }
      if (!responseBody || typeof responseBody !== 'object') {
        return { ok: false, provider: 'ses', retryable: true, error: 'ses_invalid_response' };
      }
      for (const item of responseBody.SuppressedDestinationSummaries || []) {
        const email = recipient(item?.EmailAddress);
        const reason = String(item?.Reason || '').toUpperCase();
        if (!email || (reason !== 'BOUNCE' && reason !== 'COMPLAINT')) continue;
        suppressions.set(email, { email, reason: reason.toLowerCase() });
      }
      nextToken = cleanHeader(responseBody.NextToken, 2000);
      if (!nextToken) {
        return {
          ok: true,
          provider: 'ses',
          pages: page + 1,
          suppressions: [...suppressions.values()],
        };
      }
    }
  } catch (error) {
    return {
      ok: false,
      provider: 'ses',
      network: true,
      retryable: true,
      error: cleanHeader(error, 200) || 'ses_suppression_list_error',
    };
  }
  return {
    ok: false,
    provider: 'ses',
    retryable: true,
    error: 'ses_suppression_list_truncated',
  };
}

export async function syncSesSuppressions(env, sb, dependencies = {}) {
  const listed = await listSesSuppressions(env, dependencies);
  if (!listed.ok) return listed;
  if (!listed.suppressions.length) {
    return { ok: true, provider: 'ses', pages: listed.pages, count: 0 };
  }
  const { data, error } = await sb.rpc('sync_ses_suppressions', {
    p_entries: listed.suppressions,
  });
  if (error) {
    return { ok: false, provider: 'ses', retryable: true, error: 'ses_suppression_sync_failed' };
  }
  const count = Number(data) || 0;
  if (count !== listed.suppressions.length) {
    return { ok: false, provider: 'ses', retryable: true, error: 'ses_suppression_sync_partial' };
  }
  return { ok: true, provider: 'ses', pages: listed.pages, count };
}

export async function sendSesMarketingEmail(env, {
  to,
  subject,
  html,
  text = '',
  category,
  idempotencyKey,
  replyTo = '',
  webViewUrl = '',
  fetchImpl = globalThis.fetch,
  signer = null,
} = {}) {
  if (!sesMarketingConfigured(env)) {
    return { ok: false, provider: 'ses', retryable: false, error: 'ses_not_configured' };
  }
  const toEmail = recipient(to);
  if (!toEmail) {
    return { ok: false, provider: 'ses', retryable: false, error: 'ses_single_recipient_required' };
  }
  const stableKey = cleanHeader(idempotencyKey, 255);
  if (!stableKey) {
    return { ok: false, provider: 'ses', retryable: false, error: 'marketing_idempotency_key_required' };
  }
  const rawHtml = String(html || '');
  if (!rawHtml.includes('{{unsubscribe_url}}')) {
    return { ok: false, provider: 'ses', retryable: false, error: 'marketing_unsubscribe_placeholder_required' };
  }
  if (LEGACY_PROVIDER_PLACEHOLDER_RE.test(rawHtml) || LEGACY_PROVIDER_PLACEHOLDER_RE.test(String(text || ''))) {
    return { ok: false, provider: 'ses', retryable: false, error: 'legacy_marketing_placeholder' };
  }

  const personalized = await personalizeMarketingContent(env, {
    email: toEmail,
    html: rawHtml,
    text: String(text || ''),
    webViewUrl,
    unsubscribeUrlValue: SES_UNSUBSCRIBE_PLACEHOLDER,
  });
  const fallbackText = htmlToText(personalized.html);
  const bodyText = personalized.text || (fallbackText.includes(SES_UNSUBSCRIBE_PLACEHOLDER)
    ? fallbackText
    : `${fallbackText}\n\nUnsubscribe: ${personalized.unsubscribeUrl}`);
  const htmlUnsubscribeCount = personalized.html.split(SES_UNSUBSCRIBE_PLACEHOLDER).length - 1;
  const textUnsubscribeCount = bodyText.split(SES_UNSUBSCRIBE_PLACEHOLDER).length - 1;
  if (htmlUnsubscribeCount !== 1 || textUnsubscribeCount !== 1
    || hasUnresolvedPlaceholder(personalized.html) || hasUnresolvedPlaceholder(bodyText)) {
    return { ok: false, provider: 'ses', retryable: false, error: 'marketing_placeholder_unresolved' };
  }

  const region = cleanHeader(env.AWS_SES_REGION || 'us-east-1', 64);
  const fromEmail = cleanHeader(env.AWS_SES_FROM_EMAIL || 'news@marketing.masest.co', 320);
  const fromName = cleanHeader(env.AWS_SES_FROM_NAME || 'MASEST · VertKleen', 120);
  const reply = cleanHeader(replyTo || env.AWS_SES_REPLY_TO || env.EMAIL_REPLY_TO || 'dev@masest.co', 320);
  const configurationSet = cleanHeader(env.AWS_SES_CONFIGURATION_SET || 'masest-marketing', 64);
  const cleanCategory = cleanHeader(category || 'marketing', 64).replace(/[^A-Za-z0-9_-]/g, '_');
  let contactSettings;
  try {
    contactSettings = sesContactSettings(env);
  } catch (error) {
    return { ok: false, provider: 'ses', retryable: false, error: cleanHeader(error, 200) };
  }
  const payload = {
    FromEmailAddress: `${fromName} <${fromEmail}>`,
    Destination: { ToAddresses: [toEmail] },
    ReplyToAddresses: [reply],
    Content: {
      Simple: {
        Subject: { Data: cleanHeader(subject, 998), Charset: 'UTF-8' },
        Body: {
          Text: { Data: bodyText, Charset: 'UTF-8' },
          Html: { Data: personalized.html, Charset: 'UTF-8' },
        },
        Headers: [{ Name: 'X-MASEST-Idempotency-Key', Value: stableKey }],
      },
    },
    ConfigurationSetName: configurationSet,
    ListManagementOptions: {
      ContactListName: contactSettings.contactListName,
      TopicName: contactSettings.topicName,
    },
    EmailTags: [
      { Name: 'stream', Value: 'marketing' },
      { Name: 'category', Value: cleanCategory },
    ],
  };

  const url = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  try {
    const activeSigner = signer || defaultSigner(env, region);
    const request = await activeSigner.sign(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const response = await fetchImpl(request);
    const responseBody = await response.json().catch(() => null);
    const providerMessageId = cleanHeader(responseBody?.MessageId, 255) || null;
    if (response.ok && providerMessageId) {
      return { ok: true, provider: 'ses', providerMessageId, status: response.status, retryable: false };
    }
    return {
      ok: false,
      provider: 'ses',
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
      error: errorMessage(responseBody, response.status),
    };
  } catch (error) {
    return {
      ok: false,
      provider: 'ses',
      network: true,
      ambiguous: true,
      retryable: false,
      error: cleanHeader(error, 200) || 'ses_network_error',
    };
  }
}
