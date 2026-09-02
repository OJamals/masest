const BASE = 'https://masest.co';
const LOGO = 'https://media.masest.co/site/img/masest-logo.png';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function safeHref(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')) return escapeHtml(`${BASE}${raw}`);
  try {
    const url = new URL(raw);
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return escapeHtml(url.toString());
  } catch {
    return '';
  }
  return '';
}

function footer(stream) {
  const common = `<div style="margin:0 0 10px;color:#dbe7e8;font-weight:700;letter-spacing:.04em">MASEST &middot; VertKleen</div>
    <div style="margin:0 0 12px">Industrial and HVAC chemistry engineered for field use.</div>
    <div><a href="${BASE}" style="color:#9fd9dc;text-decoration:none">masest.co</a>
      &nbsp;&middot;&nbsp; <a href="${BASE}/contact.html" style="color:#9fd9dc;text-decoration:none">Contact</a>
      &nbsp;&middot;&nbsp; <a href="${BASE}/privacy.html" style="color:#9fd9dc;text-decoration:none">Privacy</a></div>`;
  if (stream === 'marketing') {
    return `${common}<div style="margin-top:14px;padding-top:14px;border-top:1px solid #29323b">
      <a href="${BASE}/dashboard.html#notifications" style="color:#9fd9dc">Manage email preferences</a>
      &nbsp;&middot;&nbsp; <a href="{% unsubscribe %}" style="color:#9fd9dc">Unsubscribe</a>
    </div>`;
  }
  return `${common}<div style="margin-top:14px;padding-top:14px;border-top:1px solid #29323b">
    Required service email about your account, order, billing, or support activity. Transactional emails cannot be disabled.
  </div>`;
}

// Provider-neutral shell. Cloudflare transactional sends and Klaviyo marketing
// templates call this same renderer. bodyHtml must already be escaped/sanitized.
export function emailLayout({
  heading = '',
  preheader = '',
  bodyHtml = '',
  ctaText,
  ctaUrl,
  stream = 'transactional',
} = {}) {
  const emailStream = stream === 'marketing' ? 'marketing' : 'transactional';
  const safeHeading = escapeHtml(heading);
  const href = safeHref(ctaUrl);
  const cta = ctaText && href
    ? `<div style="margin:28px 0 0"><a href="${href}" style="display:inline-block;background:#0e7c86;color:#fff;text-decoration:none;font-weight:800;font-size:14px;line-height:1;padding:14px 24px;border-radius:999px">${escapeHtml(ctaText)}</a></div>`
    : '';
  const hiddenPreheader = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(String(heading).replace(/<[^>]*>/g, '')) || 'MASEST'}</title>
<style>@media (max-width:620px){.email-pad{padding:24px 20px!important}.email-wrap{border-radius:14px!important}.email-logo{width:56px!important;height:70px!important}}</style></head>
<body style="margin:0;background:#eef3f3;color:#202933;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;-webkit-font-smoothing:antialiased">
${hiddenPreheader}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#eef3f3"><tr><td style="padding:32px 12px">
  <table role="presentation" class="email-wrap" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;margin:0 auto;background:#fff;border:1px solid #dce5e6;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(11,13,18,.08)">
    <tr><td style="background:#0b0d12;padding:24px 30px;text-align:center;border-bottom:4px solid #0e7c86">
      <a href="${BASE}" style="display:inline-block;text-decoration:none" aria-label="MASEST website"><img class="email-logo" src="${LOGO}" width="64" height="80" alt="MASEST" style="display:block;width:64px;height:80px;margin:0 auto;border:0;object-fit:contain"></a>
      <div style="margin-top:10px;color:#f4f8f8;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase">VertKleen Performance Chemistry</div>
    </td></tr>
    <tr><td class="email-pad" style="padding:36px 34px;color:#27323a;font-size:15px;line-height:1.65">
      ${safeHeading ? `<h1 style="margin:0 0 18px;color:#0b0d12;font-size:26px;line-height:1.2;letter-spacing:-.02em">${safeHeading}</h1>` : ''}
      ${bodyHtml}${cta}
    </td></tr>
    <tr><td style="background:#0b0d12;padding:24px 30px;color:#8f9ca7;font-size:11px;line-height:1.65;text-align:center">
      ${footer(emailStream)}
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}
