// Persisted Quote Checkout attempt orchestration.
//
// The database owns one active attempt per Quote. Stripe idempotency belongs to that
// attempt, so a lost HTTP response replays the same provider operation. A changed
// request cannot claim a new attempt until the exact prior Checkout Session has been
// verified complete/expired or actively expired at Stripe.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class QuoteCheckoutAttemptError extends Error {
  constructor(status, code, { retryable = false, providerCode = null } = {}) {
    super(code);
    this.name = 'QuoteCheckoutAttemptError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.providerCode = providerCode;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function quoteCheckoutRequestFingerprint(value) {
  const bytes = new TextEncoder().encode(stableJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function quoteCheckoutAttemptIdempotencyKey(attemptId) {
  if (!UUID.test(String(attemptId || ''))) throw new Error('quote_checkout_attempt_id_invalid');
  return `quote-checkout-attempt:${attemptId}`;
}

export function quoteCheckoutParamsForAttempt(params, attemptId, identity) {
  if (!UUID.test(String(attemptId || ''))) throw new Error('quote_checkout_attempt_id_invalid');
  const offerRevision = Number(identity?.offerRevision);
  if (!Number.isSafeInteger(offerRevision) || offerRevision < 1) {
    throw new Error('quote_checkout_offer_revision_invalid');
  }
  return {
    ...(params || {}),
    metadata: {
      ...(params?.metadata || {}),
      quote_checkout_attempt_id: attemptId,
      quote_offer_revision: String(offerRevision),
    },
  };
}

function dbFailure(error) {
  const detail = String(error?.message || error?.code || '');
  if (/quote_checkout_cutover_pending/i.test(detail)) {
    return new QuoteCheckoutAttemptError(503, 'quote_checkout_cutover_pending', { retryable: true });
  }
  if (/quote_checkout_order_revision_stale/i.test(detail)) {
    return new QuoteCheckoutAttemptError(409, 'quote_cart_changed');
  }
  if (/quote_checkout_mutation_busy/i.test(detail)) {
    return new QuoteCheckoutAttemptError(409, 'quote_checkout_busy', { retryable: true });
  }
  if (/quote_checkout_unavailable/i.test(detail)) {
    return new QuoteCheckoutAttemptError(409, 'quote_unavailable');
  }
  return new QuoteCheckoutAttemptError(503, 'quote_checkout_attempt_unavailable', { retryable: true });
}

function checked(result) {
  if (result?.error) throw dbFailure(result.error);
  if (!result?.data || typeof result.data !== 'object') {
    throw new QuoteCheckoutAttemptError(503, 'quote_checkout_attempt_unavailable', { retryable: true });
  }
  return result.data;
}

export function createSupabaseQuoteCheckoutAttemptStore(sb) {
  if (!sb) throw new Error('supabase_client_required');
  return {
    async claim({ candidateId, identity, fingerprint, requestParams }) {
      return checked(await sb.rpc('claim_quote_checkout_attempt', {
        p_candidate_id: candidateId,
        p_quote_id: identity.quoteId,
        p_quote_order_id: identity.quoteOrderId,
        p_requester_id: identity.requesterId,
        p_company_id: identity.companyId,
        p_offer_revision: identity.offerRevision,
        p_order_snapshot: identity.orderSnapshot,
        p_request_fingerprint: fingerprint,
        p_request_params: requestParams,
      }));
    },
    async attach({ attemptId, identity, session }) {
      return checked(await sb.rpc('attach_quote_checkout_session', {
        p_attempt_id: attemptId,
        p_quote_id: identity.quoteId,
        p_quote_order_id: identity.quoteOrderId,
        p_offer_revision: identity.offerRevision,
        p_stripe_session_id: session.id,
        p_stripe_session_url: session.url,
        p_stripe_session_expires_at: new Date(Number(session.expires_at) * 1000).toISOString(),
      }));
    },
    async finish({ attemptId, identity, sessionId = null, terminalStatus, providerStatus, reason }) {
      return checked(await sb.rpc('finish_quote_checkout_attempt', {
        p_attempt_id: attemptId,
        p_quote_id: identity.quoteId,
        p_quote_order_id: identity.quoteOrderId,
        p_offer_revision: identity.offerRevision,
        p_stripe_session_id: sessionId,
        p_terminal_status: terminalStatus,
        p_provider_status: providerStatus || null,
        p_reason: reason || null,
      }));
    },
    async finishLegacy({ identity, sessionId, terminalStatus, providerStatus, reason }) {
      return checked(await sb.rpc('finish_legacy_quote_checkout_attempt', {
        p_quote_id: identity.quoteId,
        p_quote_order_id: identity.quoteOrderId,
        p_stripe_session_id: sessionId,
        p_terminal_status: terminalStatus,
        p_provider_status: providerStatus || null,
        p_reason: reason || null,
      }));
    },
    async preflight({ attemptId, identity, sessionId, eventId }) {
      return checked(await sb.rpc('claim_quote_checkout_webhook', {
        p_attempt_id: attemptId,
        p_quote_id: identity.quoteId,
        p_quote_order_id: identity.quoteOrderId,
        p_offer_revision: identity.offerRevision,
        p_stripe_session_id: sessionId,
        p_provider_event_id: eventId,
      }));
    },
    async preflightLegacy({ quoteId, quoteOrderId, sessionId, eventId }) {
      return checked(await sb.rpc('claim_legacy_quote_checkout_webhook', {
        p_quote_id: quoteId,
        p_quote_order_id: quoteOrderId,
        p_stripe_session_id: sessionId,
        p_provider_event_id: eventId,
      }));
    },
    async beginMutation({ candidateId, identity, kind }) {
      return checked(await sb.rpc('begin_quote_checkout_mutation', {
        p_candidate_id: candidateId,
        p_quote_id: identity.quoteId,
        p_quote_order_id: identity.quoteOrderId,
        p_requester_id: identity.requesterId,
        p_company_id: identity.companyId,
        p_offer_revision: identity.offerRevision,
        p_expected_offer_status: identity.offerStatus,
        p_kind: kind,
      }));
    },
    async releaseMutation({ mutationId, identity }) {
      return checked(await sb.rpc('release_quote_checkout_mutation', {
        p_mutation_id: mutationId,
        p_quote_id: identity.quoteId,
        p_quote_order_id: identity.quoteOrderId,
        p_offer_revision: identity.offerRevision,
      }));
    },
  };
}

function definitelyRejected(error) {
  const status = Number(error?.statusCode || error?.status || 0);
  const type = String(error?.type || error?.rawType || '');
  return type === 'StripeInvalidRequestError'
    || type === 'invalid_request_error'
    || (status >= 400 && status < 500 && ![409, 429].includes(status));
}

function providerFailure(error) {
  return new QuoteCheckoutAttemptError(502, 'stripe_error', {
    retryable: !definitelyRejected(error),
    providerCode: error?.code || null,
  });
}

function validSession(session, { requireUrl = false } = {}) {
  return /^cs_[A-Za-z0-9_]+$/.test(String(session?.id || ''))
    && ['open', 'complete', 'expired'].includes(String(session?.status || ''))
    && (!requireUrl || /^https:\/\//.test(String(session?.url || '')))
    && Number.isFinite(Number(session?.expires_at));
}

function claimedIdentity(claim, fallback) {
  const stored = {
    quoteId: String(claim?.quote_id || ''),
    quoteOrderId: String(claim?.quote_order_id || ''),
    requesterId: String(claim?.requester_id || ''),
    companyId: String(claim?.company_id || ''),
    offerRevision: Number(claim?.offer_revision),
  };
  const hasStoredIdentity = [
    claim?.quote_id,
    claim?.quote_order_id,
    claim?.requester_id,
    claim?.company_id,
    claim?.offer_revision,
  ].some((value) => value !== undefined && value !== null && value !== '');
  if (!hasStoredIdentity) return fallback;
  if (![stored.quoteId, stored.quoteOrderId, stored.requesterId, stored.companyId].every((id) => UUID.test(id))
    || !Number.isSafeInteger(stored.offerRevision)
    || stored.offerRevision < 1) {
    throw new QuoteCheckoutAttemptError(503, 'quote_checkout_attempt_unavailable', { retryable: true });
  }
  return stored;
}

async function finishAttempt(store, input) {
  try {
    return await store.finish(input);
  } catch (error) {
    if (error instanceof QuoteCheckoutAttemptError) throw error;
    throw dbFailure(error);
  }
}

async function createForAttempt({ stripe, store, claim, identity, requestParams, returnOpen }) {
  const attemptId = String(claim.attempt_id || '');
  const attemptIdentity = claimedIdentity(claim, identity);
  const storedParams = claim.request_params && typeof claim.request_params === 'object'
    ? claim.request_params
    : requestParams;
  let session;
  try {
    session = await stripe.checkout.sessions.create(
      quoteCheckoutParamsForAttempt(storedParams, attemptId, attemptIdentity),
      { idempotencyKey: quoteCheckoutAttemptIdempotencyKey(attemptId) },
    );
  } catch (error) {
    if (definitelyRejected(error)) {
      await finishAttempt(store, {
        attemptId,
        identity: attemptIdentity,
        terminalStatus: 'failed',
        providerStatus: 'rejected',
        reason: 'provider_rejected',
      });
    }
    throw providerFailure(error);
  }
  if (!validSession(session, { requireUrl: session?.status === 'open' })) {
    throw new QuoteCheckoutAttemptError(503, 'quote_checkout_provider_response_invalid', { retryable: true });
  }
  if (session.status === 'complete') {
    await finishAttempt(store, {
      attemptId,
      identity: attemptIdentity,
      sessionId: session.id,
      terminalStatus: 'provider_completed',
      providerStatus: session.status,
      reason: 'provider_complete',
    });
    throw new QuoteCheckoutAttemptError(409, 'quote_checkout_processing', { retryable: true });
  }
  if (session.status === 'expired') {
    await finishAttempt(store, {
      attemptId,
      identity: attemptIdentity,
      sessionId: session.id,
      terminalStatus: 'expired',
      providerStatus: session.status,
      reason: 'provider_expired',
    });
    return { released: true };
  }
  if (!returnOpen) return { session, attemptId };
  try {
    const attached = await store.attach({ attemptId, identity: attemptIdentity, session });
    return {
      url: attached.stripe_session_url || session.url,
      attemptId,
      reused: claim.action === 'recover',
    };
  } catch (error) {
    if (error instanceof QuoteCheckoutAttemptError) throw error;
    throw dbFailure(error);
  }
}

async function reconcileAttempt({ stripe, store, claim, identity, requestParams }) {
  const attemptId = String(claim.attempt_id || '');
  const attemptIdentity = claimedIdentity(claim, identity);
  let session;
  if (claim.status === 'creating') {
    const recovered = await createForAttempt({
      stripe,
      store,
      claim,
      identity: attemptIdentity,
      requestParams,
      returnOpen: false,
    });
    if (recovered.released) return { released: true };
    session = recovered.session;
  } else {
    const sessionId = String(claim.stripe_session_id || '');
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      throw new QuoteCheckoutAttemptError(503, 'quote_checkout_attempt_unavailable', { retryable: true });
    }
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (error) {
      throw providerFailure(error);
    }
    if (!validSession(session) || session.id !== sessionId) {
      throw new QuoteCheckoutAttemptError(503, 'quote_checkout_provider_response_invalid', { retryable: true });
    }
  }

  if (session.status === 'complete') {
    await finishAttempt(store, {
      attemptId,
      identity: attemptIdentity,
      sessionId: session.id,
      terminalStatus: 'provider_completed',
      providerStatus: session.status,
      reason: 'provider_complete',
    });
    throw new QuoteCheckoutAttemptError(409, 'quote_checkout_processing', { retryable: true });
  }
  if (session.status === 'expired') {
    await finishAttempt(store, {
      attemptId,
      identity: attemptIdentity,
      sessionId: session.id,
      terminalStatus: 'expired',
      providerStatus: session.status,
      reason: 'provider_expired',
    });
    return { released: true };
  }

  let expired;
  try {
    expired = await stripe.checkout.sessions.expire(session.id);
  } catch (error) {
    // The expiry call can race a payment completion. Re-read the exact Session before
    // deciding whether rotation is safe; an ambiguous provider outcome remains locked.
    try {
      expired = await stripe.checkout.sessions.retrieve(session.id);
    } catch {
      throw providerFailure(error);
    }
  }
  if (!validSession(expired) || expired.id !== session.id) {
    throw new QuoteCheckoutAttemptError(503, 'quote_checkout_provider_response_invalid', { retryable: true });
  }
  if (expired.status === 'complete') {
    await finishAttempt(store, {
      attemptId,
      identity: attemptIdentity,
      sessionId: expired.id,
      terminalStatus: 'provider_completed',
      providerStatus: expired.status,
      reason: 'provider_complete',
    });
    throw new QuoteCheckoutAttemptError(409, 'quote_checkout_processing', { retryable: true });
  }
  if (expired.status !== 'expired') {
    throw new QuoteCheckoutAttemptError(503, 'quote_checkout_expiry_unverified', { retryable: true });
  }
  await finishAttempt(store, {
    attemptId,
    identity: attemptIdentity,
    sessionId: expired.id,
    terminalStatus: 'expired',
    providerStatus: expired.status,
    reason: 'request_rotated',
  });
  return { released: true };
}

export async function openQuoteCheckoutSession({
  stripe,
  store,
  identity,
  requestParams,
  fingerprintValue,
  attemptIdFactory = () => globalThis.crypto.randomUUID(),
  maxClaims = 4,
}) {
  const fingerprint = await quoteCheckoutRequestFingerprint(fingerprintValue);
  for (let index = 0; index < maxClaims; index += 1) {
    let claim;
    try {
      claim = await store.claim({
        candidateId: attemptIdFactory(),
        identity,
        fingerprint,
        requestParams,
      });
    } catch (error) {
      if (error instanceof QuoteCheckoutAttemptError) throw error;
      throw dbFailure(error);
    }
    if (claim.action === 'reuse') {
      if (!/^https:\/\//.test(String(claim.stripe_session_url || ''))) {
        throw new QuoteCheckoutAttemptError(503, 'quote_checkout_attempt_unavailable', { retryable: true });
      }
      return { url: claim.stripe_session_url, attemptId: claim.attempt_id, reused: true };
    }
    if (claim.action === 'blocked') {
      if (['provider_completed', 'processing', 'completed'].includes(claim.status)) {
        throw new QuoteCheckoutAttemptError(409, 'quote_checkout_processing', { retryable: true });
      }
      throw new QuoteCheckoutAttemptError(503, 'quote_checkout_attempt_unavailable', { retryable: true });
    }
    if (claim.action === 'created' || claim.action === 'recover') {
      const opened = await createForAttempt({
        stripe,
        store,
        claim,
        identity,
        requestParams,
        returnOpen: true,
      });
      if (opened.released) continue;
      return opened;
    }
    if (claim.action === 'reconcile') {
      const reconciled = await reconcileAttempt({ stripe, store, claim, identity, requestParams });
      if (reconciled.released) continue;
    } else {
      throw new QuoteCheckoutAttemptError(503, 'quote_checkout_attempt_unavailable', { retryable: true });
    }
  }
  throw new QuoteCheckoutAttemptError(409, 'quote_checkout_busy', { retryable: true });
}

export async function prepareQuoteCheckoutMutation({
  stripe,
  store,
  identity,
  kind,
  mutationIdFactory = () => globalThis.crypto.randomUUID(),
} = {}) {
  if (!['decline', 'revise'].includes(kind)) {
    throw new QuoteCheckoutAttemptError(400, 'quote_checkout_mutation_invalid');
  }
  let claim;
  try {
    claim = await store.beginMutation({
      candidateId: mutationIdFactory(),
      identity,
      kind,
    });
  } catch (error) {
    if (error instanceof QuoteCheckoutAttemptError) throw error;
    throw dbFailure(error);
  }
  const mutationId = String(claim.mutation_id || '');
  if (!UUID.test(mutationId)) {
    throw new QuoteCheckoutAttemptError(503, 'quote_checkout_attempt_unavailable', { retryable: true });
  }
  if (claim.action === 'ready') return { mutationId };
  if (claim.action === 'blocked') {
    throw new QuoteCheckoutAttemptError(409, 'quote_checkout_processing', { retryable: true });
  }
  if (claim.action !== 'reconcile' || !stripe) {
    throw new QuoteCheckoutAttemptError(503, 'quote_checkout_attempt_unavailable', { retryable: true });
  }
  const reconciled = await reconcileAttempt({
    stripe,
    store,
    claim,
    identity,
    requestParams: {},
  });
  if (!reconciled.released) {
    throw new QuoteCheckoutAttemptError(503, 'quote_checkout_attempt_unavailable', { retryable: true });
  }
  return { mutationId };
}

export async function releaseQuoteCheckoutMutation(store, { mutationId, identity }) {
  try {
    return await store.releaseMutation({ mutationId, identity });
  } catch (error) {
    if (error instanceof QuoteCheckoutAttemptError) throw error;
    throw dbFailure(error);
  }
}

export async function finishQuoteCheckoutAttemptFromSession(sb, session, {
  terminalStatus,
  reason,
  store = createSupabaseQuoteCheckoutAttemptStore(sb),
} = {}) {
  const attemptId = String(session?.metadata?.quote_checkout_attempt_id || '');
  const identity = {
    quoteId: String(session?.metadata?.quote_id || ''),
    quoteOrderId: String(session?.metadata?.quote_order_id || ''),
    offerRevision: Number(session?.metadata?.quote_offer_revision),
  };
  const sessionId = String(session?.id || '');
  if (!attemptId) {
    if (!identity.quoteId && !identity.quoteOrderId) return { skipped: 'legacy_session' };
    if (![identity.quoteId, identity.quoteOrderId].every((id) => UUID.test(id))
      || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)
      || !['completed', 'expired', 'failed'].includes(terminalStatus)
      || typeof store.finishLegacy !== 'function') {
      return { error: 'quote_checkout_attempt_identity_invalid' };
    }
    try {
      return await store.finishLegacy({
        identity: { quoteId: identity.quoteId, quoteOrderId: identity.quoteOrderId },
        sessionId,
        terminalStatus,
        providerStatus: session.status || null,
        reason,
      });
    } catch {
      return { error: 'quote_checkout_attempt_finish_failed' };
    }
  }
  if (![attemptId, identity.quoteId, identity.quoteOrderId].every((id) => UUID.test(id))
    || !Number.isSafeInteger(identity.offerRevision)
    || identity.offerRevision < 1
    || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)
    || !['completed', 'expired', 'failed'].includes(terminalStatus)) {
    return { error: 'quote_checkout_attempt_identity_invalid' };
  }
  try {
    return await store.finish({
      attemptId,
      identity,
      sessionId,
      terminalStatus,
      providerStatus: session.status || null,
      reason,
    });
  } catch {
    return { error: 'quote_checkout_attempt_finish_failed' };
  }
}

export async function preflightQuoteCheckoutAttemptFromSession(sb, session, eventId, {
  store = createSupabaseQuoteCheckoutAttemptStore(sb),
} = {}) {
  const quoteId = String(session?.metadata?.quote_id || '');
  const quoteOrderId = String(session?.metadata?.quote_order_id || '');
  const attemptId = String(session?.metadata?.quote_checkout_attempt_id || '');
  if (!quoteId && !quoteOrderId && !attemptId) return { skipped: 'non_quote_session' };
  if (quoteId && quoteOrderId && !attemptId) {
    if (![quoteId, quoteOrderId].every((id) => UUID.test(id))
      || !/^cs_[A-Za-z0-9_]+$/.test(String(session?.id || ''))
      || !String(eventId || '').trim()
      || String(eventId).length > 255) {
      return { error: 'quote_checkout_attempt_identity_invalid' };
    }
    try {
      const adopted = await store.preflightLegacy({
        quoteId,
        quoteOrderId,
        sessionId: session.id,
        eventId: String(eventId),
      });
      const adoptedAttemptId = String(adopted?.attempt_id || '');
      const adoptedOfferRevision = Number(adopted?.offer_revision);
      if (!UUID.test(adoptedAttemptId)
        || !Number.isSafeInteger(adoptedOfferRevision)
        || adoptedOfferRevision < 1) {
        return { error: 'quote_checkout_attempt_preflight_failed' };
      }
      return {
        action: adopted.action,
        legacy: true,
        attemptId: adoptedAttemptId,
        offerRevision: adoptedOfferRevision,
      };
    } catch {
      return { error: 'quote_checkout_attempt_preflight_failed' };
    }
  }
  const offerRevision = Number(session?.metadata?.quote_offer_revision);
  const identity = { quoteId, quoteOrderId, offerRevision };
  if (![attemptId, quoteId, quoteOrderId].every((id) => UUID.test(id))
    || !Number.isSafeInteger(offerRevision)
    || offerRevision < 1
    || !/^cs_[A-Za-z0-9_]+$/.test(String(session?.id || ''))
    || !String(eventId || '').trim()
    || String(eventId).length > 255) {
    return { error: 'quote_checkout_attempt_identity_invalid' };
  }
  try {
    return await store.preflight({
      attemptId,
      identity,
      sessionId: session.id,
      eventId: String(eventId),
    });
  } catch {
    return { error: 'quote_checkout_attempt_preflight_failed' };
  }
}
