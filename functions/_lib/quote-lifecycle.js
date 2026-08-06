// Canonical quote lifecycle, mirroring order-lifecycle.js.
//
// Quote state is spread across three fields that were introduced at different times:
// `quotes.status` (intake triage), `quotes.pipeline_stage` (CRM), and
// `payload.offer_status` (the priced offer). Staff and buyers each used to derive their own
// label from those, which is how a buyer can see "Quote ready" while the CRM shows "lost".
// This module derives one stage, and both surfaces render it.

const OFFER_STATES = new Set([
  'sent', 'accepted', 'declined', 'expired', 'revised', 'payment_pending', 'ordered',
]);

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

// What staff should do next. Drives the admin queue's ordering and its per-row prompt.
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

export function offerStatus(quote) {
  const status = clean(quote?.payload?.offer_status);
  return OFFER_STATES.has(status) ? status : null;
}

export function quoteLifecycle(quote = {}) {
  const status = clean(quote.status);
  const pipeline = clean(quote.pipeline_stage);
  const offer = offerStatus(quote);

  let stage;
  // The offer, when one exists, is the most specific truth: a priced offer that the buyer
  // has acted on outranks intake triage.
  if (offer === 'ordered') stage = 'ordered';
  else if (offer === 'payment_pending') stage = 'payment_pending';
  else if (offer === 'accepted') stage = 'accepted';
  else if (offer === 'declined') stage = 'declined';
  else if (offer === 'expired') stage = 'expired';
  else if (offer === 'revised') stage = 'revised';
  else if (offer === 'sent') stage = 'quote_ready';
  else if (pipeline === 'lost' || status === 'closed') stage = 'closed';
  else if (pipeline === 'won') stage = 'quote_ready';
  else if (status === 'contacted' || (pipeline && pipeline !== 'new')) stage = 'in_review';
  else stage = 'received';

  const closed = ['ordered', 'declined', 'closed', 'expired'].includes(stage);
  return {
    stage,
    label: STAGE_LABELS[stage] || stage,
    offer_status: offer,
    next_action: STAGE_ACTIONS[stage] || 'review_quote',
    // A buyer may act on a live offer; everything else is staff-side work.
    buyer_actionable: ['quote_ready', 'revised'].includes(stage),
    is_active: !closed,
    is_won: stage === 'ordered',
  };
}

export function decorateQuoteLifecycle(quote = {}) {
  return { ...quote, lifecycle: quoteLifecycle(quote) };
}

// Which offer transitions are legal from the current state. Both the buyer endpoint and
// the admin endpoint check against this, so neither can invent a state the other rejects.
const OFFER_TRANSITIONS = {
  null: ['sent'],
  sent: ['accepted', 'declined', 'expired', 'revised'],
  revised: ['accepted', 'declined', 'expired', 'revised'],
  accepted: ['payment_pending', 'ordered', 'declined', 'revised'],
  declined: ['revised', 'sent'],
  expired: ['revised', 'sent'],
  payment_pending: ['ordered', 'accepted'],
  // Terminal: an order exists. Reopening it would orphan the order it produced.
  ordered: [],
};

export function canTransitionOffer(quote, nextStatus) {
  const current = offerStatus(quote);
  const allowed = OFFER_TRANSITIONS[current === null ? 'null' : current] || [];
  return allowed.includes(clean(nextStatus));
}

// A quote whose offer has an expiry in the past and is still awaiting the buyer.
export function offerIsExpired(quote, now = Date.now()) {
  const stage = quoteLifecycle(quote).stage;
  if (!['quote_ready', 'revised'].includes(stage)) return false;
  const expiresAt = Date.parse(clean(quote?.payload?.offer_expires_at));
  return Number.isFinite(expiresAt) && expiresAt <= now;
}
