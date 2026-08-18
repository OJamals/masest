// Canonical quote lifecycle, actionability, ownership, and delivery policy.
//
// Quote state spans intake status, CRM pipeline stage, and the priced offer stored in
// payload. Every handler and UI consumes these predicates so a label cannot disagree
// with whether the same offer may be acted on.

const OFFER_STATES = new Set([
  'sent', 'accepted', 'declined', 'expired', 'revised', 'payment_pending', 'ordered',
]);
const EXPIRABLE_OFFER_STATES = new Set(['sent', 'revised', 'accepted']);
const LIVE_OFFER_STATES = new Set(['sent', 'revised', 'accepted', 'payment_pending']);

const STAGE_LABELS = {
  received: 'Received',
  in_review: 'In review',
  quote_ready: 'Quote ready',
  accepted: 'Accepted',
  payment_pending: 'Payment pending',
  ordered: 'Order placed',
  declined: 'Declined',
  expired: 'Expired',
  revised: 'Revised quote sent',
  closed: 'Closed',
};

const STAGE_ACTIONS = {
  received: 'triage_quote',
  in_review: 'price_quote',
  quote_ready: 'await_buyer',
  revised: 'await_buyer',
  accepted: 'await_checkout',
  payment_pending: 'await_payment',
  ordered: 'fulfil_order',
  declined: 'follow_up',
  expired: 'requote_or_close',
  closed: 'closed',
};

function clean(value) {
  return String(value || '').trim();
}

function timeValue(value) {
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && value !== '') return numeric;
  return Date.parse(String(value || ''));
}

// Stored status is kept separate from effective status because CAS guards must compare
// the exact database value even when the expiry boundary makes it unavailable on read.
export function offerStatus(quote) {
  const status = clean(quote?.payload?.offer_status);
  return OFFER_STATES.has(status) ? status : null;
}

export function offerExpiryReached(quote, now = Date.now()) {
  if (!EXPIRABLE_OFFER_STATES.has(offerStatus(quote))) return false;
  return offerValidityExpired(quote, now);
}

export function offerValidityExpired(quote, now = Date.now()) {
  if (!offerStatus(quote)) return false;
  const expiresAt = Date.parse(clean(quote?.payload?.offer_expires_at));
  const boundary = timeValue(now);
  // Missing or malformed validity is not a permanent offer. New sends cannot create
  // this state, and legacy/malformed rows fail closed until staff revises them.
  return !Number.isFinite(expiresAt) || !Number.isFinite(boundary) || expiresAt <= boundary;
}

export function effectiveOfferStatus(quote, now = Date.now()) {
  return offerExpiryReached(quote, now) ? 'expired' : offerStatus(quote);
}

export function quoteLifecycle(quote = {}, now = Date.now()) {
  const status = clean(quote.status);
  const pipeline = clean(quote.pipeline_stage);
  const storedOffer = offerStatus(quote);
  const offer = effectiveOfferStatus(quote, now);

  let stage;
  // Completed offer outcomes remain the most specific truth. A malformed staff terminal
  // move, however, must fail closed instead of leaving a live offer actionable.
  if (offer === 'ordered') stage = 'ordered';
  else if (offer === 'declined') stage = 'declined';
  else if (offer === 'expired') stage = 'expired';
  else if (pipeline === 'lost' || pipeline === 'won' || status === 'closed' || status === 'spam') stage = 'closed';
  else if (offer === 'payment_pending') stage = 'payment_pending';
  else if (offer === 'accepted') stage = 'accepted';
  else if (offer === 'revised') stage = 'revised';
  else if (offer === 'sent') stage = 'quote_ready';
  else if (status === 'contacted' || (pipeline && pipeline !== 'new')) stage = 'in_review';
  else stage = 'received';

  const closed = ['ordered', 'declined', 'closed', 'expired'].includes(stage);
  return {
    stage,
    label: STAGE_LABELS[stage] || stage,
    offer_status: offer,
    stored_offer_status: storedOffer,
    next_action: STAGE_ACTIONS[stage] || 'review_quote',
    buyer_actionable: ['quote_ready', 'revised'].includes(stage),
    is_active: !closed,
    is_won: stage === 'ordered',
  };
}

export function decorateQuoteLifecycle(quote = {}, now = Date.now()) {
  return { ...quote, lifecycle: quoteLifecycle(quote, now) };
}

const OFFER_TRANSITIONS = {
  null: ['sent'],
  sent: ['accepted', 'declined', 'expired', 'revised'],
  revised: ['accepted', 'declined', 'expired', 'revised'],
  accepted: ['payment_pending', 'ordered', 'declined', 'expired', 'revised'],
  declined: ['revised', 'sent'],
  expired: ['revised', 'sent'],
  payment_pending: ['ordered', 'accepted', 'expired'],
  ordered: [],
};

export function canTransitionOffer(quote, nextStatus, now = Date.now()) {
  const current = effectiveOfferStatus(quote, now);
  const allowed = OFFER_TRANSITIONS[current === null ? 'null' : current] || [];
  return allowed.includes(clean(nextStatus));
}

export function offerIsExpired(quote, now = Date.now()) {
  return offerExpiryReached(quote, now);
}

export function quoteBuyerOwns(quote, { userId, companyId } = {}) {
  return quote?.source === 'requisition'
    && Boolean(clean(userId))
    && Boolean(clean(companyId))
    && clean(quote?.payload?.requester_id) === clean(userId)
    && clean(quote?.payload?.company_id) === clean(companyId);
}

export function quoteBuyerActions(quote, {
  userId,
  companyId,
  hasOffer = false,
  now = Date.now(),
} = {}) {
  const owned = quoteBuyerOwns(quote, { userId, companyId });
  const status = effectiveOfferStatus(quote, now);
  const available = owned && hasOffer && ['sent', 'revised', 'accepted'].includes(status)
    && quoteLifecycle(quote, now).stage !== 'closed';
  return {
    can_accept: available,
    can_decline: available,
    can_checkout: available && status === 'accepted',
  };
}

export function quoteIsOpenRequisition(quote, now = Date.now()) {
  if (quote?.source !== 'requisition') return false;
  if (['closed', 'spam'].includes(clean(quote.status))) return false;
  if (['lost', 'won'].includes(clean(quote.pipeline_stage))) return false;
  return !['declined', 'expired', 'ordered'].includes(effectiveOfferStatus(quote, now));
}

export function quoteExpirationPatch(quote, at = new Date().toISOString()) {
  const payload = {
    ...(quote?.payload && typeof quote.payload === 'object' && !Array.isArray(quote.payload)
      ? quote.payload
      : {}),
    offer_status: 'expired',
    offer_expired_at: at,
  };
  delete payload.final_order_id;
  return {
    payload,
    status: 'contacted',
    pipeline_stage: 'proposal',
    handled_at: at,
    next_step: 'Offer expired; revise or close',
    due_at: null,
  };
}

export function staffTerminalTransitionConflict(quote, changes = {}, now = Date.now()) {
  const terminal = ['closed', 'spam'].includes(clean(changes.status))
    || ['won', 'lost'].includes(clean(changes.pipeline_stage));
  return terminal && LIVE_OFFER_STATES.has(effectiveOfferStatus(quote, now));
}

// Delivery is independent of offer availability. A skipped provider result (for example,
// a suppressed email) is degraded even though the durable worker completed the effect.
export function quoteDeliveryState(effects = []) {
  const rows = Array.isArray(effects) ? effects : [];
  if (!rows.length) return null;
  const dead = rows.filter((row) => row?.status === 'dead').length;
  const completed = rows.filter((row) => row?.status === 'completed').length;
  const skipped = rows.some((row) => Boolean(row?.provider_result?.skipped));
  if (dead === rows.length) return 'dead';
  if (dead || skipped) return 'degraded';
  if (completed === rows.length) return 'delivered';
  return 'queued';
}
