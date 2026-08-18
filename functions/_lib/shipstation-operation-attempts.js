// Durable ShipStation mutation orchestration.
//
// The interface deliberately separates a mutation from its read-only reconciliation.
// Once provider success is known, replay never crosses the mutation seam again.

const OPERATIONS = new Set([
  'shipment_create',
  'shipment_update',
  'shipment_cancel',
  'label_purchase',
  'label_void',
  'label_return',
]);

const FORBIDDEN_SUMMARY_KEY = /(?:^|_)(?:raw|body|payload|secret|token|api_key|authorization|url)(?:_|$)/i;

function segment(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function canonicalValue(value) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ShipStationOperationAttemptError('shipstation_operation_fingerprint_invalid');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== 'object') {
    throw new ShipStationOperationAttemptError('shipstation_operation_fingerprint_invalid');
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function assertSafeSummary(value, depth = 0) {
  if (depth === 0) {
    let encoded;
    try {
      encoded = new TextEncoder().encode(JSON.stringify(value));
    } catch {
      throw new ShipStationOperationAttemptError('shipstation_operation_summary_invalid');
    }
    if (encoded.byteLength > 4096) {
      throw new ShipStationOperationAttemptError('shipstation_operation_summary_invalid');
    }
  }
  if (depth > 6) throw new ShipStationOperationAttemptError('shipstation_operation_summary_invalid');
  if (typeof value === 'string') {
    if (/(?:https?:\/\/|data:)/i.test(value)) {
      throw new ShipStationOperationAttemptError('shipstation_operation_summary_invalid');
    }
    return;
  }
  if (value == null || ['number', 'boolean'].includes(typeof value)) return;
  if (Array.isArray(value)) {
    if (value.length > 50) throw new ShipStationOperationAttemptError('shipstation_operation_summary_invalid');
    for (const item of value) assertSafeSummary(item, depth + 1);
    return;
  }
  if (typeof value !== 'object') {
    throw new ShipStationOperationAttemptError('shipstation_operation_summary_invalid');
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_SUMMARY_KEY.test(key)) {
      throw new ShipStationOperationAttemptError('shipstation_operation_summary_invalid');
    }
    assertSafeSummary(item, depth + 1);
  }
}

export class ShipStationOperationAttemptError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ShipStationOperationAttemptError';
    this.code = code;
  }
}

export function shipStationOperationKey({
  operation,
  orderId,
  orderShipmentId = null,
  revision = null,
  discriminator = null,
} = {}) {
  const kind = segment(operation, 40);
  const order = segment(orderId, 80);
  const shipment = segment(orderShipmentId, 80) || '-';
  const revisionPart = revision == null ? '-' : String(Number(revision));
  const detail = segment(discriminator, 160) || '-';
  if (!OPERATIONS.has(kind) || !order || !Number.isSafeInteger(Number(revisionPart === '-' ? 0 : revisionPart))) {
    throw new ShipStationOperationAttemptError('shipstation_operation_key_invalid');
  }
  return [kind, order, shipment, revisionPart, detail]
    .map((part) => encodeURIComponent(part))
    .join(':')
    .slice(0, 512);
}

export async function shipStationRequestFingerprint(value) {
  const canonical = JSON.stringify(canonicalValue(value));
  if (!canonical || canonical.length > 64 * 1024) {
    throw new ShipStationOperationAttemptError('shipstation_operation_fingerprint_invalid');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function runShipStationProviderOperation({
  operationKey,
  leaseOwner,
  attemptAdapter,
  callProvider,
  summarizeProviderResult,
  finalize,
  summarizeFinalResult = null,
  classifyProviderError = () => 'ambiguous',
}) {
  if (!attemptAdapter || typeof attemptAdapter.claim !== 'function'
      || typeof attemptAdapter.providerSucceeded !== 'function'
      || typeof attemptAdapter.complete !== 'function'
      || typeof attemptAdapter.reconcile !== 'function'
      || typeof attemptAdapter.release !== 'function'
      || typeof callProvider !== 'function' || typeof finalize !== 'function') {
    throw new ShipStationOperationAttemptError('shipstation_operation_interface_invalid');
  }
  const key = segment(operationKey, 512);
  const owner = segment(leaseOwner, 128);
  if (!key || !owner) throw new ShipStationOperationAttemptError('shipstation_operation_claim_invalid');

  const claim = await attemptAdapter.claim({ operationKey: key, leaseOwner: owner });
  const state = segment(claim?.state, 40);
  if (state === 'completed') {
    return { replayed: true, result: claim?.result_summary || {} };
  }
  if (state === 'provider_succeeded' || state === 'reconcile_required') {
    throw new ShipStationOperationAttemptError('shipstation_operation_reconciliation_required');
  }
  if (state !== 'claimed' || segment(claim?.lease_owner, 128) !== owner) {
    throw new ShipStationOperationAttemptError('shipstation_operation_locked');
  }

  let providerResult;
  try {
    providerResult = await callProvider();
  } catch (error) {
    const classification = classifyProviderError(error) === 'not_accepted' ? 'not_accepted' : 'ambiguous';
    const update = {
      operationKey: key,
      leaseOwner: owner,
      errorCode: segment(error?.code || 'shipstation_request_failed', 80),
    };
    if (classification === 'not_accepted') {
      await attemptAdapter.release(update);
    } else {
      await attemptAdapter.reconcile(update);
    }
    throw error;
  }

  let providerSummary;
  try {
    providerSummary = typeof summarizeProviderResult === 'function'
      ? summarizeProviderResult(providerResult)
      : {};
    assertSafeSummary(providerSummary);
  } catch (error) {
    // The provider has already accepted the mutation. Persist that boundary even
    // when local summary code is defective so a retry can only reconcile.
    await attemptAdapter.providerSucceeded({
      operationKey: key,
      leaseOwner: owner,
      resultSummary: {},
    });
    throw error;
  }
  await attemptAdapter.providerSucceeded({
    operationKey: key,
    leaseOwner: owner,
    resultSummary: providerSummary,
  });

  const finalized = await finalize(providerResult, providerSummary);
  const finalSummary = typeof summarizeFinalResult === 'function'
    ? summarizeFinalResult(finalized)
    : providerSummary;
  assertSafeSummary(finalSummary);
  await attemptAdapter.complete({
    operationKey: key,
    leaseOwner: owner,
    resultSummary: finalSummary,
  });
  return { replayed: false, result: finalized };
}
