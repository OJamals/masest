import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionOffer,
  quoteBuyerActions,
  quoteBuyerOwns,
  quoteDeliveryState,
  quoteExpirationPatch,
  quoteIsOpenRequisition,
  offerIsExpired,
  quoteLifecycle,
} from '../functions/_lib/quote-lifecycle.js';

const quote = (overrides = {}) => ({ status: 'new', pipeline_stage: 'new', payload: {}, ...overrides });

test('intake states derive from status and pipeline stage', () => {
  assert.equal(quoteLifecycle(quote()).stage, 'received');
  assert.equal(quoteLifecycle(quote({ status: 'contacted' })).stage, 'in_review');
  assert.equal(quoteLifecycle(quote({ pipeline_stage: 'qualified' })).stage, 'in_review');
  assert.equal(quoteLifecycle(quote({ pipeline_stage: 'lost' })).stage, 'closed');
  assert.equal(quoteLifecycle(quote({ status: 'closed' })).stage, 'closed');
});

test('a priced offer outranks intake triage', () => {
  // The CRM may still say "new" while an offer is already out; the offer is the truth.
  const sent = quote({ status: 'new', payload: {
    offer_status: 'sent',
    offer_expires_at: '2999-01-01T00:00:00.000Z',
  } });
  assert.equal(quoteLifecycle(sent).stage, 'quote_ready');
  assert.equal(quoteLifecycle(sent).buyer_actionable, true);

  const ordered = quote({ status: 'closed', payload: { offer_status: 'ordered' } });
  assert.equal(quoteLifecycle(ordered).stage, 'ordered');
  assert.equal(quoteLifecycle(ordered).is_won, true);
  assert.equal(quoteLifecycle(ordered).is_active, false);
});

test('declined and expired offers are inactive but not "closed"', () => {
  const declined = quoteLifecycle(quote({ payload: { offer_status: 'declined' } }));
  assert.equal(declined.stage, 'declined');
  assert.equal(declined.is_active, false);
  assert.equal(declined.next_action, 'follow_up');

  const expired = quoteLifecycle(quote({ payload: { offer_status: 'expired' } }));
  assert.equal(expired.stage, 'expired');
  assert.equal(expired.next_action, 'requote_or_close');
});

test('buyer-actionable requires an explicit future expiry', () => {
  const actionable = ['sent', 'revised'];
  const inert = ['accepted', 'payment_pending', 'ordered', 'declined', 'expired'];
  for (const status of actionable) {
    assert.equal(quoteLifecycle(quote({ payload: {
      offer_status: status,
      offer_expires_at: '2999-01-01T00:00:00.000Z',
    } })).buyer_actionable, true, status);
  }
  for (const status of inert) {
    assert.equal(quoteLifecycle(quote({ payload: { offer_status: status } })).buyer_actionable, false, status);
  }
});

test('unknown offer statuses fall back to intake rather than inventing a stage', () => {
  const bogus = quote({ status: 'contacted', payload: { offer_status: 'not_a_state' } });
  assert.equal(quoteLifecycle(bogus).offer_status, null);
  assert.equal(quoteLifecycle(bogus).stage, 'in_review');
});

test('offer transitions are gated in one place', () => {
  const future = '2999-01-01T00:00:00.000Z';
  assert.equal(canTransitionOffer(quote({ payload: { offer_status: 'sent', offer_expires_at: future } }), 'declined'), true);
  assert.equal(canTransitionOffer(quote({ payload: { offer_status: 'sent', offer_expires_at: future } }), 'accepted'), true);
  assert.equal(canTransitionOffer(quote({ payload: { offer_status: 'accepted', offer_expires_at: future } }), 'ordered'), true);
  // An ordered quote is terminal: reopening it would orphan the order it produced.
  assert.equal(canTransitionOffer(quote({ payload: { offer_status: 'ordered' } }), 'declined'), false);
  assert.equal(canTransitionOffer(quote({ payload: { offer_status: 'ordered' } }), 'revised'), false);
  // A quote with no offer yet can only receive one.
  assert.equal(canTransitionOffer(quote(), 'sent'), true);
  assert.equal(canTransitionOffer(quote(), 'accepted'), false);
});

test('expiry applies only to offers still awaiting the buyer', () => {
  const past = '2020-01-01T00:00:00.000Z';
  const future = '2999-01-01T00:00:00.000Z';
  assert.equal(offerIsExpired(quote({ payload: { offer_status: 'sent', offer_expires_at: past } })), true);
  assert.equal(offerIsExpired(quote({ payload: { offer_status: 'sent', offer_expires_at: future } })), false);
  // Accepted pricing remains time-bound until checkout starts.
  assert.equal(offerIsExpired(quote({ payload: { offer_status: 'accepted', offer_expires_at: past } })), true);
  // Missing/invalid expiry fails closed rather than becoming a permanent offer.
  assert.equal(offerIsExpired(quote({ payload: { offer_status: 'sent' } })), true);
});

test('exact requester and current Company own Buyer actions', () => {
  const owned = quote({
    source: 'requisition',
    payload: {
      requester_id: 'user-1',
      company_id: 'company-1',
      offer_order_id: 'order-1',
      offer_status: 'sent',
      offer_expires_at: '2999-01-01T00:00:00.000Z',
    },
  });
  assert.equal(quoteBuyerOwns(owned, { userId: 'user-1', companyId: 'company-1' }), true);
  assert.equal(quoteBuyerOwns(owned, { userId: 'user-2', companyId: 'company-1' }), false);
  assert.equal(quoteBuyerOwns(owned, { userId: 'user-1', companyId: 'company-2' }), false);
  assert.deepEqual(quoteBuyerActions(owned, {
    userId: 'user-1', companyId: 'company-1', hasOffer: true,
  }), { can_accept: true, can_decline: true, can_checkout: false });
  assert.deepEqual(quoteBuyerActions(owned, {
    userId: 'user-2', companyId: 'company-1', hasOffer: true,
  }), { can_accept: false, can_decline: false, can_checkout: false });
});

test('open requisition semantics release declined, expired, ordered, and closed requests', () => {
  const requisition = (offer_status, overrides = {}) => quote({
    source: 'requisition',
    payload: {
      offer_status,
      offer_expires_at: '2999-01-01T00:00:00.000Z',
    },
    ...overrides,
  });
  assert.equal(quoteIsOpenRequisition(requisition(undefined)), true);
  assert.equal(quoteIsOpenRequisition(requisition('sent')), true);
  assert.equal(quoteIsOpenRequisition(requisition('accepted')), true);
  assert.equal(quoteIsOpenRequisition(requisition('payment_pending')), true);
  assert.equal(quoteIsOpenRequisition(requisition('declined')), false);
  assert.equal(quoteIsOpenRequisition(requisition('expired')), false);
  assert.equal(quoteIsOpenRequisition(requisition('ordered')), false);
  assert.equal(quoteIsOpenRequisition(requisition('sent', { status: 'closed' })), false);
});

test('expiry transition and delivery summary are canonical', () => {
  const expiring = quote({ payload: {
    offer_order_id: 'order-1',
    offer_status: 'accepted',
    offer_expires_at: '2026-08-17T12:00:00.000Z',
  } });
  const patch = quoteExpirationPatch(expiring, '2026-08-17T12:00:00.000Z');
  assert.equal(patch.payload.offer_status, 'expired');
  assert.equal(patch.payload.offer_expired_at, '2026-08-17T12:00:00.000Z');
  assert.equal(patch.next_step, 'Offer expired; revise or close');

  assert.equal(quoteDeliveryState([{ status: 'pending' }, { status: 'processing' }]), 'queued');
  assert.equal(quoteDeliveryState([{ status: 'completed' }, { status: 'completed' }]), 'delivered');
  assert.equal(quoteDeliveryState([{ status: 'completed' }, { status: 'dead' }]), 'degraded');
  assert.equal(quoteDeliveryState([{ status: 'dead' }, { status: 'dead' }]), 'dead');
  assert.equal(quoteDeliveryState([
    { status: 'completed', provider_result: {} },
    { status: 'completed', provider_result: { skipped: 'email_not_configured' } },
  ]), 'degraded');
});
