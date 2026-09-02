// Canonical email policy. Category decides stream, provider, and user preference.
// Unknown categories have no policy and cannot enter either provider.
const TRANSACTIONAL = Object.freeze({
  stream: 'transactional',
  provider: 'cloudflare',
  preference: null,
});

const MARKETING = Object.freeze({
  stream: 'marketing',
  provider: 'klaviyo',
  preference: 'marketing_email_enabled',
});

export const EMAIL_CATEGORY_POLICY = Object.freeze({
  // Buyer lifecycle + required service mail.
  order: TRANSACTIONAL,
  shipment: TRANSACTIONAL,
  billing: TRANSACTIONAL,
  refund: TRANSACTIONAL,
  cancellation: TRANSACTIONAL,
  return_label: TRANSACTIONAL,
  team: TRANSACTIONAL,
  support: TRANSACTIONAL,
  message: TRANSACTIONAL,
  messages: TRANSACTIONAL,
  lead_internal: TRANSACTIONAL,
  lead_autoreply: TRANSACTIONAL,
  lead_followup_alert: TRANSACTIONAL,
  quote: TRANSACTIONAL,
  crm_task_digest: TRANSACTIONAL,
  staff_alert: TRANSACTIONAL,

  // Requested quote operations are service mail: they continue an active buyer
  // request and contain no promotional content.
  lead_followup: TRANSACTIONAL,
  lead_followup_reminder: TRANSACTIONAL,

  // Optional promotional/nurture mail.
  offer: MARKETING,
  review_request: MARKETING,
  blog_newsletter: MARKETING,
  newsletter: MARKETING,
});

export const MARKETING_CATEGORIES = new Set(
  Object.entries(EMAIL_CATEGORY_POLICY)
    .filter(([, policy]) => policy.stream === 'marketing')
    .map(([category]) => category),
);

export function categoryPolicy(category) {
  return EMAIL_CATEGORY_POLICY[String(category || '')] || null;
}

export function categoryStream(category) {
  return categoryPolicy(category)?.stream || null;
}
