// POST /api/stripe-webhook — Stripe event sink. Verifies signature, records paid orders.
// Configure in Stripe Dashboard → Webhooks → endpoint <your-domain>/api/stripe-webhook,
// events checkout.session.completed + checkout.session.async_payment_succeeded +
// checkout.session.async_payment_failed (the async pair settles ACH debits that clear
// or fail days after the session completes). Signing secret in STRIPE_WEBHOOK_SECRET.
// On the Workers runtime signature verification must use the SubtleCrypto provider.
import Stripe from 'stripe';
import { adminClient, json, htmlEscape } from '../_lib/supabase.js';
import { buyerEmailFromStripeSession } from '../_lib/checkout-session.js';
import {
  isDelinquentStatus,
  planFailedPayment,
  planRecoveredPayment,
  planDispute,
  planRefundReconcile,
} from '../_lib/dunning.js';
import { qboFullDocumentRefund } from '../_lib/refund.js';
import { linkOrderProviderObject } from '../_lib/order-integrations.js';
import {
  centsToAmount,
  stripeQboSyncStatus,
  assembleCartMetadata,
  parseCartMetadata,
  orderRowFromSession,
  cartLines,
  orderItemRows,
  isSubscriptionCheckout,
  subscriptionRow,
  qboSubscriptionInvoiceRow,
} from '../_lib/order-shape.js';
import {
  achFailedEffects,
  billingFailureEffects,
  billingRecoveryEffects,
  checkoutOrderEffects,
  disputeEffects,
  enqueueIntegrationEffects,
  subscriptionActivationEffects,
} from '../_lib/integration-effects.js';
import { stripeRuntimeError } from '../_lib/stripe-runtime.js';
import {
  finalizeQuoteOrder,
  markQuotePaymentPending,
  reopenQuoteAfterPaymentFailure,
} from '../_lib/quote-order.js';

export { htmlEscape as escapeHtml } from '../_lib/supabase.js';

// Postgres unique-constraint violation (e.g. the orders.stripe_payment_intent guard).
export function isUniqueViolation(error) {
  return error?.code === '23505';
}

// Classify the atomic paid-order transaction so the webhook reacts correctly to each outcome:
//   'ok'        -> persisted; proceed with items / email / stock / notify.
//   'duplicate' -> a concurrent Stripe delivery already inserted this payment's order
//                  (unique guard fired); treat as idempotent success (HTTP 200).
//   'error'     -> transient/DB failure; the caller must return a 5xx so Stripe
//                  re-delivers — acking 200 here would lose a paid order.
export function classifyOrderInsert(error) {
  if (!error) return 'ok';
  if (isUniqueViolation(error)) return 'duplicate';
  return 'error';
}

async function enqueueRequiredEffects(sb, event, rawBody, effects) {
  const { error } = await enqueueIntegrationEffects(sb, event, rawBody, effects);
  if (error) console.error('integration_effect_enqueue_failed', error?.code || error?.name || 'unknown');
  return error;
}

// Compact cart metadata carries no display names (Stripe's 500-char cap); resolve them
// from product_variants once per order. Best-effort — the SKU fallback is acceptable.
async function enrichLineNames(sb, lines) {
  const skus = (lines || []).filter((l) => l.sku && (!l.name || l.name === l.sku)).map((l) => l.sku);
  if (!skus.length) return;
  try {
    const { data } = await sb.from('product_variants').select('vsku,label,products(name)').in('vsku', skus);
    const names = new Map((data || []).map((v) => [v.vsku, v.products?.name ? `${v.products.name} - ${v.label || 'Each'}` : null]));
    for (const l of lines) {
      const name = names.get(l.sku);
      if (name && (!l.name || l.name === l.sku)) l.name = name;
    }
  } catch (e) {
    console.error('line_name_enrich_failed', e?.message || e);
  }
}

function qboRefundRowsFromCharge(charge, order, plan) {
  if (!order?.id || !plan?.amount || order.qbo_sync_status === 'skipped') return [];
  const total = Number(order.total) || 0;
  const refunds = Array.isArray(charge?.refunds?.data) ? charge.refunds.data : [];
  const rows = refunds
    .filter((refund) => refund?.id && Number(refund.amount || 0) > 0 && refund.status !== 'failed' && refund.status !== 'canceled')
    .map((refund) => {
      const amount = centsToAmount(refund.amount);
      return {
        order_id: order.id,
        amount,
        fully_refunded: qboFullDocumentRefund({ total, refundedAmount: 0, amount }),
        stripe_refund_id: refund.id,
      };
    });
  if (rows.length) return rows;
  const syntheticId = charge?.id ? `charge:${charge.id}:refunded:${plan.refundedAmount}` : null;
  return [{
    order_id: order.id,
    amount: plan.amount,
    fully_refunded: qboFullDocumentRefund({ total, refundedAmount: order.refunded_amount, amount: plan.amount }),
    stripe_refund_id: syntheticId,
  }];
}

async function transitionQuotedCheckout(sb, session, finalOrderId, transition, errorCode) {
  const quoteId = session.metadata?.quote_id;
  const draftOrderId = session.metadata?.quote_order_id;
  if (!quoteId && !draftOrderId) return null;
  if (!quoteId || !draftOrderId) return json(503, { error: 'quote_identity_incomplete' });
  const result = await transition(sb, { quoteId, draftOrderId, finalOrderId });
  return result?.error ? json(503, { error: errorCode }) : null;
}

export async function handleStripeWebhook({ request, env }, dependencies = {}) {
  const getAdminClient = dependencies.adminClient || adminClient;
  const finalizeQuotedOrder = dependencies.finalizeQuoteOrder || finalizeQuoteOrder;
  const markQuotedOrderPending = dependencies.markQuotePaymentPending || markQuotePaymentPending;
  const reopenQuotedOrder = dependencies.reopenQuoteAfterPaymentFailure || reopenQuoteAfterPaymentFailure;
  const constructEvent = dependencies.constructEvent || (async ({ raw, sig, whSecret }) => {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
    const cryptoProvider = Stripe.createSubtleCryptoProvider();
    return stripe.webhooks.constructEventAsync(raw, sig, whSecret, undefined, cryptoProvider);
  });
  const secret = env.STRIPE_SECRET_KEY;
  const whSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !whSecret) return json(500, { error: 'stripe_not_configured' });
  const runtimeError = stripeRuntimeError(env);
  if (runtimeError) return json(503, { error: runtimeError });
  const retrieveCheckoutSession = dependencies.retrieveCheckoutSession || (async (id) => {
    const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });
    return stripe.checkout.sessions.retrieve(id);
  });
  const updateCheckoutSession = dependencies.updateCheckoutSession || (async (id, params) => {
    const stripe = new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });
    return stripe.checkout.sessions.update(id, params);
  });

  const sig = request.headers.get('stripe-signature');
  const rawBody = await request.text(); // raw body required for signature verification

  let event;
  try {
    event = await constructEvent({ raw: rawBody, sig, whSecret });
  } catch {
    // Signature failures are unauthenticated input. Do not reflect Stripe parser
    // details that could help an attacker distinguish configuration or payload issues.
    return json(400, { error: 'invalid_signature' });
  }

  if (event.type === 'checkout.session.completed') {
    let s = event.data.object;
    const sb = getAdminClient(env);

    // Program subscription checkout (mode=subscription): record enrollment, skip the order path.
    if (isSubscriptionCheckout(s)) {
      try {
        const row = subscriptionRow(s);
        // Promote the checkout placeholder inserted at session creation (matched by
        // checkout session id). Falls back to upsert for sessions predating the placeholder.
        const { data: promoted, error: promoteError } = await sb.from('program_subscriptions')
          .update({ status: row.status, stripe_subscription_id: row.stripe_subscription_id, stripe_customer_id: row.stripe_customer_id, tier: row.tier })
          .eq('stripe_checkout_session_id', s.id).select('id');
        if (promoteError) return json(503, { error: 'program_subscription_persist_failed' });
        if (!promoted?.length) {
          const { error: upsertError } = await sb.from('program_subscriptions')
            .upsert(row, { onConflict: 'stripe_subscription_id' });
          if (upsertError) return json(503, { error: 'program_subscription_persist_failed' });
        }
      } catch (e) {
        console.error('program_sub_record_failed', e?.message || e);
        return json(503, { error: 'program_subscription_persist_failed' });
      }
      const enqueueError = await enqueueRequiredEffects(
        sb,
        event,
        rawBody,
        subscriptionActivationEffects({
          companyId: s.metadata?.company_id || null,
          tier: s.metadata?.tier || null,
        }),
      );
      if (enqueueError) return json(503, { error: 'stripe_effect_enqueue_failed' });
      return json(200, { received: true, subscription: true });
    }

    // Some Stripe event destinations can deliver a reduced Checkout Session snapshot.
    // Hydrate from Stripe before persistence whenever the cart or buyer identity is
    // absent; acknowledging the reduced event would create an unfulfillable paid order.
    let cart = parseCartMetadata(assembleCartMetadata(s.metadata));
    if (!cart.length || !buyerEmailFromStripeSession(s)) {
      try {
        s = await retrieveCheckoutSession(s.id);
        cart = parseCartMetadata(assembleCartMetadata(s.metadata));
      } catch (error) {
        console.error('checkout_session_hydrate_failed', error?.code || error?.name || 'unknown');
        return json(503, { error: 'checkout_session_hydrate_failed' });
      }
    }
    if (!cart.length) {
      console.error('checkout_session_cart_missing', s?.id || 'unknown');
      return json(503, { error: 'checkout_session_incomplete' });
    }
    const subtotal = centsToAmount(s.amount_subtotal);
    const tax = centsToAmount(s.total_details?.amount_tax);
    const total = centsToAmount(s.amount_total);
    // ACH debits complete with payment_status 'unpaid' and settle (or fail) days later
    // via the async_payment_* events. Until then: order is pending_payment, stock stays
    // untouched, and the buyer gets a "received" email instead of a confirmation.
    const settled = !s.payment_status || s.payment_status === 'paid';

    // Cart keys are variant SKUs; compact metadata has no names — resolve from the DB
    // before persistence so the header and all historical line snapshots commit together.
    let lines = cart.length ? cartLines(cart) : [];
    if (lines.length) await enrichLineNames(sb, lines);
    const itemRows = orderItemRows(lines, null);
    const { data: persisted, error: persistErr } = await sb.rpc('persist_stripe_order', {
      p_order: orderRowFromSession(s, buyerEmailFromStripeSession(s)),
      p_items: itemRows,
    });
    let order = persisted?.id ? { id: persisted.id, company_id: s.metadata?.company_id || null } : null;
    const orderErr = persistErr || (order ? null : { message: 'persist_stripe_order returned no id' });

    const insertOutcome = classifyOrderInsert(orderErr);
    // Transient/DB failure persisting the order: do NOT ack. Return a 5xx so Stripe
    // re-delivers the event — acking 200 here would lose a paid order with no fulfillment.
    if (insertOutcome === 'error') {
      console.error('order_insert_failed', orderErr?.message || orderErr);
      return json(503, { error: 'order_persist_failed' });
    }
    // A retry can observe the authoritative order before its effect rows exist (for
    // example, process termination immediately after persist_stripe_order). Recover
    // the order id, enqueue the same unique rows, and only then acknowledge.
    if (insertOutcome === 'duplicate') {
      const { data: existingOrder, error: lookupError } = await sb.from('orders')
        .select('id,order_number,company_id')
        .eq('stripe_payment_intent', s.payment_intent)
        .maybeSingle();
      if (lookupError || !existingOrder) {
        return json(503, { error: 'order_effect_recovery_failed' });
      }
      order = existingOrder;
    } else {
      const { data: persistedOrder, error: lookupError } = await sb.from('orders')
        .select('id,order_number,company_id')
        .eq('id', order.id)
        .maybeSingle();
      if (lookupError || !persistedOrder?.order_number) {
        return json(503, { error: 'order_reference_recovery_failed' });
      }
      order = persistedOrder;
    }

    try {
      await linkOrderProviderObject(sb, {
        orderId: order.id,
        provider: 'stripe',
        objectType: 'checkout_session',
        providerObjectId: s.id,
        metadata: { order_number: order.order_number, livemode: Boolean(s.livemode) },
      });
      await linkOrderProviderObject(sb, {
        orderId: order.id,
        provider: 'stripe',
        objectType: 'payment_intent',
        providerObjectId: s.payment_intent,
        metadata: { order_number: order.order_number, livemode: Boolean(s.livemode) },
      });
    } catch (error) {
      console.error('order_provider_link_failed', error?.code || error?.name || 'unknown');
      return json(503, { error: 'order_provider_link_failed' });
    }
    try {
      if (s.metadata?.order_number !== order.order_number) {
        await updateCheckoutSession(s.id, { metadata: { order_number: order.order_number } });
      }
    } catch (error) {
      console.error('stripe_order_metadata_failed', error?.code || error?.name || 'unknown');
      return json(503, { error: 'stripe_order_metadata_failed' });
    }
    const enqueueError = await enqueueRequiredEffects(
      sb,
      event,
      rawBody,
      checkoutOrderEffects({
        orderId: order.id,
        companyId: order.company_id || s.metadata?.company_id || null,
        stage: settled ? 'card' : 'ach_pending',
        currency: (s.currency || 'usd').toUpperCase(),
        total,
        discount: centsToAmount(s.total_details?.amount_discount),
      }),
    );
    if (enqueueError) return json(503, { error: 'stripe_effect_enqueue_failed' });
    const quoteTransitionError = await transitionQuotedCheckout(
      sb, s, order.id, settled ? finalizeQuotedOrder : markQuotedOrderPending, 'quote_transition_failed',
    );
    if (quoteTransitionError) return quoteTransitionError;
    // QBO invoice + linked payment are created asynchronously by /api/qbo-sync
    // (order tagged qbo_sync_status='pending' on insert above).
    return json(200, {
      received: true,
      ...(insertOutcome === 'duplicate' ? { duplicate: true } : {}),
    });
  }

  // ACH debit cleared (days after checkout.session.completed): promote the pending
  // order to paid, decrement stock, and send the real confirmation.
  if (event.type === 'checkout.session.async_payment_succeeded') {
    const s = event.data.object;
    const sb = getAdminClient(env);
    if (isSubscriptionCheckout(s) || !s.payment_intent) return json(200, { received: true });
    const { data: order } = await sb.from('orders')
      .select('id,status,company_id')
      .eq('stripe_payment_intent', s.payment_intent).maybeSingle();
    // completed hasn't landed yet (out-of-order delivery): 5xx so Stripe re-delivers.
    if (!order) return json(503, { error: 'order_not_recorded_yet' });
    let effectOrder = order;
    let duplicate = order.status !== 'pending_payment';
    if (order.status === 'pending_payment') {
      // qbo_sync_status was held at null while the debit processed; 'pending' releases
      // the order to the QBO invoice+payment worker now the money actually landed.
      const { data: claimedOrder, error: updErr } = await sb.from('orders')
        .update({
          status: 'paid',
          qbo_sync_status: stripeQboSyncStatus(s.livemode),
        })
        .eq('id', order.id)
        .eq('status', 'pending_payment')
        .select('id,status,company_id')
        .maybeSingle();
      if (updErr) return json(503, { error: 'order_update_failed' });
      if (!claimedOrder) return json(503, { error: 'order_effect_recovery_failed' });
      effectOrder = claimedOrder;
      duplicate = false;
    } else if (!['paid', 'fulfilled', 'refunded'].includes(order.status)) {
      return json(200, { received: true, duplicate: true });
    }
    const enqueueError = await enqueueRequiredEffects(
      sb,
      event,
      rawBody,
      checkoutOrderEffects({
        orderId: effectOrder.id,
        companyId: effectOrder.company_id,
        stage: 'ach_succeeded',
        currency: (s.currency || 'usd').toUpperCase(),
        total: centsToAmount(s.amount_total),
        discount: centsToAmount(s.total_details?.amount_discount),
      }),
    );
    if (enqueueError) return json(503, { error: 'stripe_effect_enqueue_failed' });
    const quoteTransitionError = await transitionQuotedCheckout(
      sb, s, effectOrder.id, finalizeQuotedOrder, 'quote_finalize_failed',
    );
    if (quoteTransitionError) return quoteTransitionError;
    return json(200, { received: true, ...(duplicate ? { duplicate: true } : {}) });
  }

  // ACH debit failed after the session completed: cancel the pending order (stock was
  // never decremented) and tell the buyer their order did not go through.
  if (event.type === 'checkout.session.async_payment_failed') {
    const s = event.data.object;
    const sb = getAdminClient(env);
    if (isSubscriptionCheckout(s) || !s.payment_intent) return json(200, { received: true });
    const { data: order } = await sb.from('orders')
      .select('id,status,company_id')
      .eq('stripe_payment_intent', s.payment_intent).maybeSingle();
    if (!order) return json(503, { error: 'order_not_recorded_yet' });
    let effectOrder = order;
    let duplicate = order.status !== 'pending_payment';
    if (order.status === 'pending_payment') {
      const { data: claimedOrder, error: cancelError } = await sb.from('orders')
        .update({ status: 'cancelled' })
        .eq('id', order.id)
        .eq('status', 'pending_payment')
        .select('id,status,company_id')
        .maybeSingle();
      if (cancelError) return json(503, { error: 'order_update_failed' });
      if (!claimedOrder) return json(503, { error: 'order_effect_recovery_failed' });
      effectOrder = claimedOrder;
      duplicate = false;
    } else if (order.status !== 'cancelled') {
      return json(200, { received: true, duplicate: true });
    }
    const enqueueError = await enqueueRequiredEffects(
      sb,
      event,
      rawBody,
      achFailedEffects({
        orderId: effectOrder.id,
        companyId: effectOrder.company_id,
      }),
    );
    if (enqueueError) return json(503, { error: 'stripe_effect_enqueue_failed' });
    const quoteTransitionError = await transitionQuotedCheckout(
      sb, s, effectOrder.id, reopenQuotedOrder, 'quote_reopen_failed',
    );
    if (quoteTransitionError) return quoteTransitionError;
    return json(200, { received: true, ...(duplicate ? { duplicate: true } : {}) });
  }

  // Subscription lifecycle → keep program_subscriptions status in sync.
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const status = event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status;
    try {
      const { error: updateError } = await getAdminClient(env).from('program_subscriptions')
        .update({ status }).eq('stripe_subscription_id', sub.id);
      if (updateError) return json(503, { error: 'program_subscription_update_failed' });
    } catch (e) {
      console.error('sub_status_update_failed', e?.message || e);
      return json(503, { error: 'program_subscription_update_failed' });
    }
    return json(200, { received: true });
  }

  // Failed subscription payment → mark past_due + send a dunning notice (#24).
  if (event.type === 'invoice.payment_failed') {
    const sb = getAdminClient(env);
    const plan = planFailedPayment(event.data.object);
    if (plan.subscriptionId) {
      const { error: updateError } = await sb.from('program_subscriptions')
        .update({ status: plan.status }).eq('stripe_subscription_id', plan.subscriptionId);
      if (updateError) return json(503, { error: 'program_subscription_update_failed' });
    }
    const enqueueError = await enqueueRequiredEffects(
      sb,
      event,
      rawBody,
      billingFailureEffects(plan),
    );
    if (enqueueError) return json(503, { error: 'stripe_effect_enqueue_failed' });
    return json(200, { received: true });
  }

  // Subscription invoice paid → clear delinquency; email a recovery notice only if the
  // subscription was actually past_due, so ordinary renewals never trigger an email.
  if (event.type === 'invoice.paid' && event.data.object?.subscription) {
    const sb = getAdminClient(env);
    const inv = event.data.object;
    const { data: row, error: subscriptionError } = await sb.from('program_subscriptions')
      .select('status,company_id,tier').eq('stripe_subscription_id', inv.subscription).maybeSingle();
    if (subscriptionError) return json(503, { error: 'program_subscription_lookup_failed' });
    const qboRow = qboSubscriptionInvoiceRow(inv, { companyId: row?.company_id, tier: row?.tier });
    if (!qboRow.company_id) return json(503, { error: 'program_subscription_not_recorded_yet' });
    const { error: qboQueueError } = await sb.from('qbo_subscription_invoices')
      .upsert(qboRow, { onConflict: 'stripe_invoice_id', ignoreDuplicates: true });
    if (qboQueueError) return json(503, { error: 'qbo_subscription_queue_failed' });
    const plan = planRecoveredPayment(inv);
    if (!plan.companyId && row?.company_id) plan.companyId = row.company_id;
    if (isDelinquentStatus(row?.status)) {
      const enqueueError = await enqueueRequiredEffects(
        sb,
        event,
        rawBody,
        billingRecoveryEffects(plan),
      );
      if (enqueueError) return json(503, { error: 'stripe_effect_enqueue_failed' });
    }
    const { error: updateError } = await sb.from('program_subscriptions')
      .update({ status: plan.status }).eq('stripe_subscription_id', inv.subscription);
    if (updateError) return json(503, { error: 'program_subscription_update_failed' });
    return json(200, { received: true });
  }

  // Card dispute opened → alert staff with the linked order for evidence gathering.
  if (event.type === 'charge.dispute.created') {
    const sb = getAdminClient(env);
    const plan = planDispute(event.data.object);
    let orderId = null;
    if (plan.paymentIntent) {
      const { data: ord } = await sb.from('orders').select('id')
        .eq('stripe_payment_intent', plan.paymentIntent).maybeSingle();
      orderId = ord?.id || null;
    }
    const enqueueError = await enqueueRequiredEffects(
      sb,
      event,
      rawBody,
      disputeEffects({ ...plan, orderId }),
    );
    if (enqueueError) return json(503, { error: 'stripe_effect_enqueue_failed' });
    return json(200, { received: true });
  }

  // Refund issued outside the admin flow (e.g. Stripe dashboard) → reconcile the order's
  // refunded_amount/status so the two never drift (idempotent via planRefundReconcile).
  if (event.type === 'charge.refunded') {
    const sb = getAdminClient(env);
    const charge = event.data.object;
    if (charge.payment_intent) {
      const { data: order } = await sb.from('orders')
        .select('id,order_number,company_id,status,total,refunded_amount,qbo_sync_status')
        .eq('stripe_payment_intent', charge.payment_intent).maybeSingle();
      if (order) {
        const plan = planRefundReconcile(charge, order);
        const patch = { refunded_amount: plan.refundedAmount };
        if (plan.fullyRefunded) patch.status = 'refunded';
        try {
          for (const refund of charge?.refunds?.data || []) {
            if (!refund?.id || refund.status === 'failed' || refund.status === 'canceled') continue;
            await linkOrderProviderObject(sb, {
              orderId: order.id,
              provider: 'stripe',
              objectType: 'refund',
              providerObjectId: refund.id,
              metadata: {
                order_number: order.order_number,
                amount: centsToAmount(refund.amount),
                currency: String(charge.currency || 'usd').toLowerCase(),
              },
            });
          }
        } catch (linkError) {
          return json(503, { error: 'stripe_refund_link_failed' });
        }
        // Queue accounting first. Stripe refund ids make this upsert idempotent, so if
        // the order patch fails a retry can safely replay the queue before reconciling.
        const qboQueueError = await enqueueQboRefundRows(sb, qboRefundRowsFromCharge(charge, order, plan));
        if (qboQueueError) return json(503, { error: 'qbo_refund_queue_failed' });
        const { error: refundUpdateError } = await sb.from('orders').update(patch).eq('id', order.id);
        if (refundUpdateError) return json(503, { error: 'refund_reconcile_failed' });
      }
    }
    return json(200, { received: true });
  }

  return json(200, { received: true });
}

export function createStripeWebhookHandler(dependencies = {}) {
  return (context) => handleStripeWebhook(context, dependencies);
}

export async function onRequestPost(context) {
  return handleStripeWebhook(context);
}

async function enqueueQboRefundRows(sb, rows) {
  if (!rows.length) return null;
  const withIds = rows.filter((row) => row.stripe_refund_id);
  const withoutIds = rows.filter((row) => !row.stripe_refund_id);
  try {
    for (const row of withIds) {
      const { error } = await sb.from('qbo_refunds').insert(row);
      if (error && error.code !== '23505') return error;
    }
    if (withoutIds.length) {
      const { error } = await sb.from('qbo_refunds').insert(withoutIds);
      if (error) return error;
    }
  } catch (error) {
    return error;
  }
  return null;
}
