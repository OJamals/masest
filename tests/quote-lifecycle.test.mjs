import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionOffer,
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
  const sent = quote({ status: 'new', payload: { offer_status: 'sent' } });
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

test('buyer-actionable is true only while an offer awaits a decision', () => {
  const actionable = ['sent', 'revised'];
  const inert = ['accepted', 'payment_pending', 'ordered', 'declined', 'expired'];
  for (const status of actionable) {
    assert.equal(quoteLifecycle(quote({ payload: { offer_status: status } })).buyer_actionable, true, status);
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
  assert.equal(canTransitionOffer(quote({ payload: { offer_status: 'sent' } }), 'declined'), true);
  assert.equal(canTransitionOffer(quote({ payload: { offer_status: 'sent' } }), 'accepted'), true);
  assert.equal(canTransitionOffer(quote({ payload: { offer_status: 'accepted' } }), 'ordered'), true);
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
  // Already accepted: the expiry no longer matters.
  assert.equal(offerIsExpired(quote({ payload: { offer_status: 'accepted', offer_expires_at: past } })), false);
  assert.equal(offerIsExpired(quote({ payload: { offer_status: 'sent' } })), false);
});
