import companyIdentity from '../../data/company-identity.json' with { type: 'json' };

export const EMAIL_BASE = 'https://masest.co';
export const EMAIL_LOGO = 'https://media.masest.co/site/img/masest-logo.png';

export function emailEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

export function emailSafeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')) return `${EMAIL_BASE}${raw}`;
  try {
    const url = new URL(raw);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

export function emailButton(text, url, { light = false } = {}) {
  const href = emailSafeUrl(url);
  if (!text || !href) return '';
  const background = light ? '#9dd5d8' : '#0e7c86';
  const color = light ? '#102427' : '#ffffff';
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:${background}">`
    + `<a href="${emailEscape(href)}" style="display:inline-block;padding:13px 20px;color:${color};font-size:14px;font-weight:700;text-decoration:none">${emailEscape(text)}</a>`
    + '</td></tr></table>';
}

export function emailPreheader(value) {
  if (!value) return '';
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${emailEscape(value)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>`;
}

export function emailBrandHeader(label = '', value = '') {
  const safeLabel = emailEscape(label);
  const safeValue = emailEscape(value);
  return `<tr><td style="padding:20px 28px;background:#111518">`
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
    + `<td><a href="${EMAIL_BASE}" style="display:inline-block;text-decoration:none"><img src="${EMAIL_LOGO}" width="38" height="47" alt="MASEST" style="display:block;width:38px;height:47px;border:0;object-fit:contain"></a></td>`
    + `<td align="right" style="color:#a9b7ba;font-family:Arial,sans-serif;font-size:11px;line-height:1.5">${safeLabel}${safeValue ? `<br><span style="color:#fff;font-size:13px;font-weight:700">${safeValue}</span>` : ''}</td>`
    + '</tr></table></td></tr>';
}

export function emailBusinessAddress() {
  const street = String(companyIdentity?.street_address?.value || '').trim();
  const locality = String(companyIdentity?.location?.locality || '').trim();
  const region = String(companyIdentity?.location?.region || '').trim();
  const postalCode = String(companyIdentity?.location?.postal_code || '').trim();
  const localityLine = [locality, [region, postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [street, localityLine].filter(Boolean).join(', ');
}

export function transactionalEmailFooter(kind = 'service') {
  if (kind === 'support') {
    return `<tr><td style="padding:20px 28px;border-top:1px solid #e4e6e9;font-family:Arial,sans-serif">`
      + `<p style="margin:0;color:#5f656d;font-size:11px;line-height:1.6">Support conversation notification. `
      + `<a href="${EMAIL_BASE}/dashboard.html#notifications" style="color:#0a5b62">Manage email settings</a> · `
      + `<a href="${EMAIL_BASE}/privacy.html" style="color:#0a5b62">Privacy</a></p></td></tr>`;
  }
  const label = kind === 'order' ? 'order notice' : 'service email';
  return `<tr><td style="padding:20px 28px;border-top:1px solid #e4e6e9;font-family:Arial,sans-serif">`
    + `<p style="margin:0;color:#5f656d;font-size:11px;line-height:1.6">Required ${label}. This cannot be disabled. `
    + `<a href="${EMAIL_BASE}/dashboard.html#notifications" style="color:#0a5b62">Manage email settings</a> · `
    + `<a href="${EMAIL_BASE}/privacy.html" style="color:#0a5b62">Privacy</a></p></td></tr>`;
}

export function marketingEmailFooter(reason = '') {
  const address = emailBusinessAddress();
  const permission = String(reason || 'You received this because you subscribed to VertKleen updates or asked MASEST for product information.');
  return `<tr><td style="padding:26px 28px;background:#111518;font-family:Arial,sans-serif">`
    + `<img src="${EMAIL_LOGO}" width="34" height="42" alt="MASEST" style="display:block;width:34px;height:42px;object-fit:contain;margin-bottom:14px">`
    + `<p style="margin:0 0 10px;color:#d8e0e2;font-size:11px;line-height:1.6"><a href="${EMAIL_BASE}" style="color:#fff">Website</a> · <a href="${EMAIL_BASE}/products" style="color:#fff">Products</a> · <a href="${EMAIL_BASE}/blog" style="color:#fff">Blog</a> · <a href="${EMAIL_BASE}/contact" style="color:#fff">Contact</a></p>`
    + `<p style="margin:0 0 10px;color:#a9b7ba;font-size:10px;line-height:1.6">${emailEscape(permission)}</p>`
    + `<p style="margin:0 0 10px;color:#d8e0e2;font-size:11px"><a href="${EMAIL_BASE}/dashboard.html#notifications" style="color:#fff">Manage email settings</a> · <a href="{% unsubscribe_link %}" style="color:#fff">Unsubscribe</a> · <a href="${EMAIL_BASE}/privacy.html" style="color:#fff">Privacy</a></p>`
    + `<p style="margin:0;color:#8f9ca1;font-size:10px;line-height:1.6">${emailEscape(companyIdentity.legal_name)} · ${emailEscape(address)}</p>`
    + '</td></tr>';
}

export function emailDocument({ title = 'MASEST', preheader = '', rows = '', background = '#f4f6f7' } = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${emailEscape(String(title).replace(/<[^>]*>/g, '')) || 'MASEST'}</title>
<style>@media(max-width:620px){.email-pad{padding-left:20px!important;padding-right:20px!important}.email-stack{display:block!important;width:100%!important}.email-hide-mobile{display:none!important}}@media(prefers-color-scheme:dark){.email-card{background:#f7f9fa!important;color:#15171c!important}}</style></head>
<body style="margin:0;background:${background};color:#15171c;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased">
${emailPreheader(preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:${background};border-collapse:collapse"><tr><td style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;background:#fff;border-collapse:collapse">${rows}</table>
</td></tr></table></body></html>`;
}

export function marketingEmailLayout({
  heading = '',
  preheader = '',
  bodyHtml = '',
  ctaText,
  ctaUrl,
  eyebrow = 'VertKleen',
  disclosure = '',
} = {}) {
  const cta = emailButton(ctaText, ctaUrl);
  const rows = `<tr><td style="padding:10px 24px;background:#fff;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td style="color:#5f656d;font-size:10px">${emailEscape(preheader || heading)}</td><td align="right" style="font-size:10px"><a href="{% web_view_link %}" style="color:#0a5b62">View in browser</a></td></tr></table></td></tr>`
    + `<tr><td style="padding:18px 28px;background:#111518"><table role="presentation" width="100%"><tr><td><a href="${EMAIL_BASE}"><img src="${EMAIL_LOGO}" width="38" height="47" alt="MASEST" style="display:block;width:38px;height:47px;border:0;object-fit:contain"></a></td><td align="right" style="font-family:Arial,sans-serif;font-size:11px"><a href="${EMAIL_BASE}/products" style="color:#dce4e6;text-decoration:none">Products</a>&nbsp;&nbsp;&nbsp;<a href="${EMAIL_BASE}/industries" style="color:#dce4e6;text-decoration:none">Industries</a>&nbsp;&nbsp;&nbsp;<a href="${EMAIL_BASE}/blog" style="color:#dce4e6;text-decoration:none">Blog</a></td></tr></table></td></tr>`
    + `<tr><td class="email-pad" style="padding:34px 28px 30px;font-family:Arial,sans-serif"><p style="margin:0 0 9px;color:#0a5b62;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">${emailEscape(eyebrow)}</p>${heading ? `<h1 style="margin:0;color:#15171c;font-size:31px;line-height:1.13;letter-spacing:-.7px">${emailEscape(heading)}</h1>` : ''}<div style="margin-top:16px;color:#27323a;font-size:15px;line-height:1.65">${bodyHtml}</div>${cta ? `<div style="margin-top:22px">${cta}</div>` : ''}</td></tr>`
    + marketingEmailFooter(disclosure);
  return emailDocument({ title: heading, preheader, rows });
}

// Provider-neutral fallback for service emails that do not have a purpose-built
// renderer yet. bodyHtml must already be escaped or sanitized by its owner.
export function emailLayout({
  heading = '',
  preheader = '',
  bodyHtml = '',
  ctaText,
  ctaUrl,
  stream = 'transactional',
} = {}) {
  if (stream === 'marketing') {
    return marketingEmailLayout({ heading, preheader, bodyHtml, ctaText, ctaUrl });
  }
  const cta = emailButton(ctaText, ctaUrl);
  const rows = emailBrandHeader('VertKleen', 'Performance chemistry')
    + `<tr><td class="email-pad" style="padding:36px 28px;color:#27323a;font-size:15px;line-height:1.65">${heading ? `<h1 style="margin:0 0 18px;color:#0b0d12;font-size:27px;line-height:1.18;letter-spacing:-.5px">${emailEscape(heading)}</h1>` : ''}${bodyHtml}${cta ? `<div style="margin-top:24px">${cta}</div>` : ''}</td></tr>`
    + transactionalEmailFooter();
  return emailDocument({ title: heading, preheader, rows });
}
