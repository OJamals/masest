import { adminClient, emailLayout, htmlEscape, sendEmail } from './supabase.js';
import { recordAudit } from './audit.js';
import { linkOrderProviderObject } from './order-integrations.js';
import { recordOrderFinancialEntry } from './order-financial-ledger.js';
import {
  ShipStationError,
  buildRateRequest,
  normalizePackages,
  shipStationRequest,
} from './shipstation.js';
import { combinePackagesForRates, normalizePackagePlan } from './shipping-packages.js';
import {
  resolveShipmentLabel,
  shipmentLabelOwnership,
} from './shipment-label-ownership.js';
import {
  shipStationOperationKey,
  shipStationRequestFingerprint,
} from './shipstation-operation-attempts.js';
import { ProviderTimeoutError, fetchWithDeadline } from './provider-fetch.js';

const SHIPPABLE_STATUSES = new Set(['paid', 'net_open', 'net_paid', 'fulfilled']);
const VOID_BLOCKING_TRACKING_STATUSES = new Set(['shipped', 'in_transit', 'out_for_delivery', 'delivered']);
const LABEL_FORMATS = new Set(['pdf', 'png', 'zpl']);
const LABEL_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const LABEL_DOWNLOAD_PREFIXES = [
  ['api.shipengine.com', '/v1/downloads/'],
  ['api.shipstation.com', '/v2/downloads/'],
];
const MASEST_SHIPSTATION_WAREHOUSE_ID = 'se-2287981';

function operationLeaseOwner() {
  return `shipstation:${crypto.randomUUID()}`;
}

function attemptHandle(claim) {
  const operationKey = text(claim?.operation_key, 512);
  const leaseOwner = text(claim?.lease_owner, 128);
  return operationKey && leaseOwner ? { operationKey, leaseOwner } : null;
}

function providerFailureIsProvenRejection(error) {
  const status = Number(error?.status || 0);
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function orderId(value) {
  const id = text(value, 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new ShipStationError('shipping_order_required');
  }
  return id;
}

function providerId(value, code) {
  const id = text(value, 100);
  if (!/^se-[a-z0-9_-]+$/i.test(id)) throw new ShipStationError(code);
  return id;
}

function externalShipmentId(value) {
  const id = String(value ?? '').trim();
  if (!id || id.length > 50) throw new ShipStationError('shipstation_external_shipment_id_invalid');
  return id;
}

function rowId(value, code = 'shipstation_order_shipment_required') {
  const id = text(value, 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new ShipStationError(code);
  }
  return id;
}

function splitKey(value) {
  const key = text(value || 'default', 40).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(key)) throw new ShipStationError('shipstation_split_key_invalid');
  return key;
}

function expectedRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new ShipStationError('shipstation_shipment_revision_required');
  }
  return revision;
}

function normalizeSplitItems(order, input, key) {
  const orderItems = Array.isArray(order?.order_items) ? order.order_items : [];
  const available = new Map();
  for (const item of orderItems) {
    const sku = text(item?.sku, 160);
    const quantity = Math.max(0, Math.floor(number(item?.qty) || 0));
    if (sku && quantity) available.set(sku, (available.get(sku) || 0) + quantity);
  }
  const requested = Array.isArray(input) && input.length
    ? input
    : key === 'default'
      ? [...available].map(([sku, quantity]) => ({ sku, quantity }))
      : null;
  if (!requested) throw new ShipStationError('shipstation_split_items_required');
  const seen = new Set();
  return requested.map((item) => {
    const sku = text(item?.sku, 160);
    const quantity = Number(item?.quantity ?? item?.qty);
    if (!sku || seen.has(sku) || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > (available.get(sku) || 0)) {
      throw new ShipStationError('shipstation_split_items_invalid');
    }
    seen.add(sku);
    return { sku, quantity };
  });
}

function allocatedOrderItems(order, itemAllocations) {
  const allocationBySku = new Map(itemAllocations.map((item) => [item.sku, item.quantity]));
  const selected = new Map();
  for (const item of Array.isArray(order?.order_items) ? order.order_items : []) {
    const sku = text(item?.sku, 160);
    if (allocationBySku.has(sku) && !selected.has(sku)) {
      selected.set(sku, { ...item, sku, qty: allocationBySku.get(sku) });
    }
  }
  return [...selected.values()];
}

// The constant is the known-good production warehouse, kept as a guard against a typo'd or
// half-configured env. A deliberate override is allowed (account rebuild, second warehouse)
// via SHIPSTATION_WAREHOUSE_ALLOW_OVERRIDE so a provider-side change is not an outage.
async function sendReturnLabelEmail(env, order, { labelUrl, trackingNumber, returnLabelId, reason }) {
  const to = text(order?.customer_email, 254);
  if (!to || !env?.RESEND_API_KEY) return false;
  const appUrl = String(env.APP_URL || 'https://masest.co').replace(/\/+$/, '');
  const reference = text(order?.order_number, 60) || text(order?.id, 40);
  const details = [
    trackingNumber ? `<li><strong>Return tracking #:</strong> ${htmlEscape(trackingNumber)}</li>` : '',
    reason ? `<li><strong>Reason on file:</strong> ${htmlEscape(reason)}</li>` : '',
  ].filter(Boolean).join('');
  try {
    return await sendEmail(env, {
      to: [to],
      bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : [],
      subject: `Your return label for MASEST order ${reference}`,
      html: emailLayout({
        heading: `Return label for order ${reference}`,
        bodyHtml: `<p>Print the label below, tape it to the sealed carton, and drop it with the carrier. Keep the products in their original packaging where you can.</p>${details ? `<ul>${details}</ul>` : ''}<p>Once the carrier scans it we will confirm the return and process any refund.</p>`,
        ctaText: labelUrl ? 'Print return label' : 'View your orders',
        ctaUrl: labelUrl || `${appUrl}/dashboard.html#orders`,
      }),
      category: 'order',
      // One send per label, so a retried staff click cannot spam the buyer.
      idempotencyKey: `return-label:${returnLabelId}`,
    });
  } catch {
    return false;
  }
}

function configuredWarehouseId(env) {
  const warehouseId = text(env?.SHIPSTATION_WAREHOUSE_ID, 100);
  if (!warehouseId) throw new ShipStationError('shipstation_warehouse_required');
  if (warehouseId !== MASEST_SHIPSTATION_WAREHOUSE_ID
    && text(env?.SHIPSTATION_WAREHOUSE_ALLOW_OVERRIDE, 8).toLowerCase() !== 'true') {
    throw new ShipStationError('shipstation_warehouse_mismatch');
  }
  if (!/^se-[a-z0-9_-]+$/i.test(warehouseId)) {
    throw new ShipStationError('shipstation_warehouse_mismatch');
  }
  return warehouseId;
}

function reason(value) {
  const result = text(value, 280);
  if (result.length < 8) throw new ShipStationError('shipstation_reason_required');
  return result;
}

function number(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value) {
  if (value && typeof value === 'object') return number(value.amount);
  return number(value);
}

const CURRENCY_EXPONENTS = new Map([
  ['bhd', 3], ['jod', 3], ['kwd', 3], ['omr', 3], ['tnd', 3],
  ['bif', 0], ['clp', 0], ['djf', 0], ['gnf', 0], ['jpy', 0],
  ['kmf', 0], ['krw', 0], ['mga', 0], ['pyg', 0], ['rwf', 0],
  ['ugx', 0], ['vnd', 0], ['vuv', 0], ['xaf', 0], ['xof', 0], ['xpf', 0],
]);

function amountToMinor(value, currency) {
  const amount = money(value);
  const code = text(currency, 8).toLowerCase();
  if (!Number.isFinite(amount) || amount < 0 || !/^[a-z]{3}$/.test(code)) {
    throw new ShipStationError('shipstation_rate_response_invalid');
  }
  const exponent = CURRENCY_EXPONENTS.get(code) ?? 2;
  const scaled = Math.round((amount + Number.EPSILON) * (10 ** exponent));
  if (!Number.isSafeInteger(scaled)) throw new ShipStationError('shipstation_rate_response_invalid');
  return { amountMinor: scaled, currencyExponent: exponent };
}

function payloadList(payload, key) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

function safeRate(rate) {
  const currency = text(rate?.shipping_amount?.currency || rate?.currency, 8).toLowerCase();
  const { amountMinor, currencyExponent } = amountToMinor(rate?.shipping_amount ?? rate?.amount, currency);
  return {
    rate_id: text(rate?.rate_id, 100),
    shipment_id: text(rate?.shipment_id, 100),
    carrier_id: text(rate?.carrier_id, 100),
    carrier_code: text(rate?.carrier_code, 80),
    carrier_name: text(rate?.carrier_friendly_name || rate?.carrier_name || rate?.carrier_code, 120),
    service_code: text(rate?.service_code, 100),
    service_type: text(rate?.service_type || rate?.service_code, 120),
    amount: money(rate?.shipping_amount ?? rate?.amount),
    amount_minor: amountMinor,
    currency,
    currency_exponent: currencyExponent,
    delivery_days: number(rate?.delivery_days ?? rate?.carrier_delivery_days),
    estimated_delivery_date: text(rate?.estimated_delivery_date, 80) || null,
  };
}

export async function stablePackageHash(input) {
  const normalized = normalizePackages(input);
  const canonical = normalized.map((pkg, index) => [
    index + 1,
    pkg.package_code,
    pkg.weight.unit,
    pkg.weight.value.toFixed(3),
    pkg.dimensions?.unit || '',
    pkg.dimensions ? pkg.dimensions.length.toFixed(3) : '',
    pkg.dimensions ? pkg.dimensions.width.toFixed(3) : '',
    pkg.dimensions ? pkg.dimensions.height.toFixed(3) : '',
  ].join('|')).join('\n');
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function existingLabelForShipment(order, orderShipmentId, shipmentId) {
  const label = shipmentLabelOwnership(order).outbound.find((entry) => (
    entry.active
    && entry.order_shipment_id === orderShipmentId
    && entry.provider_shipment_id === shipmentId
  ));
  if (!label) return null;
  const link = order.order_provider_links.find((entry) => entry.id === label.provider_link_id);
  const metadata = link?.metadata && typeof link.metadata === 'object' ? link.metadata : {};
  return {
    already_purchased: true,
    label_id: label.label_id,
    shipment_id: label.provider_shipment_id,
    order_shipment_id: label.order_shipment_id,
    revision: label.revision,
    rate_id: text(metadata.rate_id, 100) || null,
    status: label.status,
    tracking_number: label.tracking_number,
    tracking_url: text(metadata.tracking_url, 1000) || null,
    cost: label.cost,
    currency: text(label.currency || order?.currency || 'usd', 8).toLowerCase(),
  };
}

async function defaultLoadOrder(env, id) {
  const { data, error } = await adminClient(env).from('orders')
    .select('id,order_number,status,customer_email,currency,ship_address,created_at,updated_at,shipping_package_plan,paid_shipping_rate_id,paid_shipping_carrier_id,paid_shipping_service_code,shipstation_shipment_id,shipstation_order_shipment_id,shipstation_shipment_revision,shipstation_package_hash,shipstation_shipment_state,shipstation_label_id,shipstation_rate_id,shipstation_label_status,shipstation_label_url,shipstation_cost,shipstation_error,shipstation_updated_at,shipstation_return_label_id,shipstation_return_label_status,shipstation_return_cost,shipstation_return_currency,shipstation_return_charge_event,shipstation_return_tracking_number,shipstation_return_error,shipstation_return_updated_at,tracking_status,carrier,tracking_number,tracking_url,order_items(sku,name,qty,unit_price),order_shipments(id,split_key,generation,revision,provider_shipment_id,status,selected_rate_id,item_allocations),order_provider_links(id,provider,object_type,provider_object_id,metadata),order_financial_entries(source,entry_type,provider_object_id,amount,currency,recognition_state,metadata,created_at),shipstation_operation_attempts(operation_key,operation,order_shipment_id,provider_link_id,parent_provider_link_id,provider_object_id,status,result_summary,error_code,provider_succeeded_at,lease_expires_at,created_at)')
    .eq('id', id)
    .single();
  if (error) throw new ShipStationError(error.code === 'PGRST116' ? 'shipping_order_not_found' : 'shipping_database_failed');
  return data;
}

async function defaultListCarriers(env) {
  const payload = await shipStationRequest(env, '/carriers');
  return payloadList(payload, 'carriers');
}

function carrierSupportsMultiPackage(carrier, serviceCode = '') {
  const services = Array.isArray(carrier?.services) ? carrier.services : [];
  if (serviceCode) {
    return services.some((service) => text(service?.service_code, 100) === serviceCode
      && service?.is_multi_package_supported === true);
  }
  return carrier?.has_multi_package_supporting_services === true
    || services.some((service) => service?.is_multi_package_supported === true);
}

async function resolveCarrierSelection(env, listCarriers, requested = [], packageCount = 1) {
  const carriers = await listCarriers(env);
  const connectedIds = new Set(carriers.map((carrier) => text(carrier?.carrier_id, 100)).filter(Boolean));
  if (!connectedIds.size) throw new ShipStationError('shipstation_no_connected_carriers');
  const requestedIds = [...new Set((requested || []).map((value) => text(value, 100)).filter(Boolean))];
  if (requestedIds.some((carrierId) => !connectedIds.has(carrierId))) {
    throw new ShipStationError('shipstation_carrier_not_connected');
  }
  let carrierIds = requestedIds.length ? requestedIds : [...connectedIds];
  if (packageCount > 1) {
    const supported = new Set(carriers
      .filter((carrier) => carrierSupportsMultiPackage(carrier))
      .map((carrier) => text(carrier?.carrier_id, 100)));
    if (requestedIds.some((carrierId) => !supported.has(carrierId))) {
      throw new ShipStationError('shipstation_multi_package_unsupported');
    }
    carrierIds = carrierIds.filter((carrierId) => supported.has(carrierId));
    if (!carrierIds.length) throw new ShipStationError('shipstation_multi_package_unsupported');
  }
  return { carrierIds, carriers };
}

function safeRatesForPackages(payload, packages, carriers) {
  const rates = payloadList(payload, 'rates').map(safeRate).filter((rate) => rate.rate_id);
  if (packages.length <= 1) return rates;
  const byId = new Map(carriers.map((carrier) => [text(carrier?.carrier_id, 100), carrier]));
  return rates.filter((rate) => carrierSupportsMultiPackage(byId.get(rate.carrier_id), rate.service_code));
}

export function packagesFromOrderItems(order, variants, { maxPackages = 20 } = {}) {
  const profileBySku = new Map((variants || []).map((variant) => [text(variant?.vsku, 160), variant]));
  const packages = [];
  for (const item of order?.order_items || []) {
    const profile = profileBySku.get(text(item?.sku, 160));
    const weight = number(profile?.shipping_weight_lb);
    if (!weight || weight <= 0) throw new ShipStationError('shipping_package_profile_missing');
    const dimensions = [
      number(profile?.shipping_length_in),
      number(profile?.shipping_width_in),
      number(profile?.shipping_height_in),
    ];
    const populated = dimensions.filter((value) => value && value > 0).length;
    if (populated !== 0 && populated !== 3) throw new ShipStationError('shipping_package_profile_invalid');
    const qty = Math.max(1, Math.floor(number(item?.qty) || 1));
    if (packages.length + qty > maxPackages) throw new ShipStationError('too_many_shipping_packages');
    for (let index = 0; index < qty; index += 1) {
      packages.push({
        weight,
        unit: 'pound',
        ...(populated === 3 ? {
          length: dimensions[0],
          width: dimensions[1],
          height: dimensions[2],
        } : {}),
      });
    }
  }
  if (!packages.length) throw new ShipStationError('shipping_package_profile_missing');
  return packages;
}

// Fulfillment must derive cartons exactly the way checkout rated them. `maxPackages` is the
// pre-consolidation unit count (matching /api/shipping-rates); combinePackagesForRates then
// packs those units into the same ≤50 lb cartons the buyer was quoted on.
async function defaultLoadPackageProfiles(env, order) {
  const skus = [...new Set((order?.order_items || []).map((item) => text(item?.sku, 160)).filter(Boolean))];
  if (!skus.length) throw new ShipStationError('shipping_package_profile_missing');
  const { data, error } = await adminClient(env).from('product_variants')
    .select('vsku,shipping_weight_lb,shipping_length_in,shipping_width_in,shipping_height_in')
    .in('vsku', skus);
  if (error) throw new ShipStationError('shipping_database_failed');
  const units = packagesFromOrderItems(order, data || [], { maxPackages: 250 });
  return combinePackagesForRates(units);
}

// A persisted checkout plan describes the WHOLE order. A partial split ships a subset, so
// the plan no longer represents it and the packing must be recomputed for that subset.
function allocationCoversOrder(order, itemAllocations) {
  const allocated = new Map(itemAllocations.map((item) => [item.sku, item.quantity]));
  const ordered = new Map();
  for (const item of Array.isArray(order?.order_items) ? order.order_items : []) {
    const sku = text(item?.sku, 160);
    const quantity = Math.max(0, Math.floor(number(item?.qty) || 0));
    if (sku && quantity) ordered.set(sku, (ordered.get(sku) || 0) + quantity);
  }
  if (allocated.size !== ordered.size) return false;
  for (const [sku, quantity] of ordered) {
    if (allocated.get(sku) !== quantity) return false;
  }
  return true;
}

async function defaultQuoteRates(env, payload) {
  return shipStationRequest(env, '/rates', { method: 'POST', body: payload });
}

async function defaultPersistRate(env, id, patch) {
  const { error } = await adminClient(env).from('orders')
    .update({ ...patch, shipstation_updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new ShipStationError('shipping_database_failed');
}

function throwShipmentRpcError(error, fallback = 'shipping_database_failed') {
  const message = text(error?.message, 500).toLowerCase();
  if (/revision|stale/.test(message)) throw new ShipStationError('shipstation_shipment_revision_conflict', 409);
  if (message.includes('order_shipment_split_exists')) {
    throw new ShipStationError('shipstation_shipment_split_exists', 409);
  }
  if (message.includes('order_shipment_operation_locked')) {
    throw new ShipStationError('shipstation_shipment_operation_locked', 409);
  }
  if (message.includes('order_shipment_locked_by_label')) {
    throw new ShipStationError('shipstation_shipment_locked_by_label', 409);
  }
  if (message.includes('order_shipment_item_conservation_failed')) {
    throw new ShipStationError('shipstation_split_item_conservation_failed', 409);
  }
  if (message.includes('order_shipment_items_')) {
    throw new ShipStationError('shipstation_split_items_invalid');
  }
  throw new ShipStationError(fallback);
}

async function defaultClaimShipmentOperation(env, input) {
  const operationKey = shipStationOperationKey({
    operation: `shipment_${input.operation}`,
    orderId: input.orderId,
    orderShipmentId: input.orderShipmentId || null,
    revision: input.expectedRevision,
    discriminator: input.splitKey || 'default',
  });
  const requestFingerprint = await shipStationRequestFingerprint({
    operation: input.operation,
    split_key: input.splitKey || 'default',
    expected_revision: input.expectedRevision,
    package_hash: input.packageHash || null,
    pending_payload: input.pendingPayload || {},
  });
  const leaseOwner = operationLeaseOwner();
  const { data, error } = await adminClient(env).rpc('claim_order_shipment_operation_attempt', {
    p_order_id: input.orderId,
    p_order_shipment_id: input.orderShipmentId || null,
    p_split_key: input.splitKey || 'default',
    p_expected_revision: input.expectedRevision,
    p_operation: input.operation,
    p_package_hash: input.packageHash || null,
    p_pending_payload: input.pendingPayload || {},
    p_operation_key: operationKey,
    p_request_fingerprint: requestFingerprint,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120,
  });
  if (error) {
    throwShipmentRpcError(error);
  }
  if (data?.state === 'completed') return data;
  if (['provider_succeeded', 'reconcile_required'].includes(data?.state)) {
    throw new ShipStationError('shipstation_shipment_reconciliation_required', 409);
  }
  if (data?.claimed !== true) throw new ShipStationError('shipstation_shipment_operation_locked', 409);
  return {
    ...data,
    operation_key: text(data?.operation_key, 512) || operationKey,
    lease_owner: text(data?.lease_owner, 128) || leaseOwner,
  };
}

async function defaultMarkAttemptProviderSucceeded(env, input) {
  const { data, error } = await adminClient(env).rpc('mark_shipstation_operation_provider_succeeded', {
    p_operation_key: input.operationKey,
    p_lease_owner: input.leaseOwner,
    p_provider_object_id: input.providerObjectId || null,
    p_result_summary: input.resultSummary || {},
  });
  if (error || data?.state !== 'provider_succeeded') {
    throw new ShipStationError('shipstation_operation_evidence_failed');
  }
  return data;
}

async function defaultCompleteAttempt(env, input) {
  const { data, error } = await adminClient(env).rpc('complete_shipstation_operation_attempt', {
    p_operation_key: input.operationKey,
    p_lease_owner: input.leaseOwner,
    p_result_summary: input.resultSummary || {},
  });
  if (error || data?.state !== 'completed') {
    throw new ShipStationError('shipstation_operation_completion_failed');
  }
  return data;
}

async function defaultMarkAttemptReconcileRequired(env, input) {
  const { data, error } = await adminClient(env).rpc('mark_shipstation_operation_reconcile_required', {
    p_operation_key: input.operationKey,
    p_lease_owner: input.leaseOwner,
    p_error_code: text(input.errorCode || 'shipstation_operation_uncertain', 160),
  });
  if (error || data !== true) throw new ShipStationError('shipstation_operation_evidence_failed');
}

async function defaultReleaseAttempt(env, input) {
  const actorId = text(input.actorId, 80);
  const { data, error } = await adminClient(env).rpc('release_shipstation_operation_attempt', {
    p_operation_key: input.operationKey,
    p_lease_owner: input.leaseOwner,
    p_nonacceptance_evidence: input.evidence,
    p_reason: input.reason,
    p_actor_id: /^[0-9a-f-]{36}$/i.test(actorId) ? actorId : null,
    p_actor_email: text(input.actorEmail, 254) || null,
    p_error_code: text(input.errorCode, 160) || null,
  });
  if (error || data?.state !== 'released') {
    throw new ShipStationError('shipstation_operation_release_failed');
  }
  return data;
}

async function defaultClaimAttemptReconciliation(env, input) {
  const leaseOwner = operationLeaseOwner();
  const { data, error } = await adminClient(env).rpc('claim_shipstation_operation_reconciliation', {
    p_operation_key: input.operationKey,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120,
  });
  if (error) throw new ShipStationError('shipstation_operation_reconciliation_failed');
  if (data?.state !== 'claimed') throw new ShipStationError('shipstation_operation_reconciliation_locked', 409);
  return { ...data, operation_key: input.operationKey, lease_owner: leaseOwner };
}

function reconcilableAttempt(attempts, operation, predicate = () => true) {
  const candidates = (Array.isArray(attempts) ? attempts : []).filter((attempt) => (
    attempt?.operation === operation
    && ['provider_succeeded', 'reconcile_required'].includes(text(attempt?.status, 40))
    && predicate(attempt)
  ));
  if (candidates.length > 1) throw new ShipStationError('shipstation_operation_reconciliation_ambiguous', 409);
  return candidates[0] || null;
}

async function recordAttemptProviderSucceeded(mark, env, claim, providerObjectId, resultSummary) {
  const handle = attemptHandle(claim);
  if (!handle) return;
  await mark(env, { ...handle, providerObjectId, resultSummary });
}

async function completeAttempt(complete, env, claim, resultSummary) {
  const handle = attemptHandle(claim);
  if (!handle) return;
  await complete(env, { ...handle, resultSummary });
}

function shipmentAttemptSummary(result) {
  return {
    order_shipment_id: text(result?.order_shipment_id, 80) || null,
    shipment_id: text(result?.shipment_id, 100) || null,
    external_shipment_id: text(result?.external_shipment_id, 100) || null,
    split_key: text(result?.split_key, 40) || null,
    revision: Number.isSafeInteger(Number(result?.revision)) ? Number(result.revision) : null,
    status: text(result?.status, 40) || 'rated',
    package_hash: text(result?.package_hash, 64) || null,
    package_count: Array.isArray(result?.packages) ? result.packages.length : 0,
    rate_count: Array.isArray(result?.rates) ? result.rates.length : 0,
  };
}

async function recordAttemptFailure(lifecycle, env, claim, error, context, operation, providerAccepted = false) {
  const handle = attemptHandle(claim);
  if (!handle) return;
  const common = {
    ...handle,
    errorCode: error?.code || 'shipstation_request_failed',
  };
  if (!providerAccepted && providerFailureIsProvenRejection(error)) {
    await lifecycle.release(env, {
      ...common,
      evidence: 'provider_rejected',
      reason: `Provider rejected ${operation} before acceptance`,
      actorId: context?.user?.id,
      actorEmail: context?.user?.email,
    });
  } else {
    await lifecycle.reconcile(env, common);
  }
}

async function defaultFinalizeShipmentOperation(env, input) {
  const { data, error } = await adminClient(env).rpc('finalize_order_shipment_operation', {
    p_order_shipment_id: input.orderShipmentId,
    p_expected_revision: input.expectedRevision,
    p_provider_shipment_id: input.providerShipmentId || null,
    p_status: input.status,
    p_package_hash: input.packageHash || null,
    p_packages: input.packages || [],
    p_rates: input.rates || [],
    p_actor_id: input.actorId || null,
    p_actor_email: input.actorEmail || null,
    p_reason: input.reason || null,
  });
  if (error || data?.applied !== true) {
    if (error) throwShipmentRpcError(error);
    throw new ShipStationError('shipping_database_failed');
  }
  return data;
}

async function defaultFailShipmentOperation(env, input) {
  const rpc = input.reconcile === false
    ? 'release_order_shipment_operation'
    : 'fail_order_shipment_operation';
  const { data, error } = await adminClient(env).rpc(rpc, {
    p_order_shipment_id: input.orderShipmentId,
    p_expected_revision: input.expectedRevision,
    p_error_code: text(input.errorCode || 'shipstation_request_failed', 160),
  });
  if (error) throwShipmentRpcError(error);
  if (data !== true) throw new ShipStationError('shipstation_shipment_operation_locked', 409);
}

function shipmentFailureNeedsReconciliation(error, providerAccepted, operation) {
  if (providerAccepted) return true;
  const status = Number(error?.status || 0);
  if (operation === 'create' && status === 409) return true;
  return status < 400 || status >= 500 || status === 429;
}

async function recordShipmentFailure(
  failShipmentOperation, env, claim, error, providerAccepted, operation, orderShipmentId = null,
) {
  await failShipmentOperation(env, {
    orderShipmentId: orderShipmentId || rowId(claim.id),
    expectedRevision: Number(claim.revision),
    errorCode: error?.code || 'shipstation_request_failed',
    reconcile: shipmentFailureNeedsReconciliation(error, providerAccepted, operation),
  }).catch(() => {});
}

async function defaultLoadShipmentOperation(env, input) {
  let query = adminClient(env).from('order_shipments')
    .select('id,order_id,split_key,revision,provider_shipment_id,external_shipment_id,package_hash,status,operation,operation_state,pending_payload,selected_rate_id,shipstation_operation_attempts(operation_key,operation,provider_object_id,status,result_summary,error_code,provider_succeeded_at,lease_expires_at,created_at)')
    .eq('order_id', input.orderId);
  query = input.orderShipmentId
    ? query.eq('id', input.orderShipmentId)
    : query.eq('split_key', input.splitKey || 'default').order('revision', { ascending: false });
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw new ShipStationError('shipping_database_failed');
  if (!data) throw new ShipStationError('shipstation_order_shipment_not_found');
  return data;
}

async function defaultListOrderShipments(env, id) {
  const { data, error } = await adminClient(env).from('order_shipments')
    .select('id,split_key,generation,revision,provider_shipment_id,external_shipment_id,package_hash,status,operation,operation_state,selected_rate_id,item_allocations,error_code,updated_at,order_shipment_packages(sequence,package_code,weight_value,weight_unit,length_in,width_in,height_in,package_hash),order_shipment_rates(provider_rate_id,carrier_id,carrier_code,carrier_name,service_code,service_type,amount_minor,currency,currency_exponent,package_hash,delivery_days,estimated_delivery_at,selected,invalidated_at)')
    .eq('order_id', id)
    .order('split_key', { ascending: true });
  if (error) throw new ShipStationError('shipping_database_failed');
  return data || [];
}

async function defaultUpdateShipment(env, shipmentId, payload) {
  return shipStationRequest(env, '/shipments/' + encodeURIComponent(shipmentId), {
    method: 'PUT',
    body: payload,
  });
}

async function defaultCancelShipment(env, shipmentId) {
  return shipStationRequest(env, '/shipments/' + encodeURIComponent(shipmentId) + '/cancel', { method: 'PUT' });
}

async function defaultGetShipment(env, shipmentId) {
  return shipStationRequest(env, '/shipments/' + encodeURIComponent(shipmentId));
}

async function defaultGetShipmentByExternalId(env, id) {
  return shipStationRequest(env, '/shipments/external_shipment_id/' + encodeURIComponent(id));
}

async function defaultSelectShipmentRate(env, input) {
  const { data, error } = await adminClient(env).rpc('select_order_shipment_rate', {
    p_order_id: input.orderId,
    p_order_shipment_id: input.orderShipmentId,
    p_expected_revision: input.expectedRevision,
    p_rate_id: input.rateId,
  });
  if (error || data?.selected !== true) {
    if (error) throwShipmentRpcError(error, 'shipstation_rate_selection_invalid');
    throw new ShipStationError('shipstation_rate_selection_invalid');
  }
  return data;
}

async function defaultVerifySelectedRate(env, input) {
  const { data, error } = await adminClient(env).rpc('verify_order_shipment_rate', {
    p_order_id: input.orderId,
    p_order_shipment_id: input.orderShipmentId,
    p_expected_revision: input.expectedRevision,
    p_shipment_id: input.shipmentId,
    p_rate_id: input.rateId,
  });
  if (error) throw new ShipStationError('shipping_database_failed');
  if (data?.selected !== true) throw new ShipStationError('shipstation_rate_selection_invalid');
  return data;
}

async function defaultGetRate(env, rateId) {
  return shipStationRequest(env, `/rates/${encodeURIComponent(rateId)}`);
}

async function defaultGetLabel(env, labelId) {
  return shipStationRequest(env, `/labels/${encodeURIComponent(labelId)}`);
}

async function defaultListLabels(env, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  return shipStationRequest(env, `/labels?${params}`);
}

async function defaultFinalizeReconciliation(env, input) {
  const { data, error } = await adminClient(env).rpc('finalize_order_shipment_label_reconciliation', {
    p_order_id: input.orderId,
    p_order_shipment_id: input.orderShipmentId,
    p_shipment_id: input.shipmentId,
    p_label_id: input.labelId,
    p_rate_id: input.rateId || null,
    p_carrier_id: input.carrierId || null,
    p_service_code: input.serviceCode || null,
    p_label_url: input.labelUrl || null,
    p_cost: input.cost,
    p_currency: input.currency,
    p_label_status: input.labelStatus,
    p_carrier: input.carrier || null,
    p_tracking_number: input.trackingNumber || null,
    p_tracking_url: input.trackingUrl || null,
    p_actor_id: input.actorId || null,
    p_actor_email: input.actorEmail || null,
    p_reason: input.reason,
  });
  if (error || data?.applied !== true) throw new ShipStationError('shipping_database_failed');
  return data;
}

async function defaultFetchDocument(url, options) {
  return fetch(url, options);
}

async function defaultClaimLabel(env, input) {
  const operationKey = shipStationOperationKey({
    operation: 'label_purchase', orderId: input.orderId,
    orderShipmentId: input.orderShipmentId, revision: input.expectedRevision,
    discriminator: input.rateId,
  });
  const requestFingerprint = await shipStationRequestFingerprint({
    order_shipment_id: input.orderShipmentId,
    expected_revision: input.expectedRevision,
    rate_id: input.rateId,
  });
  const leaseOwner = operationLeaseOwner();
  const { data, error } = await adminClient(env).rpc('claim_order_shipment_label_purchase_attempt', {
    p_order_id: input.orderId,
    p_order_shipment_id: input.orderShipmentId,
    p_expected_revision: input.expectedRevision,
    p_rate_id: input.rateId,
    p_operation_key: operationKey,
    p_request_fingerprint: requestFingerprint,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120,
  });
  if (error) throw new ShipStationError('shipping_database_failed');
  return {
    ...data,
    operation_key: text(data?.operation_key, 512) || operationKey,
    lease_owner: text(data?.lease_owner, 128) || leaseOwner,
  };
}

async function defaultPurchaseLabel(env, rateId, body) {
  return shipStationRequest(env, `/labels/rates/${encodeURIComponent(rateId)}`, {
    method: 'POST',
    body,
  });
}

async function defaultClaimVoid(env, id, labelId) {
  const operationKey = shipStationOperationKey({
    operation: 'label_void', orderId: id, discriminator: labelId,
  });
  const requestFingerprint = await shipStationRequestFingerprint({ label_id: labelId });
  const leaseOwner = operationLeaseOwner();
  const { data, error } = await adminClient(env).rpc('claim_shipstation_label_void_attempt', {
    p_order_id: id,
    p_label_id: labelId,
    p_operation_key: operationKey,
    p_request_fingerprint: requestFingerprint,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120,
  });
  if (error) throw new ShipStationError('shipping_database_failed');
  return { ...data, operation_key: operationKey, lease_owner: leaseOwner };
}

async function defaultVoidLabel(env, labelId) {
  try {
    return await shipStationRequest(env, `/labels/${encodeURIComponent(labelId)}/void`, { method: 'PUT' });
  } catch (error) {
    if (error instanceof ShipStationError) throw error;
    throw new ShipStationError('shipstation_network_failed', 503);
  }
}

async function defaultFinalizeVoid(env, input) {
  const { data, error } = await adminClient(env).rpc('finalize_shipstation_label_void', {
    p_order_id: input.orderId,
    p_label_id: input.labelId,
    p_actor_id: input.actorId || null,
    p_reason: input.reason,
    p_provider_message: input.providerMessage || null,
  });
  if (error || data?.applied !== true) throw new ShipStationError('shipping_database_failed');
  return data;
}

async function defaultFinalizeVoidReconciliation(env, input) {
  const { data, error } = await adminClient(env).rpc('finalize_shipstation_label_void_reconciliation', {
    p_order_id: input.orderId,
    p_label_id: input.labelId,
    p_actor_id: input.actorId || null,
    p_reason: input.reason,
    p_provider_message: input.providerMessage || null,
  });
  if (error || data?.applied !== true) throw new ShipStationError('shipping_database_failed');
  return data;
}

async function defaultClaimReturn(env, id, labelId) {
  const operationKey = shipStationOperationKey({
    operation: 'label_return', orderId: id, discriminator: labelId,
  });
  const requestFingerprint = await shipStationRequestFingerprint({
    outbound_label_id: labelId,
    charge_event: 'carrier_default',
    label_layout: '4x6',
    label_format: 'pdf',
  });
  const leaseOwner = operationLeaseOwner();
  const { data, error } = await adminClient(env).rpc('claim_shipstation_return_label_attempt', {
    p_order_id: id,
    p_outbound_label_id: labelId,
    p_operation_key: operationKey,
    p_request_fingerprint: requestFingerprint,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120,
  });
  if (error) throw new ShipStationError('shipping_database_failed');
  return { ...data, operation_key: operationKey, lease_owner: leaseOwner };
}

async function defaultCreateReturn(env, labelId, body) {
  return shipStationRequest(env, `/labels/${encodeURIComponent(labelId)}/return`, {
    method: 'POST',
    body,
  });
}

async function defaultFinalizeReturn(env, input) {
  const { data, error } = await adminClient(env).rpc('finalize_shipstation_return_label', {
    p_order_id: input.orderId,
    p_outbound_label_id: input.outboundLabelId,
    p_return_label_id: input.returnLabelId,
    p_cost: input.cost,
    p_currency: input.currency,
    p_charge_event: input.chargeEvent,
    p_tracking_number: input.trackingNumber || null,
    p_reason: input.reason,
  });
  if (error || data?.applied !== true) throw new ShipStationError('shipping_database_failed');
  return data;
}

async function defaultFinalizeReturnReconciliation(env, input) {
  const { data, error } = await adminClient(env).rpc('finalize_shipstation_return_label_reconciliation', {
    p_order_id: input.orderId,
    p_outbound_label_id: input.outboundLabelId,
    p_return_label_id: input.returnLabelId,
    p_cost: input.cost,
    p_currency: input.currency,
    p_charge_event: input.chargeEvent,
    p_tracking_number: input.trackingNumber || null,
    p_reason: input.reason,
  });
  if (error || data?.applied !== true) throw new ShipStationError('shipping_database_failed');
  return data;
}

async function defaultPersistLabel(env, id, patch) {
  const { error } = await adminClient(env).from('orders')
    .update({ ...patch, shipstation_updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new ShipStationError('shipping_database_failed');
}

async function defaultPersistReturn(env, id, patch) {
  const { error } = await adminClient(env).from('orders')
    .update({ ...patch, shipstation_return_updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new ShipStationError('shipping_database_failed');
}

async function defaultInsertShipmentEvent(env, id, patch) {
  const { error } = await adminClient(env).from('shipment_events').insert({ order_id: id, ...patch });
  if (error) throw new ShipStationError('shipping_database_failed');
}

async function defaultAudit(env, context, action, id, detail) {
  await recordAudit(adminClient(env), {
    user: context?.user,
    action,
    targetType: 'order',
    targetId: id,
    detail,
  });
}

async function defaultLinkProviderObject(env, input) {
  return linkOrderProviderObject(adminClient(env), input);
}

async function defaultRecordFinancialEntry(env, entry) {
  try {
    await recordOrderFinancialEntry(env, entry);
  } catch {
    throw new ShipStationError('shipping_database_failed');
  }
}

async function linkShipStationObject(link, env, order, objectType, providerObjectId, metadata = {}) {
  if (!text(providerObjectId, 255)) return null;
  return link(env, {
    orderId: order.id,
    provider: 'shipstation',
    objectType,
    providerObjectId,
    metadata: { order_number: order.order_number || null, ...metadata },
  });
}

function assertShippable(order) {
  if (!order) throw new ShipStationError('shipping_order_not_found');
  if (!SHIPPABLE_STATUSES.has(text(order.status, 40))) {
    throw new ShipStationError('shipping_order_not_shippable');
  }
}

async function recordPostagePurchase(recordFinancialEntry, env, order, input) {
  const cost = money(input.cost);
  if (cost == null || cost < 0) return;
  await recordFinancialEntry(env, {
    orderId: order.id,
    source: 'shipstation',
    entryType: 'postage_purchase',
    providerObjectId: input.labelId,
    amount: cost,
    currency: text(input.currency || order.currency || 'usd', 8).toLowerCase(),
    state: 'recognized',
    actorId: text(input.actorId, 80) || null,
    reason: null,
    metadata: {
      order_shipment_id: text(input.orderShipmentId, 80) || null,
      shipment_id: text(input.shipmentId, 100) || null,
      rate_id: text(input.rateId, 100) || null,
    },
  });
}

function returnRecognitionState(chargeEvent) {
  return text(chargeEvent, 40).toLowerCase() === 'on_creation' ? 'recognized' : 'pending';
}

async function recordReturnPostage(recordFinancialEntry, env, order, input) {
  const cost = money(input.cost);
  if (cost == null || cost < 0) return;
  await recordFinancialEntry(env, {
    orderId: order.id,
    source: 'shipstation',
    entryType: 'postage_return_label',
    providerObjectId: input.returnLabelId,
    amount: cost,
    currency: text(input.currency || order.currency || 'usd', 8).toLowerCase(),
    state: returnRecognitionState(input.chargeEvent),
    actorId: text(input.actorId, 80) || null,
    reason: text(input.reason, 280) || null,
    metadata: {
      outbound_label_id: text(input.outboundLabelId, 100),
      order_shipment_id: text(input.orderShipmentId, 80) || null,
      charge_event: text(input.chargeEvent, 40).toLowerCase(),
    },
  });
}

function existingReturnLabel(order, outboundLabelId) {
  const existing = shipmentLabelOwnership(order).returns.find((entry) => (
    entry.parent_label_id === outboundLabelId && entry.active
  ));
  const chargeEvent = text(existing?.charge_event, 40).toLowerCase() || 'carrier_default';
  return {
    already_created: true,
    label_id: text(existing?.label_id, 100),
    outbound_label_id: text(existing?.parent_label_id, 100),
    order_shipment_id: text(existing?.order_shipment_id, 80) || null,
    status: text(existing?.status, 80) || 'return_label_created',
    tracking_number: text(existing?.tracking_number, 160) || null,
    cost: existing?.cost ?? null,
    currency: text(existing?.currency || order?.currency || 'usd', 8).toLowerCase(),
    charge_event: chargeEvent,
    recognition_state: returnRecognitionState(chargeEvent),
  };
}

function safeLabel(label) {
  const downloads = label?.label_download && typeof label.label_download === 'object'
    ? label.label_download
    : {};
  return {
    label_id: text(label?.label_id, 100),
    shipment_id: text(label?.shipment_id, 100) || null,
    status: text(label?.status || label?.label_status, 80).toLowerCase() || null,
    is_return_label: label?.is_return_label === true,
    outbound_label_id: text(label?.outbound_label_id, 100) || null,
    voided: label?.voided === true,
    tracking_number: text(label?.tracking_number, 160) || null,
    carrier_code: text(label?.carrier_code || label?.carrier_id, 120) || null,
    service_code: text(label?.service_code, 100) || null,
    label_format: text(label?.label_format, 12).toLowerCase() || null,
    available_formats: [...LABEL_FORMATS].filter((format) => text(downloads?.[format], 2000)),
    cost: money(label?.shipment_cost),
    currency: text(label?.shipment_cost?.currency, 8).toLowerCase() || null,
    charge_event: text(label?.charge_event, 40).toLowerCase() || null,
    created_at: text(label?.created_at, 80) || null,
  };
}

function assertOrderLabel(order, labelId) {
  if (!order) throw new ShipStationError('shipping_order_not_found');
  const owned = resolveShipmentLabel(order, labelId);
  if (owned) return owned.kind;
  throw new ShipStationError('shipstation_label_order_mismatch');
}

function validDocumentUrl(value) {
  let url;
  try {
    url = new URL(text(value, 2000));
  } catch {
    throw new ShipStationError('shipstation_label_document_url_invalid');
  }
  const allowed = url.protocol === 'https:'
    && !url.username
    && !url.password
    && !url.port
    && LABEL_DOWNLOAD_PREFIXES.some(([hostname, prefix]) => url.hostname === hostname && url.pathname.startsWith(prefix));
  if (!allowed) throw new ShipStationError('shipstation_label_document_url_invalid');
  return url;
}

function documentContentType(format, value) {
  const type = text(value, 120).toLowerCase().split(';', 1)[0];
  const allowed = format === 'pdf'
    ? new Set(['application/pdf'])
    : format === 'png'
      ? new Set(['image/png'])
      : new Set(['application/zpl', 'text/plain', 'application/octet-stream']);
  if (!allowed.has(type)) throw new ShipStationError('shipstation_label_document_type_invalid');
  return type;
}

async function readLabelDocument(response, format, signal) {
  if (!response.ok) throw new ShipStationError('shipstation_label_document_fetch_failed', response.status);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > LABEL_DOCUMENT_MAX_BYTES) {
    throw new ShipStationError('shipstation_label_document_too_large');
  }
  const contentType = documentContentType(format, response.headers.get('content-type'));
  if (!response.body?.getReader) throw new ShipStationError('shipstation_label_document_body_invalid');
  const reader = response.body.getReader();
  const cancel = () => reader.cancel(signal?.reason || 'cancelled').catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
      total += chunk.byteLength;
      if (total > LABEL_DOCUMENT_MAX_BYTES) {
        await reader.cancel('shipstation_label_document_too_large').catch(() => {});
        throw new ShipStationError('shipstation_label_document_too_large');
      }
      chunks.push(chunk);
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, contentType };
}

async function fetchLabelDocument(url, format, fetchDocument, timeoutMs = 12_000) {
  const current = validDocumentUrl(url);
  try {
    return await fetchWithDeadline(async (requestUrl, options) => {
      let active = validDocumentUrl(requestUrl);
      let response = await fetchDocument(active.href, {
        ...options,
        method: 'GET',
        redirect: 'manual',
        headers: { accept: format === 'pdf' ? 'application/pdf' : format === 'png' ? 'image/png' : 'application/zpl' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new ShipStationError('shipstation_label_document_redirect_invalid');
        active = validDocumentUrl(new URL(location, active).href);
        response = await fetchDocument(active.href, {
          ...options,
          method: 'GET',
          redirect: 'manual',
          headers: { accept: format === 'pdf' ? 'application/pdf' : format === 'png' ? 'image/png' : 'application/zpl' },
        });
      }
      if (response.status >= 300 && response.status < 400) {
        throw new ShipStationError('shipstation_label_document_redirect_invalid');
      }
      return response;
    }, current.href, {}, {
      timeoutMs,
      timeoutCode: 'shipstation_label_document_timeout',
      consumeResponse: (response, signal) => readLabelDocument(response, format, signal),
    });
  } catch (error) {
    if (error instanceof ProviderTimeoutError) {
      throw new ShipStationError('shipstation_label_document_timeout', 503);
    }
    throw error;
  }
}

async function resolveOrderLabel(env, input, dependencies = {}) {
  const id = orderId(input?.order_id);
  const labelId = providerId(input?.label_id, 'shipstation_label_required');
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');
  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const getLabel = dependencies.getLabel || defaultGetLabel;
  const order = await loadOrder(env, id);
  const kind = assertOrderLabel(order, labelId);
  const provider = await getLabel(env, labelId);
  if (text(provider?.label_id, 100) !== labelId) throw new ShipStationError('shipstation_label_response_invalid');
  if ((kind === 'return') !== (provider?.is_return_label === true)) {
    throw new ShipStationError('shipstation_label_order_mismatch');
  }
  return { provider, safe: safeLabel(provider) };
}

export async function getOrderLabel(env, input, _context = {}, dependencies = {}) {
  const { safe } = await resolveOrderLabel(env, input, dependencies);
  return safe;
}

export async function listOrderShipments(env, input, _context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  const listShipments = dependencies.listOrderShipments || defaultListOrderShipments;
  return { order_id: id, shipments: await listShipments(env, id) };
}

export async function downloadOrderLabel(env, input, _context = {}, dependencies = {}) {
  const format = text(input?.format || 'pdf', 12).toLowerCase();
  if (!LABEL_FORMATS.has(format)) throw new ShipStationError('shipstation_label_document_format_invalid');
  const { provider, safe: label } = await resolveOrderLabel(env, input, dependencies);
  const source = provider?.label_download?.[format];
  if (!source) throw new ShipStationError('shipstation_label_document_unavailable');
  const fetchDocument = dependencies.fetchDocument || defaultFetchDocument;
  const document = await fetchLabelDocument(source, format, fetchDocument, dependencies.documentTimeoutMs);
  const order = await (dependencies.loadOrder || defaultLoadOrder)(env, orderId(input?.order_id));
  const reference = text(order?.order_number || order?.id, 80).replace(/[^A-Za-z0-9_-]+/g, '-');
  const filename = `${reference}-label-${label.label_id}.${format}`;
  return new Response(document.bytes, {
    status: 200,
    headers: {
      'content-type': document.contentType,
      'content-length': String(document.bytes.byteLength),
      'content-disposition': `${format === 'zpl' ? 'attachment' : 'inline'}; filename="${filename}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function prepareShipment(env, input, order, listCarriers, loadPackageProfiles) {
  const orderSplitKey = splitKey(input?.split_key);
  const itemAllocations = normalizeSplitItems(order, input?.split_items, orderSplitKey);
  const shipmentOrder = {
    ...order,
    order_items: allocatedOrderItems(order, itemAllocations),
  };
  const manualPackages = Array.isArray(input?.packages) && input.packages.length > 0;
  const manualSplit = orderSplitKey !== 'default'
    || (Array.isArray(input?.split_items) && input.split_items.length > 0);
  if (text(order?.shipstation_error, 160) === 'shipping_package_plan_review_required'
      && !manualPackages && !manualSplit) {
    throw new ShipStationError('shipping_package_plan_review_required', 409);
  }
  // Replay the carton plan the buyer was rated on whenever this shipment covers the whole
  // order. Recomputing instead would be a second independent guess at the packing, and any
  // drift means MASEST buys a shipment the buyer did not pay for.
  const quotedPlan = manualPackages || !allocationCoversOrder(order, itemAllocations)
    ? null
    : normalizePackagePlan(order?.shipping_package_plan);
  const packagesSource = manualPackages ? 'manual' : quotedPlan ? 'checkout_quote' : 'catalog';
  const sourcePackages = manualPackages
    ? input.packages
    : quotedPlan || await loadPackageProfiles(env, shipmentOrder);
  const packages = normalizePackages(sourcePackages);
  const { carrierIds, carriers } = await resolveCarrierSelection(
    env, listCarriers, input?.carrier_ids, packages.length,
  );
  const packageHash = await stablePackageHash(packages);
  const pendingPayload = {
    packages,
    items: itemAllocations,
    carrier_ids: carrierIds,
    phone: text(input?.phone, 40),
    residential: text(input?.residential, 12),
  };
  return {
    orderSplitKey,
    shipmentOrder,
    manualPackages,
    packagesSource,
    packages,
    carrierIds,
    carriers,
    packageHash,
    pendingPayload,
  };
}

// Flag the rate matching the service the buyer selected at checkout so the operator buys
// what was paid for instead of re-shopping blind, and so a forced divergence is deliberate.
function markPaidService(rates, order) {
  const paidCarrier = text(order?.paid_shipping_carrier_id, 100).toLowerCase();
  const paidService = text(order?.paid_shipping_service_code, 100).toLowerCase();
  if (!paidService && !paidCarrier) return { rates, paidRateId: null };
  let paidRateId = null;
  const marked = (rates || []).map((rate) => {
    const isPaid = Boolean(paidService)
      && text(rate?.service_code, 100).toLowerCase() === paidService
      && (!paidCarrier || text(rate?.carrier_id, 100).toLowerCase() === paidCarrier);
    if (isPaid && !paidRateId) paidRateId = rate.rate_id || null;
    return { ...rate, paid_service: isPaid };
  });
  return { rates: marked, paidRateId };
}

export async function rateOrderShipment(env, input, context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');
  const warehouseId = configuredWarehouseId(env);

  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const listCarriers = dependencies.listCarriers || defaultListCarriers;
  const loadPackageProfiles = dependencies.loadPackageProfiles || defaultLoadPackageProfiles;
  const quoteRates = dependencies.quoteRates || defaultQuoteRates;
  const claimShipmentOperation = dependencies.claimShipmentOperation || defaultClaimShipmentOperation;
  const finalizeShipmentOperation = dependencies.finalizeShipmentOperation || defaultFinalizeShipmentOperation;
  const failShipmentOperation = dependencies.failShipmentOperation || defaultFailShipmentOperation;
  const markAttemptProviderSucceeded = dependencies.markAttemptProviderSucceeded || defaultMarkAttemptProviderSucceeded;
  const completeOperationAttempt = dependencies.completeOperationAttempt || defaultCompleteAttempt;
  const attemptLifecycle = {
    reconcile: dependencies.markAttemptReconcileRequired || defaultMarkAttemptReconcileRequired,
    release: dependencies.releaseOperationAttempt || defaultReleaseAttempt,
  };
  const order = await loadOrder(env, id);
  assertShippable(order);

  const revision = input?.expected_revision == null ? 0 : expectedRevision(input.expected_revision);
  const {
    orderSplitKey, shipmentOrder, packagesSource, packages, carrierIds, carriers, packageHash, pendingPayload,
  } = await prepareShipment(env, input, order, listCarriers, loadPackageProfiles);
  const payload = buildRateRequest({
    order: shipmentOrder,
    packages,
    warehouseId,
    carrierIds,
    phone: pendingPayload.phone,
    residential: pendingPayload.residential,
  });
  const claim = await claimShipmentOperation(env, {
    orderId: id,
    splitKey: orderSplitKey,
    expectedRevision: revision,
    operation: 'create',
    packageHash,
    pendingPayload,
  });
  if (claim?.state === 'completed') return claim.result_summary || {};
  const providerExternalShipmentId = externalShipmentId(claim?.external_shipment_id);
  payload.shipment.external_shipment_id = providerExternalShipmentId;

  let response;
  let rates;
  let shipmentId;
  let finalized;
  let providerAccepted = false;
  try {
    const provider = await quoteRates(env, payload);
    providerAccepted = true;
    await recordAttemptProviderSucceeded(
      markAttemptProviderSucceeded,
      env,
      claim,
      text(provider?.rate_response?.shipment_id || provider?.shipment_id, 100) || null,
      {
        shipment_id: text(provider?.rate_response?.shipment_id || provider?.shipment_id, 100) || null,
        external_shipment_id: providerExternalShipmentId,
      },
    );
    response = provider?.rate_response || provider || {};
    rates = markPaidService(safeRatesForPackages(response, packages, carriers), order).rates;
    shipmentId = text(response?.shipment_id || rates[0]?.shipment_id, 100);
    if (!shipmentId) throw new ShipStationError('shipstation_rate_response_invalid');
    finalized = await finalizeShipmentOperation(env, {
      orderShipmentId: rowId(claim.id),
      expectedRevision: Number(claim.revision),
      providerShipmentId: shipmentId,
      status: 'rated',
      packageHash,
      packages,
      rates,
      actorId: context?.user?.id,
      actorEmail: context?.user?.email,
      reason: 'Shipment created and rated',
    });
  } catch (error) {
    await recordAttemptFailure(
      attemptLifecycle, env, claim, error, context, 'shipment create', providerAccepted,
    ).catch(() => {});
    await recordShipmentFailure(failShipmentOperation, env, claim, error, providerAccepted, 'create');
    throw error;
  }
  const result = {
    order_shipment_id: claim.id,
    shipment_id: shipmentId,
    external_shipment_id: providerExternalShipmentId,
    split_key: orderSplitKey,
    revision: Number(finalized?.revision ?? claim.revision),
    package_hash: packageHash,
    rates,
    packages,
    packages_source: packagesSource,
    paid_service: {
      carrier_id: text(order?.paid_shipping_carrier_id, 100) || null,
      service_code: text(order?.paid_shipping_service_code, 100) || null,
      matched: rates.some((rate) => rate.paid_service === true),
    },
  };
  await completeAttempt(completeOperationAttempt, env, claim, shipmentAttemptSummary(result));
  return result;
}

function assertShipmentMutable(order, orderShipmentId) {
  const activeForShipment = shipmentLabelOwnership(order).outbound.some((label) => (
    label.active && label.order_shipment_id === orderShipmentId
  ));
  const unresolvedAttempt = (Array.isArray(order?.shipstation_operation_attempts)
    ? order.shipstation_operation_attempts
    : []).some((attempt) => (
    text(attempt?.order_shipment_id, 80) === orderShipmentId
    && ['label_purchase', 'label_void'].includes(text(attempt?.operation, 40))
    && ['claimed', 'provider_succeeded', 'reconcile_required'].includes(text(attempt?.status, 40))
  ));
  if (activeForShipment || unresolvedAttempt) {
    throw new ShipStationError('shipstation_shipment_locked_by_label', 409);
  }
}

function shipmentPayload(order, packages, warehouseId, input) {
  return buildRateRequest({
    order,
    packages,
    warehouseId,
    carrierIds: ['internal-not-sent'],
    phone: text(input?.phone, 40),
    residential: text(input?.residential, 12),
  }).shipment;
}

export async function updateOrderShipment(env, input, context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  const orderShipmentId = rowId(input?.order_shipment_id);
  const revision = expectedRevision(input?.expected_revision);
  const operationReason = reason(input?.reason);
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');
  const warehouseId = configuredWarehouseId(env);

  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const listCarriers = dependencies.listCarriers || defaultListCarriers;
  const loadPackageProfiles = dependencies.loadPackageProfiles || defaultLoadPackageProfiles;
  const claimShipmentOperation = dependencies.claimShipmentOperation || defaultClaimShipmentOperation;
  const updateShipment = dependencies.updateShipment || defaultUpdateShipment;
  const quoteRates = dependencies.quoteRates || defaultQuoteRates;
  const finalizeShipmentOperation = dependencies.finalizeShipmentOperation || defaultFinalizeShipmentOperation;
  const failShipmentOperation = dependencies.failShipmentOperation || defaultFailShipmentOperation;
  const markAttemptProviderSucceeded = dependencies.markAttemptProviderSucceeded || defaultMarkAttemptProviderSucceeded;
  const completeOperationAttempt = dependencies.completeOperationAttempt || defaultCompleteAttempt;
  const attemptLifecycle = {
    reconcile: dependencies.markAttemptReconcileRequired || defaultMarkAttemptReconcileRequired,
    release: dependencies.releaseOperationAttempt || defaultReleaseAttempt,
  };
  const order = await loadOrder(env, id);
  assertShippable(order);
  assertShipmentMutable(order, orderShipmentId);

  const {
    orderSplitKey, shipmentOrder, packages, carrierIds, carriers, packageHash, pendingPayload,
  } = await prepareShipment(env, input, order, listCarriers, loadPackageProfiles);
  const claim = await claimShipmentOperation(env, {
    orderId: id,
    orderShipmentId,
    splitKey: orderSplitKey,
    expectedRevision: revision,
    operation: 'update',
    packageHash,
    pendingPayload,
  });
  if (claim?.state === 'completed') return claim.result_summary || {};
  const providerShipmentId = providerId(claim?.provider_shipment_id, 'shipstation_shipment_required');
  const payload = shipmentPayload(shipmentOrder, packages, warehouseId, input);
  let finalized;
  let rates;
  let providerAccepted = false;
  try {
    const provider = await updateShipment(env, providerShipmentId, payload);
    providerAccepted = true;
    await recordAttemptProviderSucceeded(
      markAttemptProviderSucceeded, env, claim, providerShipmentId,
      { shipment_id: text(provider?.shipment_id || providerShipmentId, 100) },
    );
    const responseId = text(provider?.shipment_id || providerShipmentId, 100);
    if (responseId !== providerShipmentId) throw new ShipStationError('shipstation_shipment_response_invalid');
    const quoted = await quoteRates(env, {
      shipment_id: providerShipmentId,
      rate_options: { carrier_ids: carrierIds },
    });
    const rateResponse = quoted?.rate_response || quoted || {};
    rates = safeRatesForPackages(rateResponse, packages, carriers);
    finalized = await finalizeShipmentOperation(env, {
      orderShipmentId,
      expectedRevision: Number(claim.revision),
      providerShipmentId,
      status: 'rated',
      packageHash,
      packages,
      rates,
      actorId: context?.user?.id,
      actorEmail: context?.user?.email,
      reason: operationReason,
    });
  } catch (error) {
    await recordAttemptFailure(
      attemptLifecycle, env, claim, error, context, 'shipment update', providerAccepted,
    ).catch(() => {});
    await recordShipmentFailure(
      failShipmentOperation, env, claim, error, providerAccepted, 'update', orderShipmentId,
    );
    throw error;
  }
  const result = {
    order_shipment_id: orderShipmentId,
    shipment_id: providerShipmentId,
    revision: finalized.revision,
    status: finalized.status || 'rated',
    package_hash: packageHash,
    packages,
    rates,
  };
  await completeAttempt(completeOperationAttempt, env, claim, shipmentAttemptSummary(result));
  return result;
}

export async function cancelOrderShipment(env, input, context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  const orderShipmentId = rowId(input?.order_shipment_id);
  const revision = expectedRevision(input?.expected_revision);
  if (input?.confirm !== true) throw new ShipStationError('shipstation_confirmation_required');
  const operationReason = reason(input?.reason);
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');

  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const claimShipmentOperation = dependencies.claimShipmentOperation || defaultClaimShipmentOperation;
  const cancelShipment = dependencies.cancelShipment || defaultCancelShipment;
  const finalizeShipmentOperation = dependencies.finalizeShipmentOperation || defaultFinalizeShipmentOperation;
  const failShipmentOperation = dependencies.failShipmentOperation || defaultFailShipmentOperation;
  const markAttemptProviderSucceeded = dependencies.markAttemptProviderSucceeded || defaultMarkAttemptProviderSucceeded;
  const completeOperationAttempt = dependencies.completeOperationAttempt || defaultCompleteAttempt;
  const attemptLifecycle = {
    reconcile: dependencies.markAttemptReconcileRequired || defaultMarkAttemptReconcileRequired,
    release: dependencies.releaseOperationAttempt || defaultReleaseAttempt,
  };
  const order = await loadOrder(env, id);
  assertShippable(order);
  assertShipmentMutable(order, orderShipmentId);
  const claim = await claimShipmentOperation(env, {
    orderId: id,
    orderShipmentId,
    splitKey: splitKey(input?.split_key),
    expectedRevision: revision,
    operation: 'cancel',
    pendingPayload: {},
  });
  if (claim?.state === 'completed') return claim.result_summary || {};
  const providerShipmentId = providerId(claim?.provider_shipment_id, 'shipstation_shipment_required');
  let finalized;
  let providerAccepted = false;
  try {
    const provider = await cancelShipment(env, providerShipmentId);
    if (provider?.approved === false) {
      throw new ShipStationError('shipstation_shipment_cancel_rejected', 422);
    }
    providerAccepted = true;
    await recordAttemptProviderSucceeded(
      markAttemptProviderSucceeded, env, claim, providerShipmentId,
      { shipment_id: providerShipmentId, cancelled: true },
    );
    finalized = await finalizeShipmentOperation(env, {
      orderShipmentId,
      expectedRevision: Number(claim.revision),
      providerShipmentId,
      status: 'cancelled',
      packages: [],
      rates: [],
      actorId: context?.user?.id,
      actorEmail: context?.user?.email,
      reason: operationReason,
    });
  } catch (error) {
    await recordAttemptFailure(
      attemptLifecycle, env, claim, error, context, 'shipment cancel', providerAccepted,
    ).catch(() => {});
    await recordShipmentFailure(
      failShipmentOperation, env, claim, error, providerAccepted, 'cancel', orderShipmentId,
    );
    throw error;
  }
  const result = {
    order_shipment_id: orderShipmentId,
    shipment_id: providerShipmentId,
    revision: finalized.revision,
    status: 'cancelled',
  };
  await completeAttempt(completeOperationAttempt, env, claim, result);
  return result;
}

export async function selectOrderShipmentRate(env, input, _context = {}, dependencies = {}) {
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');
  const selectShipmentRate = dependencies.selectShipmentRate || defaultSelectShipmentRate;
  return selectShipmentRate(env, {
    orderId: orderId(input?.order_id),
    orderShipmentId: rowId(input?.order_shipment_id),
    expectedRevision: expectedRevision(input?.expected_revision),
    rateId: providerId(input?.rate_id, 'shipstation_rate_required'),
  });
}

function providerShipmentPackages(provider, fallback = []) {
  const raw = Array.isArray(provider?.packages) && provider.packages.length ? provider.packages : fallback;
  return normalizePackages(raw);
}

export async function reconcileOrderShipment(env, input, context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  const orderShipmentId = rowId(input?.order_shipment_id);
  if (input?.confirm !== true) throw new ShipStationError('shipstation_confirmation_required');
  const operationReason = reason(input?.reason);
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');
  const loadShipmentOperation = dependencies.loadShipmentOperation || defaultLoadShipmentOperation;
  const getShipment = dependencies.getShipment || defaultGetShipment;
  const getShipmentByExternalId = dependencies.getShipmentByExternalId || defaultGetShipmentByExternalId;
  const listCarriers = dependencies.listCarriers || defaultListCarriers;
  const quoteRates = dependencies.quoteRates || defaultQuoteRates;
  const finalizeShipmentOperation = dependencies.finalizeShipmentOperation || defaultFinalizeShipmentOperation;
  const claimAttemptReconciliation = dependencies.claimAttemptReconciliation || defaultClaimAttemptReconciliation;
  const completeOperationAttempt = dependencies.completeOperationAttempt || defaultCompleteAttempt;
  const audit = dependencies.audit || defaultAudit;
  const state = await loadShipmentOperation(env, { orderId: id, orderShipmentId });
  const shipmentAttempts = (Array.isArray(state.shipstation_operation_attempts)
    ? state.shipstation_operation_attempts
    : []).filter((attempt) => (
    ['shipment_create', 'shipment_update', 'shipment_cancel'].includes(text(attempt?.operation, 40))
    && ['provider_succeeded', 'reconcile_required'].includes(text(attempt?.status, 40))
  ));
  if (shipmentAttempts.length > 1) {
    throw new ShipStationError('shipstation_operation_reconciliation_ambiguous', 409);
  }
  const durableAttempt = shipmentAttempts[0] || null;
  if (state.operation_state !== 'reconcile_required') {
    const attemptOperation = text(durableAttempt?.operation, 40);
    const expectedStatus = attemptOperation === 'shipment_cancel' ? 'cancelled' : 'rated';
    const expectedProviderId = text(
      durableAttempt?.provider_object_id || durableAttempt?.result_summary?.shipment_id,
      100,
    );
    if (state.operation_state !== 'idle'
        || durableAttempt?.status !== 'provider_succeeded'
        || !expectedProviderId
        || expectedProviderId !== text(state.provider_shipment_id, 100)
        || text(state.status, 40) !== expectedStatus) {
      throw new ShipStationError('shipstation_shipment_reconciliation_not_required');
    }
    const completedClaim = await claimAttemptReconciliation(env, {
      operationKey: durableAttempt.operation_key,
    });
    const completedResult = {
      reconciled: true,
      already_finalized: true,
      order_shipment_id: orderShipmentId,
      shipment_id: expectedProviderId,
      revision: Number(state.revision),
      status: expectedStatus,
    };
    await completeAttempt(completeOperationAttempt, env, completedClaim, completedResult);
    await audit(env, context, 'shipstation_shipment_attempt_completed', id, {
      order_shipment_id: orderShipmentId,
      shipment_id: expectedProviderId,
      operation: attemptOperation,
      reason: operationReason,
    }).catch(() => {});
    return completedResult;
  }
  if (durableAttempt && durableAttempt.operation !== `shipment_${state.operation}`) {
    throw new ShipStationError('shipstation_shipment_reconciliation_mismatch');
  }
  const reconciliationClaim = durableAttempt
    ? await claimAttemptReconciliation(env, { operationKey: durableAttempt.operation_key })
    : null;

  let provider;
  if (state.provider_shipment_id) {
    const expectedProviderShipmentId = providerId(
      state.provider_shipment_id, 'shipstation_shipment_required',
    );
    provider = await getShipment(env, expectedProviderShipmentId);
    if (providerId(provider?.shipment_id, 'shipstation_shipment_required') !== expectedProviderShipmentId) {
      throw new ShipStationError('shipstation_shipment_reconciliation_mismatch');
    }
  } else {
    const expectedExternalId = externalShipmentId(state.external_shipment_id);
    try {
      provider = await getShipmentByExternalId(env, expectedExternalId);
    } catch (error) {
      if (error?.status === 404 || error?.code === 'shipstation_http_404') {
        throw new ShipStationError('shipstation_shipment_reconciliation_unresolved');
      }
      throw error;
    }
    if (String(provider?.external_shipment_id || '').trim() !== expectedExternalId) {
      throw new ShipStationError('shipstation_shipment_reconciliation_mismatch');
    }
  }
  const providerShipmentId = providerId(provider?.shipment_id || state.provider_shipment_id, 'shipstation_shipment_required');
  const providerStatus = text(provider?.shipment_status || provider?.status, 80).toLowerCase();
  if (state.operation === 'cancel' && providerStatus !== 'cancelled') {
    throw new ShipStationError('shipstation_shipment_reconciliation_unresolved');
  }
  const packages = state.operation === 'cancel'
    ? []
    : providerShipmentPackages(provider, state.pending_payload?.packages || []);
  const packageHash = state.operation === 'cancel' ? state.package_hash : await stablePackageHash(packages);
  const expectedPackageHash = state.operation === 'cancel'
    ? state.package_hash
    : await stablePackageHash(state.pending_payload?.packages || []);
  if (state.operation !== 'cancel' && packageHash !== expectedPackageHash) {
    throw new ShipStationError('shipstation_shipment_reconciliation_mismatch');
  }
  let rates = [];
  if (state.operation !== 'cancel') {
    const { carrierIds, carriers } = await resolveCarrierSelection(
      env, listCarriers, state.pending_payload?.carrier_ids, packages.length,
    );
    const quoted = await quoteRates(env, {
      shipment_id: providerShipmentId,
      rate_options: { carrier_ids: carrierIds },
    });
    const rateResponse = quoted?.rate_response || quoted || {};
    rates = safeRatesForPackages(rateResponse, packages, carriers);
  }
  const finalized = await finalizeShipmentOperation(env, {
    orderShipmentId,
    expectedRevision: Number(state.revision),
    providerShipmentId,
    status: state.operation === 'cancel' ? 'cancelled' : 'rated',
    packageHash,
    packages,
    rates,
    actorId: context?.user?.id,
    actorEmail: context?.user?.email,
    reason: operationReason,
  });
  const result = {
    reconciled: true,
    order_shipment_id: orderShipmentId,
    shipment_id: providerShipmentId,
    revision: finalized.revision,
    status: finalized.status || (state.operation === 'cancel' ? 'cancelled' : 'rated'),
  };
  await completeAttempt(completeOperationAttempt, env, reconciliationClaim, result);
  return result;
}

export async function buyOrderLabel(env, input, context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  const rateId = providerId(input?.rate_id, 'shipstation_rate_required');
  const orderShipmentId = rowId(input?.order_shipment_id);
  const revision = expectedRevision(input?.expected_revision);
  const requestedShipmentId = providerId(
    input?.shipment_id || input?.provider_shipment_id,
    'shipstation_shipment_required',
  );
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');

  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const getRate = dependencies.getRate || defaultGetRate;
  const verifySelectedRate = dependencies.verifySelectedRate || defaultVerifySelectedRate;
  const claimLabel = dependencies.claimLabel || defaultClaimLabel;
  const purchaseLabel = dependencies.purchaseLabel || defaultPurchaseLabel;
  const persistLabel = dependencies.persistLabel || defaultPersistLabel;
  const insertShipmentEvent = dependencies.insertShipmentEvent || defaultInsertShipmentEvent;
  const audit = dependencies.audit || defaultAudit;
  const linkProviderObject = dependencies.linkProviderObject || defaultLinkProviderObject;
  const recordFinancialEntry = dependencies.recordFinancialEntry || defaultRecordFinancialEntry;
  const markAttemptProviderSucceeded = dependencies.markAttemptProviderSucceeded || defaultMarkAttemptProviderSucceeded;
  const completeOperationAttempt = dependencies.completeOperationAttempt || defaultCompleteAttempt;
  const attemptLifecycle = {
    reconcile: dependencies.markAttemptReconcileRequired || defaultMarkAttemptReconcileRequired,
    release: dependencies.releaseOperationAttempt || defaultReleaseAttempt,
  };
  let order = await loadOrder(env, id);
  assertShippable(order);
  const selectedRate = await verifySelectedRate(env, {
    orderId: id,
    orderShipmentId,
    expectedRevision: revision,
    shipmentId: requestedShipmentId,
    rateId,
  });
  if (!selectedRate || selectedRate === true
      || rowId(selectedRate.order_shipment_id) !== orderShipmentId
      || Number(selectedRate.revision) !== revision
      || providerId(selectedRate.shipment_id, 'shipstation_shipment_required') !== requestedShipmentId) {
    throw new ShipStationError('shipstation_rate_selection_invalid');
  }
  const shipmentId = requestedShipmentId;
  const existing = existingLabelForShipment(order, orderShipmentId, requestedShipmentId);
  if (existing) {
    if ((existing.order_shipment_id && existing.order_shipment_id !== orderShipmentId)
      || (existing.revision != null && existing.revision !== revision)
      || (existing.rate_id && existing.rate_id !== rateId)) {
      throw new ShipStationError('shipstation_label_order_mismatch');
    }
    await linkShipStationObject(linkProviderObject, env, order, 'shipment', requestedShipmentId, {
      order_shipment_id: orderShipmentId,
      revision,
    });
    await linkShipStationObject(linkProviderObject, env, order, 'rate', rateId, {
      shipment_id: requestedShipmentId,
    });
    await linkShipStationObject(linkProviderObject, env, order, 'label', existing.label_id, {
      order_shipment_id: orderShipmentId,
      revision,
      shipment_id: requestedShipmentId,
      rate_id: rateId,
      status: existing.status,
    });
    await recordPostagePurchase(recordFinancialEntry, env, order, {
      labelId: existing.label_id,
      orderShipmentId,
      shipmentId: requestedShipmentId,
      rateId,
      cost: existing.cost,
      currency: existing.currency,
      actorId: context?.user?.id,
    });
    return existing;
  }
  if (['purchasing', 'reconcile_required'].includes(text(order.shipstation_label_status, 40))) {
    throw new ShipStationError('shipstation_label_purchase_locked');
  }

  const rate = await getRate(env, rateId);
  if (text(rate?.shipment_id, 100) !== shipmentId) {
    throw new ShipStationError('shipstation_rate_order_mismatch');
  }
  const providerRate = safeRate(rate);
  if (providerRate.rate_id !== rateId
    || providerRate.amount_minor !== Number(selectedRate.amount_minor)
    || providerRate.currency !== text(selectedRate.currency, 8).toLowerCase()
    || providerRate.currency_exponent !== Number(selectedRate.currency_exponent)) {
    throw new ShipStationError('shipstation_rate_snapshot_mismatch');
  }
  const claimed = await claimLabel(env, {
    orderId: id,
    orderShipmentId,
    expectedRevision: revision,
    rateId,
  });
  if (claimed?.state === 'completed') return claimed.result_summary || {};
  if (['provider_succeeded', 'reconcile_required'].includes(claimed?.state)) {
    throw new ShipStationError('shipstation_operation_reconciliation_required', 409);
  }
  if (claimed !== true && claimed?.claimed !== true) {
    order = await loadOrder(env, id);
    const concurrentExisting = existingLabelForShipment(order, orderShipmentId, requestedShipmentId);
    if (concurrentExisting) return concurrentExisting;
    throw new ShipStationError('shipstation_label_purchase_locked');
  }

  let label;
  let providerAccepted = false;
  try {
    label = await purchaseLabel(env, rateId, {
      validate_address: 'validate_and_clean',
      label_layout: '4x6',
      label_format: 'pdf',
      label_download_type: 'url',
      display_scheme: 'label',
    });
    providerAccepted = true;
    await recordAttemptProviderSucceeded(
      markAttemptProviderSucceeded, env, claimed,
      text(label?.label_id, 100) || null,
      {
        label_id: text(label?.label_id, 100) || null,
        shipment_id: text(label?.shipment_id, 100) || shipmentId,
        tracking_number: text(label?.tracking_number, 160) || null,
        status: text(label?.status || label?.label_status, 80).toLowerCase() || null,
      },
    );
  } catch (error) {
    await recordAttemptFailure(
      attemptLifecycle, env, claimed, error, context, 'label purchase', providerAccepted,
    ).catch(() => {});
    await persistLabel(env, id, {
      shipstation_label_status: !providerAccepted && providerFailureIsProvenRejection(error)
        ? 'rated'
        : 'reconcile_required',
      shipstation_error: text(error?.code || 'shipstation_label_purchase_failed', 160),
    }).catch(() => {});
    throw error;
  }

  const labelId = text(label?.label_id, 100);
  if (!labelId) {
    await persistLabel(env, id, {
      shipstation_label_status: 'reconcile_required',
      shipstation_error: 'shipstation_label_response_invalid',
    });
    throw new ShipStationError('shipstation_label_response_invalid');
  }
  if (text(label?.shipment_id, 100) !== shipmentId) {
    await persistLabel(env, id, {
      shipstation_label_status: 'reconcile_required',
      shipstation_error: 'shipstation_label_response_invalid',
    });
    throw new ShipStationError('shipstation_label_response_invalid');
  }
  const labelUrl = text(label?.label_download?.pdf || label?.label_download?.href || label?.label_download, 1000) || null;
  const trackingNumber = text(label?.tracking_number, 160) || null;
  const trackingUrl = text(label?.tracking_url, 1000) || null;
  const providerStatus = text(label?.status || label?.label_status, 80).toLowerCase();
  if (['error', 'voided'].includes(providerStatus)) {
    await persistLabel(env, id, {
      shipstation_shipment_id: text(label?.shipment_id, 100) || shipmentId,
      shipstation_label_id: labelId,
      shipstation_rate_id: rateId,
      shipstation_label_status: 'reconcile_required',
      shipstation_error: 'shipstation_label_provider_error',
    });
    throw new ShipStationError('shipstation_label_provider_error');
  }
  const labelCost = money(label?.shipment_cost);
  const labelCurrency = text(label?.shipment_cost?.currency, 8).toLowerCase();
  if (labelCost == null || labelCost < 0 || !/^[a-z]{3}$/.test(labelCurrency)) {
    await persistLabel(env, id, {
      shipstation_label_status: 'reconcile_required',
      shipstation_error: 'shipstation_label_response_invalid',
    });
    throw new ShipStationError('shipstation_label_response_invalid');
  }
  const labelStatus = ['processing', 'pending', 'queued'].includes(providerStatus)
    ? 'label_pending'
    : 'label_purchased';
  const patch = {
    shipstation_shipment_id: text(label?.shipment_id, 100) || shipmentId,
    shipstation_label_id: labelId,
    shipstation_rate_id: rateId,
    shipstation_carrier_id: text(label?.carrier_id, 100) || null,
    shipstation_service_code: text(label?.service_code, 100) || null,
    shipstation_label_url: labelUrl,
    shipstation_cost: labelCost,
    shipstation_label_status: labelStatus,
    shipstation_error: null,
    tracking_status: 'packing',
    carrier: text(label?.carrier_code || label?.carrier_id, 120) || null,
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
  };
  await persistLabel(env, id, patch);
  await linkShipStationObject(linkProviderObject, env, order, 'shipment', patch.shipstation_shipment_id, {
    order_shipment_id: orderShipmentId,
    revision,
  });
  await linkShipStationObject(linkProviderObject, env, order, 'rate', rateId, {
    shipment_id: patch.shipstation_shipment_id,
  });
  await linkShipStationObject(linkProviderObject, env, order, 'label', labelId, {
    order_shipment_id: orderShipmentId,
    revision,
    shipment_id: patch.shipstation_shipment_id,
    rate_id: rateId,
    status: labelStatus,
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
    carrier: patch.carrier,
    cost: patch.shipstation_cost,
    currency: labelCurrency,
  });
  await recordPostagePurchase(recordFinancialEntry, env, order, {
    labelId,
    orderShipmentId,
    shipmentId: patch.shipstation_shipment_id,
    rateId,
    cost: patch.shipstation_cost,
    currency: labelCurrency,
    actorId: context?.user?.id,
  });
  await insertShipmentEvent(env, id, {
    status: 'packing',
    carrier: patch.carrier,
    tracking_number: trackingNumber,
    note: `ShipStation label ${labelId} purchased`,
    provider: 'shipstation',
    provider_event_key: `label-purchase:${labelId}`,
    order_shipment_id: orderShipmentId,
    provider_label_id: labelId,
  });
  await audit(env, context, 'shipstation_label_purchased', id, {
    shipment_id: patch.shipstation_shipment_id,
    label_id: labelId,
    rate_id: rateId,
    cost: patch.shipstation_cost,
    currency: labelCurrency,
    status: labelStatus,
  });
  const result = {
    already_purchased: false,
    label_id: labelId,
    shipment_id: patch.shipstation_shipment_id,
    status: labelStatus,
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
    cost: patch.shipstation_cost,
    currency: labelCurrency,
  };
  const { tracking_url: _trackingUrl, ...attemptResult } = result;
  await completeAttempt(completeOperationAttempt, env, claimed, attemptResult);
  return result;
}

export async function voidOrderLabel(env, input, context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  const labelId = providerId(input?.label_id, 'shipstation_label_required');
  const reason = text(input?.reason, 280);
  if (input?.confirm !== true) throw new ShipStationError('shipstation_label_void_confirmation_required');
  if (reason.length < 8) throw new ShipStationError('shipstation_label_void_reason_required');
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');

  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const claimVoid = dependencies.claimVoid || defaultClaimVoid;
  const voidLabel = dependencies.voidLabel || defaultVoidLabel;
  const finalizeVoid = dependencies.finalizeVoid || defaultFinalizeVoid;
  const persistLabel = dependencies.persistLabel || defaultPersistLabel;
  const audit = dependencies.audit || defaultAudit;
  const markAttemptProviderSucceeded = dependencies.markAttemptProviderSucceeded || defaultMarkAttemptProviderSucceeded;
  const completeOperationAttempt = dependencies.completeOperationAttempt || defaultCompleteAttempt;
  const attemptLifecycle = {
    reconcile: dependencies.markAttemptReconcileRequired || defaultMarkAttemptReconcileRequired,
    release: dependencies.releaseOperationAttempt || defaultReleaseAttempt,
  };

  let order = await loadOrder(env, id);
  assertShippable(order);
  const ownedLabel = resolveShipmentLabel(order, labelId, { kind: 'outbound' });
  if (!ownedLabel) throw new ShipStationError('shipstation_label_order_mismatch');
  if (!ownedLabel.active) {
    return { already_voided: true, label_id: labelId, status: 'label_voided', refund_state: 'pending' };
  }
  if (VOID_BLOCKING_TRACKING_STATUSES.has(text(ownedLabel.tracking_status, 40))) {
    throw new ShipStationError('shipstation_label_void_blocked');
  }

  const claimed = await claimVoid(env, id, labelId);
  if (claimed?.state === 'completed') return claimed.result_summary || {};
  if (['provider_succeeded', 'reconcile_required'].includes(claimed?.state)) {
    throw new ShipStationError('shipstation_operation_reconciliation_required', 409);
  }
  if (claimed !== true && claimed?.claimed !== true) {
    order = await loadOrder(env, id);
    if (resolveShipmentLabel(order, labelId, { kind: 'outbound' })?.active === false) {
      return { already_voided: true, label_id: labelId, status: 'label_voided', refund_state: 'pending' };
    }
    throw new ShipStationError('shipstation_label_void_locked');
  }

  let provider;
  let providerAccepted = false;
  try {
    provider = await voidLabel(env, labelId);
    providerAccepted = provider?.approved === true;
    if (providerAccepted) {
      await recordAttemptProviderSucceeded(
        markAttemptProviderSucceeded, env, claimed, labelId,
        { label_id: labelId, approved: true },
      );
    }
  } catch (error) {
    await recordAttemptFailure(
      attemptLifecycle, env, claimed, error, context, 'label void', providerAccepted,
    ).catch(() => {});
    await persistLabel(env, id, {
      shipstation_label_status: providerFailureIsProvenRejection(error)
        ? 'label_void_failed'
        : 'void_reconcile_required',
      shipstation_error: text(error?.code || 'shipstation_label_void_failed', 160),
    }).catch(() => {});
    throw error;
  }
  if (provider?.approved !== true) {
    const handle = attemptHandle(claimed);
    if (handle) {
      await attemptLifecycle.release(env, {
        ...handle,
        evidence: 'provider_rejected',
        reason: 'Provider explicitly rejected label void request',
        actorId: context?.user?.id,
        actorEmail: context?.user?.email,
        errorCode: 'shipstation_label_void_rejected',
      });
    }
    await persistLabel(env, id, {
      shipstation_label_status: 'label_void_failed',
      shipstation_error: 'shipstation_label_void_rejected',
    });
    throw new ShipStationError('shipstation_label_void_rejected');
  }

  const providerMessage = text(provider?.message, 240) || null;
  await finalizeVoid(env, {
    orderId: id,
    labelId,
    actorId: text(context?.user?.id, 80) || null,
    reason,
    providerMessage,
  });
  await audit(env, context, 'shipstation_label_voided', id, {
    label_id: labelId,
    reason,
    refund_state: 'pending',
  }).catch(() => {});
  const result = {
    already_voided: false,
    label_id: labelId,
    status: 'label_voided',
    refund_state: 'pending',
    message: providerMessage,
  };
  await completeAttempt(completeOperationAttempt, env, claimed, {
    already_voided: false,
    label_id: labelId,
    status: 'label_voided',
    refund_state: 'pending',
  });
  return result;
}

export async function reconcileOrderLabelVoid(env, input, context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  const labelId = providerId(input?.label_id, 'shipstation_label_required');
  const operationReason = reason(input?.reason);
  if (input?.confirm !== true) throw new ShipStationError('shipstation_label_reconcile_confirmation_required');
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');

  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const getLabel = dependencies.getLabel || defaultGetLabel;
  const finalizeVoid = dependencies.finalizeVoidReconciliation || defaultFinalizeVoidReconciliation;
  const persistLabel = dependencies.persistLabel || defaultPersistLabel;
  const audit = dependencies.audit || defaultAudit;
  const claimAttemptReconciliation = dependencies.claimAttemptReconciliation || defaultClaimAttemptReconciliation;
  const completeOperationAttempt = dependencies.completeOperationAttempt || defaultCompleteAttempt;
  const releaseOperationAttempt = dependencies.releaseOperationAttempt || defaultReleaseAttempt;

  const order = await loadOrder(env, id);
  assertShippable(order);
  const owned = resolveShipmentLabel(order, labelId, { kind: 'outbound' });
  if (!owned) throw new ShipStationError('shipstation_label_order_mismatch');
  const durableAttempt = reconcilableAttempt(
    order.shipstation_operation_attempts,
    'label_void',
    (attempt) => !attempt?.provider_link_id || attempt.provider_link_id === owned.provider_link_id,
  );
  if (!durableAttempt && text(order.shipstation_label_status, 40) !== 'void_reconcile_required') {
    throw new ShipStationError('shipstation_label_reconcile_not_required');
  }
  const reconciliationClaim = durableAttempt
    ? await claimAttemptReconciliation(env, { operationKey: durableAttempt.operation_key })
    : null;

  const provider = await getLabel(env, labelId);
  if (text(provider?.label_id, 100) !== labelId || provider?.is_return_label === true) {
    throw new ShipStationError('shipstation_label_reconciliation_mismatch');
  }
  const providerStatus = text(provider?.status || provider?.label_status, 80).toLowerCase();
  const providerVoided = provider?.voided === true || providerStatus === 'voided';
  if (providerVoided) {
    await finalizeVoid(env, {
      orderId: id,
      labelId,
      actorId: text(context?.user?.id, 80) || null,
      reason: operationReason,
      providerMessage: 'Provider confirms label voided',
    });
    const result = {
      reconciled: true,
      accepted: true,
      label_id: labelId,
      order_shipment_id: owned.order_shipment_id,
      status: 'label_voided',
      refund_state: 'pending',
    };
    await completeAttempt(completeOperationAttempt, env, reconciliationClaim, result);
    await audit(env, context, 'shipstation_label_void_reconciled', id, {
      label_id: labelId,
      order_shipment_id: owned.order_shipment_id,
      reason: operationReason,
    }).catch(() => {});
    return result;
  }

  const positivelyNotAccepted = provider?.voided === false
    && ['completed', 'purchased', 'label_purchased'].includes(providerStatus);
  if (!positivelyNotAccepted || durableAttempt?.status === 'provider_succeeded' || !reconciliationClaim) {
    throw new ShipStationError('shipstation_label_void_reconciliation_unresolved');
  }
  await releaseOperationAttempt(env, {
    ...attemptHandle(reconciliationClaim),
    evidence: 'provider_rejected',
    reason: operationReason,
    actorId: context?.user?.id,
    actorEmail: context?.user?.email,
    errorCode: 'shipstation_label_void_not_accepted',
  });
  await persistLabel(env, id, {
    shipstation_label_status: 'label_void_failed',
    shipstation_error: 'shipstation_label_void_not_accepted',
  });
  await audit(env, context, 'shipstation_label_void_released', id, {
    label_id: labelId,
    order_shipment_id: owned.order_shipment_id,
    reason: operationReason,
  }).catch(() => {});
  return {
    reconciled: true,
    accepted: false,
    released: true,
    label_id: labelId,
    order_shipment_id: owned.order_shipment_id,
    status: 'label_void_failed',
  };
}

export async function reconcileOrderLabelPurchase(env, input, context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  const reason = text(input?.reason, 280);
  if (input?.confirm !== true) throw new ShipStationError('shipstation_label_reconcile_confirmation_required');
  if (reason.length < 8) throw new ShipStationError('shipstation_label_reconcile_reason_required');
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');

  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const listLabels = dependencies.listLabels || defaultListLabels;
  const persistLabel = dependencies.persistLabel || defaultPersistLabel;
  const finalizeReconciliation = dependencies.finalizeReconciliation || defaultFinalizeReconciliation;
  const audit = dependencies.audit || defaultAudit;
  const claimAttemptReconciliation = dependencies.claimAttemptReconciliation || defaultClaimAttemptReconciliation;
  const completeOperationAttempt = dependencies.completeOperationAttempt || defaultCompleteAttempt;
  const order = await loadOrder(env, id);
  assertShippable(order);
  const requestedOrderShipmentId = input?.order_shipment_id
    ? rowId(input.order_shipment_id)
    : null;
  const purchaseAttempts = (Array.isArray(order.shipstation_operation_attempts)
    ? order.shipstation_operation_attempts
    : []).filter((attempt) => (
    attempt?.operation === 'label_purchase'
    && ['provider_succeeded', 'reconcile_required'].includes(text(attempt?.status, 40))
    && (!requestedOrderShipmentId
      || text(attempt?.order_shipment_id, 80) === requestedOrderShipmentId)
  ));
  if (purchaseAttempts.length > 1) {
    throw new ShipStationError('shipstation_operation_reconciliation_ambiguous', 409);
  }
  const durableAttempt = purchaseAttempts[0] || null;
  const orderShipmentId = rowId(
    requestedOrderShipmentId
      || durableAttempt?.order_shipment_id
      || order.shipstation_order_shipment_id,
  );
  const shipment = (Array.isArray(order.order_shipments) ? order.order_shipments : [])
    .find((candidate) => text(candidate?.id, 80) === orderShipmentId
      && text(candidate?.status, 40) !== 'cancelled');
  if (!shipment) throw new ShipStationError('shipstation_order_shipment_not_found');
  const shipmentId = providerId(shipment.provider_shipment_id, 'shipstation_shipment_required');
  const projectionIsUncertain = ['purchasing', 'reconcile_required']
    .includes(text(order.shipstation_label_status, 40))
    && (!order.shipstation_order_shipment_id
      || text(order.shipstation_order_shipment_id, 80) === orderShipmentId);
  if (!durableAttempt && !projectionIsUncertain) {
    throw new ShipStationError('shipstation_label_reconcile_not_required');
  }
  const reconciliationClaim = durableAttempt
    ? await claimAttemptReconciliation(env, { operationKey: durableAttempt.operation_key })
    : null;
  const expectedLabelId = text(
    durableAttempt?.provider_object_id || durableAttempt?.result_summary?.label_id,
    100,
  );
  const canonicalLabels = shipmentLabelOwnership(order).outbound.filter((label) => (
    label.active && label.order_shipment_id === orderShipmentId
  ));
  const completedLabel = expectedLabelId
    ? canonicalLabels.find((label) => label.label_id === expectedLabelId)
    : null;
  if (completedLabel && durableAttempt?.status === 'provider_succeeded') {
    const result = {
      reconciled: true,
      already_finalized: true,
      order_shipment_id: orderShipmentId,
      shipment_id: shipmentId,
      label_id: completedLabel.label_id,
      status: completedLabel.status,
      tracking_number: completedLabel.tracking_number,
      carrier_code: completedLabel.carrier,
      cost: completedLabel.cost,
      currency: completedLabel.currency,
    };
    await completeAttempt(completeOperationAttempt, env, reconciliationClaim, result);
    await audit(env, context, 'shipstation_label_purchase_attempt_completed', id, {
      order_shipment_id: orderShipmentId,
      shipment_id: shipmentId,
      label_id: completedLabel.label_id,
      reason,
    }).catch(() => {});
    return result;
  }
  if (canonicalLabels.length > 0) {
    throw new ShipStationError('shipstation_label_reconciliation_mismatch');
  }
  const nowValue = dependencies.now ? dependencies.now() : new Date();
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (Number.isNaN(now.getTime())) throw new ShipStationError('shipstation_label_reconcile_window_invalid');
  const attempt = new Date(
    durableAttempt?.created_at || order.shipstation_updated_at || order.updated_at || order.created_at || now,
  );
  const attemptMs = Number.isNaN(attempt.getTime()) ? now.getTime() : attempt.getTime();
  const start = new Date(Math.max(attemptMs - (15 * 60 * 1000), now.getTime() - (24 * 60 * 60 * 1000)));
  const query = {
    created_at_start: start.toISOString(),
    created_at_end: now.toISOString(),
    page_size: 100,
    sort_by: 'created_at',
    sort_dir: 'desc',
  };
  const candidates = new Map();
  let providerPages = 1;
  for (let page = 1; page <= Math.min(providerPages, 2); page += 1) {
    const payload = await listLabels(env, { ...query, page });
    if (!payload || !Array.isArray(payload.labels)) {
      throw new ShipStationError('shipstation_label_list_invalid');
    }
    const pages = number(payload.pages);
    providerPages = pages && pages > 0 ? Math.floor(pages) : 1;
    for (const label of payload.labels) {
      const labelId = text(label?.label_id, 100);
      const status = text(label?.status || label?.label_status, 80).toLowerCase();
      if (!/^se-[a-z0-9_-]+$/i.test(labelId)
          || text(label?.shipment_id, 100) !== shipmentId
          || (expectedLabelId && labelId !== expectedLabelId)
          || label?.is_return_label === true
          || label?.voided === true
          || ['error', 'voided'].includes(status)) continue;
      candidates.set(labelId, label);
    }
  }
  if (providerPages > 2) {
    await persistLabel(env, id, {
      shipstation_label_status: 'reconcile_required',
      shipstation_error: 'shipstation_label_reconcile_truncated',
    });
    await audit(env, context, 'shipstation_label_purchase_reconcile_unresolved', id, {
      reason, outcome: 'truncated', candidate_count: candidates.size, provider_pages: providerPages,
    });
    throw new ShipStationError('shipstation_label_reconcile_truncated');
  }
  if (candidates.size !== 1) {
    const code = candidates.size === 0
      ? 'shipstation_label_reconcile_not_found'
      : 'shipstation_label_reconcile_ambiguous';
    await persistLabel(env, id, { shipstation_label_status: 'reconcile_required', shipstation_error: code });
    await audit(env, context, 'shipstation_label_purchase_reconcile_unresolved', id, {
      reason,
      outcome: candidates.size === 0 ? 'not_found' : 'ambiguous',
      candidate_count: candidates.size,
    });
    throw new ShipStationError(code);
  }

  const label = [...candidates.values()][0];
  const labelId = providerId(label?.label_id, 'shipstation_label_response_invalid');
  const cost = money(label?.shipment_cost);
  const currency = text(label?.shipment_cost?.currency || order.currency, 8).toLowerCase();
  if (cost == null || cost < 0 || !/^[a-z]{3}$/.test(currency)) {
    await persistLabel(env, id, {
      shipstation_label_status: 'reconcile_required',
      shipstation_error: 'shipstation_label_response_invalid',
    });
    throw new ShipStationError('shipstation_label_response_invalid');
  }
  const providerStatus = text(label?.status || label?.label_status, 80).toLowerCase();
  const labelStatus = ['processing', 'pending', 'queued'].includes(providerStatus)
    ? 'label_pending'
    : 'label_purchased';
  const trackingNumber = text(label?.tracking_number, 160) || null;
  const patch = {
    shipstation_shipment_id: shipmentId,
    shipstation_label_id: labelId,
    shipstation_rate_id: text(shipment.selected_rate_id || order.shipstation_rate_id, 100) || null,
    shipstation_carrier_id: text(label?.carrier_id, 100) || null,
    shipstation_service_code: text(label?.service_code, 100) || null,
    shipstation_label_url: text(label?.label_download?.pdf || label?.label_download?.href, 1000) || null,
    shipstation_cost: cost,
    shipstation_label_status: labelStatus,
    shipstation_error: null,
    tracking_status: 'packing',
    carrier: text(label?.carrier_code || label?.carrier_id, 120) || null,
    tracking_number: trackingNumber,
    tracking_url: text(label?.tracking_url, 1000) || null,
  };
  await finalizeReconciliation(env, {
    orderId: id,
    orderShipmentId,
    shipmentId,
    labelId,
    rateId: patch.shipstation_rate_id,
    carrierId: patch.shipstation_carrier_id,
    serviceCode: patch.shipstation_service_code,
    labelUrl: patch.shipstation_label_url,
    cost,
    currency,
    labelStatus,
    carrier: patch.carrier,
    trackingNumber,
    trackingUrl: patch.tracking_url,
    actorId: context?.user?.id,
    actorEmail: context?.user?.email,
    reason,
  });
  const result = { reconciled: true, ...safeLabel(label), status: labelStatus };
  await completeAttempt(completeOperationAttempt, env, reconciliationClaim, result);
  return result;
}

export async function createOrderReturnLabel(env, input, context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  const outboundLabelId = providerId(input?.label_id, 'shipstation_label_required');
  const reason = text(input?.reason, 280);
  if (input?.confirm !== true) throw new ShipStationError('shipstation_return_confirmation_required');
  if (reason.length < 8) throw new ShipStationError('shipstation_return_reason_required');
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');

  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const claimReturn = dependencies.claimReturn || defaultClaimReturn;
  const createReturn = dependencies.createReturn || defaultCreateReturn;
  const finalizeReturn = dependencies.finalizeReturn || defaultFinalizeReturn;
  const persistReturn = dependencies.persistReturn || defaultPersistReturn;
  const linkProviderObject = dependencies.linkProviderObject || defaultLinkProviderObject;
  const recordFinancialEntry = dependencies.recordFinancialEntry || defaultRecordFinancialEntry;
  const audit = dependencies.audit || defaultAudit;
  const markAttemptProviderSucceeded = dependencies.markAttemptProviderSucceeded || defaultMarkAttemptProviderSucceeded;
  const completeOperationAttempt = dependencies.completeOperationAttempt || defaultCompleteAttempt;
  const attemptLifecycle = {
    reconcile: dependencies.markAttemptReconcileRequired || defaultMarkAttemptReconcileRequired,
    release: dependencies.releaseOperationAttempt || defaultReleaseAttempt,
  };
  let order = await loadOrder(env, id);
  assertShippable(order);
  const outbound = resolveShipmentLabel(order, outboundLabelId, { kind: 'outbound' });
  if (!outbound) throw new ShipStationError('shipstation_label_order_mismatch');
  if (!outbound.active) throw new ShipStationError('shipstation_return_outbound_voided');
  const address = order?.ship_address?.address || order?.ship_address || {};
  const country = text(address?.country || address?.country_code, 8).toUpperCase();
  if (!['US', 'USA'].includes(country)) throw new ShipStationError('shipstation_return_domestic_required');

  const repairExisting = async () => {
    const existing = existingReturnLabel(order, outboundLabelId);
    await linkProviderObject(env, {
      orderId: order.id,
      provider: 'shipstation',
      objectType: 'return_label',
      providerObjectId: existing.label_id,
      metadata: {
        order_number: order.order_number || null,
        outbound_label_id: outboundLabelId,
        order_shipment_id: outbound.order_shipment_id,
        status: existing.status,
        tracking_number: existing.tracking_number,
        cost: existing.cost,
        currency: existing.currency,
        charge_event: existing.charge_event,
      },
    });
    await recordReturnPostage(recordFinancialEntry, env, order, {
      returnLabelId: existing.label_id,
      outboundLabelId,
      orderShipmentId: outbound.order_shipment_id,
      cost: existing.cost,
      currency: existing.currency,
      chargeEvent: existing.charge_event,
      actorId: context?.user?.id,
      reason,
    });
    await audit(env, context, 'shipstation_return_label_repaired', id, {
      outbound_label_id: outboundLabelId,
      return_label_id: existing.label_id,
      cost: existing.cost,
      currency: existing.currency,
      charge_event: existing.charge_event,
    });
    return existing;
  };
  if (existingReturnLabel(order, outboundLabelId).label_id) return repairExisting();
  if (text(order.shipstation_label_id, 100) === outboundLabelId
      && ['return_purchasing', 'return_reconcile_required'].includes(text(order.shipstation_return_label_status, 40))) {
    throw new ShipStationError('shipstation_return_locked');
  }

  const claimed = await claimReturn(env, id, outboundLabelId, {
    orderShipmentId: outbound.order_shipment_id,
    parentProviderLinkId: outbound.provider_link_id,
    actorId: text(context?.user?.id, 80) || null,
    actorEmail: text(context?.user?.email, 254) || null,
    reason,
  });
  if (claimed?.state === 'completed') return claimed.result_summary || {};
  if (['provider_succeeded', 'reconcile_required'].includes(claimed?.state)) {
    throw new ShipStationError('shipstation_operation_reconciliation_required', 409);
  }
  if (claimed !== true && claimed?.claimed !== true) {
    order = await loadOrder(env, id);
    if (existingReturnLabel(order, outboundLabelId).label_id) return repairExisting();
    throw new ShipStationError('shipstation_return_locked');
  }

  const requestBody = {
    charge_event: 'carrier_default',
    label_layout: '4x6',
    label_format: 'pdf',
    label_download_type: 'url',
    display_scheme: 'label',
  };
  let label;
  let providerAccepted = false;
  try {
    label = await createReturn(env, outboundLabelId, requestBody);
    providerAccepted = true;
    await recordAttemptProviderSucceeded(
      markAttemptProviderSucceeded, env, claimed,
      text(label?.label_id, 100) || null,
      {
        label_id: text(label?.label_id, 100) || null,
        outbound_label_id: outboundLabelId,
        tracking_number: text(label?.tracking_number, 160) || null,
        status: text(label?.status || label?.label_status, 80).toLowerCase() || null,
      },
    );
  } catch (error) {
    await recordAttemptFailure(
      attemptLifecycle, env, claimed, error, context, 'return label', providerAccepted,
    ).catch(() => {});
    await persistReturn(env, id, {
      shipstation_return_label_status: !providerAccepted && providerFailureIsProvenRejection(error)
        ? 'return_failed'
        : 'return_reconcile_required',
      shipstation_return_error: text(error?.code || 'shipstation_return_failed', 160),
    }).catch(() => {});
    throw error;
  }
  const returnLabelId = text(label?.label_id, 100);
  if (!/^se-[a-z0-9_-]+$/i.test(returnLabelId)) {
    await persistReturn(env, id, {
      shipstation_return_label_status: 'return_reconcile_required',
      shipstation_return_error: 'shipstation_return_response_invalid',
    });
    throw new ShipStationError('shipstation_return_response_invalid');
  }
  if (label?.is_return_label !== true
      || (text(label?.outbound_label_id, 100) && text(label.outbound_label_id, 100) !== outboundLabelId)
      || ['error', 'voided'].includes(text(label?.status || label?.label_status, 80).toLowerCase())) {
    await persistReturn(env, id, {
      shipstation_return_label_status: 'return_reconcile_required',
      shipstation_return_error: 'shipstation_return_response_invalid',
    });
    throw new ShipStationError('shipstation_return_response_invalid');
  }
  const cost = money(label?.shipment_cost);
  const currency = text(label?.shipment_cost?.currency || order.currency, 8).toLowerCase();
  const chargeEvent = text(label?.charge_event || requestBody.charge_event, 40).toLowerCase();
  if (cost == null || cost < 0 || !/^[a-z]{3}$/.test(currency)
      || !['on_creation', 'on_carrier_acceptance', 'carrier_default'].includes(chargeEvent)) {
    await persistReturn(env, id, {
      shipstation_return_label_status: 'return_reconcile_required',
      shipstation_return_error: 'shipstation_return_response_invalid',
    });
    throw new ShipStationError('shipstation_return_response_invalid');
  }
  const trackingNumber = text(label?.tracking_number, 160) || null;
  await finalizeReturn(env, {
    orderId: id,
    outboundLabelId,
    orderShipmentId: outbound.order_shipment_id,
    returnLabelId,
    cost,
    currency,
    chargeEvent,
    trackingNumber,
    reason,
  });
  const status = 'return_label_created';
  await linkProviderObject(env, {
    orderId: order.id,
    provider: 'shipstation',
    objectType: 'return_label',
    providerObjectId: returnLabelId,
    metadata: {
      order_number: order.order_number || null,
      outbound_label_id: outboundLabelId,
      order_shipment_id: outbound.order_shipment_id,
      status,
      tracking_number: trackingNumber,
      cost,
      currency,
      charge_event: chargeEvent,
    },
  });
  await recordReturnPostage(recordFinancialEntry, env, order, {
    returnLabelId,
    outboundLabelId,
    orderShipmentId: outbound.order_shipment_id,
    cost,
    currency,
    chargeEvent,
    actorId: context?.user?.id,
    reason,
  });
  await audit(env, context, 'shipstation_return_label_created', id, {
    outbound_label_id: outboundLabelId,
    order_shipment_id: outbound.order_shipment_id,
    return_label_id: returnLabelId,
    cost,
    currency,
    charge_event: chargeEvent,
    recognition_state: returnRecognitionState(chargeEvent),
    reason,
  });
  // A return label nobody can print is not a return. Send it to the buyer as soon as it
  // exists; best-effort, because the label is already bought and paid for either way.
  const emailed = await (dependencies.sendReturnLabelEmail || sendReturnLabelEmail)(env, order, {
    labelUrl: text(label?.label_download?.pdf || label?.label_download?.href || label?.label_download, 1000) || null,
    trackingNumber,
    returnLabelId,
    reason,
  });
  const result = {
    already_created: false,
    emailed,
    ...safeLabel(label),
    label_id: returnLabelId,
    outbound_label_id: outboundLabelId,
    status,
    recognition_state: returnRecognitionState(chargeEvent),
  };
  await completeAttempt(completeOperationAttempt, env, claimed, result);
  return result;
}

export async function reconcileOrderReturnLabel(env, input, context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  const outboundLabelId = providerId(input?.label_id, 'shipstation_label_required');
  const operationReason = reason(input?.reason);
  if (input?.confirm !== true) throw new ShipStationError('shipstation_return_reconcile_confirmation_required');
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');

  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const listLabels = dependencies.listLabels || defaultListLabels;
  const finalizeReturn = dependencies.finalizeReturnReconciliation || defaultFinalizeReturnReconciliation;
  const persistReturn = dependencies.persistReturn || defaultPersistReturn;
  const linkProviderObject = dependencies.linkProviderObject || defaultLinkProviderObject;
  const recordFinancialEntry = dependencies.recordFinancialEntry || defaultRecordFinancialEntry;
  const audit = dependencies.audit || defaultAudit;
  const claimAttemptReconciliation = dependencies.claimAttemptReconciliation || defaultClaimAttemptReconciliation;
  const completeOperationAttempt = dependencies.completeOperationAttempt || defaultCompleteAttempt;

  const order = await loadOrder(env, id);
  assertShippable(order);
  const outbound = resolveShipmentLabel(order, outboundLabelId, { kind: 'outbound', requireActive: true });
  if (!outbound) throw new ShipStationError('shipstation_return_outbound_not_owned');
  const durableAttempt = reconcilableAttempt(
    order.shipstation_operation_attempts,
    'label_return',
    (attempt) => !attempt?.parent_provider_link_id
      || attempt.parent_provider_link_id === outbound.provider_link_id,
  );
  if (!durableAttempt
      && !(text(order.shipstation_label_id, 100) === outboundLabelId
        && text(order.shipstation_return_label_status, 40) === 'return_reconcile_required')) {
    throw new ShipStationError('shipstation_return_reconcile_not_required');
  }
  const reconciliationClaim = durableAttempt
    ? await claimAttemptReconciliation(env, { operationKey: durableAttempt.operation_key })
    : null;

  const linkedExisting = existingReturnLabel(order, outboundLabelId);
  if (linkedExisting.label_id) {
    await recordReturnPostage(recordFinancialEntry, env, order, {
      returnLabelId: linkedExisting.label_id,
      outboundLabelId,
      orderShipmentId: outbound.order_shipment_id,
      cost: linkedExisting.cost,
      currency: linkedExisting.currency,
      chargeEvent: linkedExisting.charge_event,
      actorId: context?.user?.id,
      reason: operationReason,
    });
    const result = { reconciled: true, ...linkedExisting };
    await completeAttempt(completeOperationAttempt, env, reconciliationClaim, result);
    return result;
  }

  const nowValue = dependencies.now ? dependencies.now() : new Date();
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (Number.isNaN(now.getTime())) throw new ShipStationError('shipstation_return_reconcile_window_invalid');
  const attemptTime = new Date(
    durableAttempt?.created_at || order.shipstation_return_updated_at || order.updated_at || now,
  );
  const attemptMs = Number.isNaN(attemptTime.getTime()) ? now.getTime() : attemptTime.getTime();
  const start = new Date(Math.max(attemptMs - (15 * 60 * 1000), now.getTime() - (24 * 60 * 60 * 1000)));
  const query = {
    created_at_start: start.toISOString(),
    created_at_end: now.toISOString(),
    page_size: 100,
    sort_by: 'created_at',
    sort_dir: 'desc',
  };
  const candidates = new Map();
  let providerPages = 1;
  for (let page = 1; page <= Math.min(providerPages, 2); page += 1) {
    const payload = await listLabels(env, { ...query, page });
    if (!payload || !Array.isArray(payload.labels)) {
      throw new ShipStationError('shipstation_label_list_invalid');
    }
    const pages = number(payload.pages);
    providerPages = pages && pages > 0 ? Math.floor(pages) : 1;
    for (const label of payload.labels) {
      const returnLabelId = text(label?.label_id, 100);
      const status = text(label?.status || label?.label_status, 80).toLowerCase();
      if (!/^se-[a-z0-9_-]+$/i.test(returnLabelId)
          || label?.is_return_label !== true
          || text(label?.outbound_label_id, 100) !== outboundLabelId
          || label?.voided === true
          || ['error', 'voided'].includes(status)) continue;
      candidates.set(returnLabelId, label);
    }
  }
  if (providerPages > 2) {
    await persistReturn(env, id, {
      shipstation_return_label_status: 'return_reconcile_required',
      shipstation_return_error: 'shipstation_return_reconcile_truncated',
    });
    throw new ShipStationError('shipstation_return_reconcile_truncated');
  }
  if (candidates.size !== 1) {
    const code = candidates.size === 0
      ? 'shipstation_return_reconcile_not_found'
      : 'shipstation_return_reconcile_ambiguous';
    await persistReturn(env, id, {
      shipstation_return_label_status: 'return_reconcile_required',
      shipstation_return_error: code,
    });
    await audit(env, context, 'shipstation_return_label_reconcile_unresolved', id, {
      outbound_label_id: outboundLabelId,
      order_shipment_id: outbound.order_shipment_id,
      candidate_count: candidates.size,
      reason: operationReason,
    }).catch(() => {});
    throw new ShipStationError(code);
  }

  const label = [...candidates.values()][0];
  const returnLabelId = providerId(label.label_id, 'shipstation_return_response_invalid');
  const cost = money(label?.shipment_cost);
  const currency = text(label?.shipment_cost?.currency || order.currency, 8).toLowerCase();
  const chargeEvent = text(label?.charge_event || 'carrier_default', 40).toLowerCase();
  if (cost == null || cost < 0 || !/^[a-z]{3}$/.test(currency)
      || !['on_creation', 'on_carrier_acceptance', 'carrier_default'].includes(chargeEvent)) {
    throw new ShipStationError('shipstation_return_response_invalid');
  }
  const trackingNumber = text(label?.tracking_number, 160) || null;
  await finalizeReturn(env, {
    orderId: id,
    outboundLabelId,
    orderShipmentId: outbound.order_shipment_id,
    returnLabelId,
    cost,
    currency,
    chargeEvent,
    trackingNumber,
    reason: operationReason,
  });
  await linkProviderObject(env, {
    orderId: id,
    provider: 'shipstation',
    objectType: 'return_label',
    providerObjectId: returnLabelId,
    metadata: {
      order_number: order.order_number || null,
      outbound_label_id: outboundLabelId,
      order_shipment_id: outbound.order_shipment_id,
      status: 'return_label_created',
      tracking_number: trackingNumber,
      cost,
      currency,
      charge_event: chargeEvent,
    },
  });
  await recordReturnPostage(recordFinancialEntry, env, order, {
    returnLabelId,
    outboundLabelId,
    orderShipmentId: outbound.order_shipment_id,
    cost,
    currency,
    chargeEvent,
    actorId: context?.user?.id,
    reason: operationReason,
  });
  await audit(env, context, 'shipstation_return_label_reconciled', id, {
    outbound_label_id: outboundLabelId,
    order_shipment_id: outbound.order_shipment_id,
    return_label_id: returnLabelId,
    cost,
    currency,
    charge_event: chargeEvent,
    reason: operationReason,
  });
  const emailed = await (dependencies.sendReturnLabelEmail || sendReturnLabelEmail)(env, order, {
    labelUrl: text(label?.label_download?.pdf || label?.label_download?.href, 1000) || null,
    trackingNumber,
    returnLabelId,
    reason: operationReason,
  });
  const result = {
    reconciled: true,
    emailed,
    ...safeLabel(label),
    label_id: returnLabelId,
    outbound_label_id: outboundLabelId,
    order_shipment_id: outbound.order_shipment_id,
    status: 'return_label_created',
    recognition_state: returnRecognitionState(chargeEvent),
  };
  await completeAttempt(completeOperationAttempt, env, reconciliationClaim, result);
  return result;
}
