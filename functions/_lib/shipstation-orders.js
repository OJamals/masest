import { adminClient } from './supabase.js';
import { recordAudit } from './audit.js';
import { linkOrderProviderObject } from './order-integrations.js';
import { recordOrderFinancialEntry } from './order-financial-ledger.js';
import {
  ShipStationError,
  buildRateRequest,
  shipStationRequest,
} from './shipstation.js';

const SHIPPABLE_STATUSES = new Set(['paid', 'net_open', 'net_paid', 'fulfilled']);
const VOID_BLOCKING_TRACKING_STATUSES = new Set(['shipped', 'in_transit', 'out_for_delivery', 'delivered']);
const LABEL_FORMATS = new Set(['pdf', 'png', 'zpl']);
const LABEL_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const LABEL_DOWNLOAD_PREFIXES = [
  ['api.shipengine.com', '/v1/downloads/'],
  ['api.shipstation.com', '/v2/downloads/'],
];

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

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value) {
  if (value && typeof value === 'object') return number(value.amount);
  return number(value);
}

function payloadList(payload, key) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

function safeRate(rate) {
  return {
    rate_id: text(rate?.rate_id, 100),
    shipment_id: text(rate?.shipment_id, 100),
    carrier_id: text(rate?.carrier_id, 100),
    carrier_code: text(rate?.carrier_code, 80),
    carrier_name: text(rate?.carrier_friendly_name || rate?.carrier_name || rate?.carrier_code, 120),
    service_code: text(rate?.service_code, 100),
    service_type: text(rate?.service_type || rate?.service_code, 120),
    amount: money(rate?.shipping_amount ?? rate?.amount),
    currency: text(rate?.shipping_amount?.currency || rate?.currency || 'usd', 8).toLowerCase(),
    delivery_days: number(rate?.delivery_days ?? rate?.carrier_delivery_days),
    estimated_delivery_date: text(rate?.estimated_delivery_date, 80) || null,
  };
}

function existingLabel(order) {
  return {
    already_purchased: true,
    label_id: text(order?.shipstation_label_id, 100),
    shipment_id: text(order?.shipstation_shipment_id, 100),
    status: text(order?.shipstation_label_status, 80) || 'label_purchased',
    tracking_number: text(order?.tracking_number, 160) || null,
    tracking_url: text(order?.tracking_url, 1000) || null,
  };
}

async function defaultLoadOrder(env, id) {
  const { data, error } = await adminClient(env).from('orders')
    .select('id,order_number,status,customer_email,currency,ship_address,created_at,updated_at,shipstation_shipment_id,shipstation_label_id,shipstation_rate_id,shipstation_label_status,shipstation_label_url,shipstation_cost,shipstation_updated_at,shipstation_return_label_id,shipstation_return_label_status,shipstation_return_cost,shipstation_return_currency,shipstation_return_charge_event,shipstation_return_tracking_number,shipstation_return_error,shipstation_return_updated_at,tracking_status,carrier,tracking_number,tracking_url,order_items(sku,name,qty,unit_price),order_provider_links(provider,object_type,provider_object_id,metadata)')
    .eq('id', id)
    .single();
  if (error) throw new ShipStationError(error.code === 'PGRST116' ? 'shipping_order_not_found' : 'shipping_database_failed');
  return data;
}

async function defaultListCarriers(env) {
  const payload = await shipStationRequest(env, '/carriers');
  return payloadList(payload, 'carriers');
}

export function packagesFromOrderItems(order, variants) {
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
    if (packages.length + qty > 20) throw new ShipStationError('too_many_shipping_packages');
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

async function defaultLoadPackageProfiles(env, order) {
  const skus = [...new Set((order?.order_items || []).map((item) => text(item?.sku, 160)).filter(Boolean))];
  if (!skus.length) throw new ShipStationError('shipping_package_profile_missing');
  const { data, error } = await adminClient(env).from('product_variants')
    .select('vsku,shipping_weight_lb,shipping_length_in,shipping_width_in,shipping_height_in')
    .in('vsku', skus);
  if (error) throw new ShipStationError('shipping_database_failed');
  return packagesFromOrderItems(order, data || []);
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
  const { data, error } = await adminClient(env).rpc('finalize_shipstation_label_reconciliation', {
    p_order_id: input.orderId,
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

async function defaultClaimLabel(env, id, rateId) {
  const { data, error } = await adminClient(env).rpc('claim_shipstation_label_purchase', {
    p_order_id: id,
    p_rate_id: rateId,
  });
  if (error) throw new ShipStationError('shipping_database_failed');
  return data === true;
}

async function defaultPurchaseLabel(env, rateId, body) {
  return shipStationRequest(env, `/labels/rates/${encodeURIComponent(rateId)}`, {
    method: 'POST',
    body,
  });
}

async function defaultClaimVoid(env, id, labelId) {
  const { data, error } = await adminClient(env).rpc('claim_shipstation_label_void', {
    p_order_id: id,
    p_label_id: labelId,
  });
  if (error) throw new ShipStationError('shipping_database_failed');
  return data === true;
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

async function defaultClaimReturn(env, id, labelId) {
  const { data, error } = await adminClient(env).rpc('claim_shipstation_return_label', {
    p_order_id: id,
    p_label_id: labelId,
  });
  if (error) throw new ShipStationError('shipping_database_failed');
  return data === true;
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

async function linkShipStationObject(link, env, order, objectType, providerObjectId) {
  if (!text(providerObjectId, 255)) return null;
  return link(env, {
    orderId: order.id,
    provider: 'shipstation',
    objectType,
    providerObjectId,
    metadata: { order_number: order.order_number || null },
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
      charge_event: text(input.chargeEvent, 40).toLowerCase(),
    },
  });
}

function linkedReturnLabel(order, outboundLabelId) {
  if (!Array.isArray(order?.order_provider_links)) return null;
  return order.order_provider_links.find((link) => link?.provider === 'shipstation'
    && link?.object_type === 'return_label'
    && text(link?.provider_object_id, 100)
    && text(link?.metadata?.outbound_label_id, 100) === outboundLabelId) || null;
}

function existingReturnLabel(order, outboundLabelId) {
  const link = linkedReturnLabel(order, outboundLabelId);
  const metadata = link?.metadata && typeof link.metadata === 'object' ? link.metadata : {};
  const chargeEvent = text(order?.shipstation_return_charge_event || metadata.charge_event, 40).toLowerCase()
    || 'carrier_default';
  return {
    already_created: true,
    label_id: text(order?.shipstation_return_label_id || link?.provider_object_id, 100),
    outbound_label_id: text(order?.shipstation_label_id, 100),
    status: text(order?.shipstation_return_label_status || metadata.status, 80) || 'return_label_created',
    tracking_number: text(order?.shipstation_return_tracking_number || metadata.tracking_number, 160) || null,
    cost: money(order?.shipstation_return_cost ?? metadata.cost),
    currency: text(order?.shipstation_return_currency || metadata.currency || order?.currency || 'usd', 8).toLowerCase(),
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
  const outbound = text(order.shipstation_label_id, 100);
  const returned = text(order.shipstation_return_label_id, 100);
  const linkedReturn = Array.isArray(order.order_provider_links)
    && order.order_provider_links.some((link) => link?.provider === 'shipstation'
      && link?.object_type === 'return_label'
      && text(link?.provider_object_id, 100) === labelId);
  if (labelId === outbound) return 'outbound';
  if (labelId === returned || linkedReturn) return 'return';
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

async function fetchLabelDocument(url, format, fetchDocument) {
  let current = validDocumentUrl(url);
  let response = await fetchDocument(current.href, {
    method: 'GET',
    redirect: 'manual',
    headers: { accept: format === 'pdf' ? 'application/pdf' : format === 'png' ? 'image/png' : 'application/zpl' },
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new ShipStationError('shipstation_label_document_redirect_invalid');
    current = validDocumentUrl(new URL(location, current).href);
    response = await fetchDocument(current.href, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: format === 'pdf' ? 'application/pdf' : format === 'png' ? 'image/png' : 'application/zpl' },
    });
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ShipStationError('shipstation_label_document_redirect_invalid');
  }
  if (!response.ok) throw new ShipStationError('shipstation_label_document_fetch_failed', response.status);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > LABEL_DOCUMENT_MAX_BYTES) {
    throw new ShipStationError('shipstation_label_document_too_large');
  }
  const contentType = documentContentType(format, response.headers.get('content-type'));
  if (!response.body?.getReader) throw new ShipStationError('shipstation_label_document_body_invalid');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
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
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, contentType };
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

export async function downloadOrderLabel(env, input, _context = {}, dependencies = {}) {
  const format = text(input?.format || 'pdf', 12).toLowerCase();
  if (!LABEL_FORMATS.has(format)) throw new ShipStationError('shipstation_label_document_format_invalid');
  const { provider, safe: label } = await resolveOrderLabel(env, input, dependencies);
  const source = provider?.label_download?.[format];
  if (!source) throw new ShipStationError('shipstation_label_document_unavailable');
  const fetchDocument = dependencies.fetchDocument || defaultFetchDocument;
  const document = await fetchLabelDocument(source, format, fetchDocument);
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

export async function rateOrderShipment(env, input, context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  const warehouseId = text(env?.SHIPSTATION_WAREHOUSE_ID, 100);
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');
  if (!warehouseId) throw new ShipStationError('shipstation_warehouse_required');

  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const listCarriers = dependencies.listCarriers || defaultListCarriers;
  const loadPackageProfiles = dependencies.loadPackageProfiles || defaultLoadPackageProfiles;
  const quoteRates = dependencies.quoteRates || defaultQuoteRates;
  const persistRate = dependencies.persistRate || defaultPersistRate;
  const linkProviderObject = dependencies.linkProviderObject || defaultLinkProviderObject;
  const audit = dependencies.audit || defaultAudit;
  const order = await loadOrder(env, id);
  assertShippable(order);
  if (order.shipstation_label_id) throw new ShipStationError('shipstation_label_already_purchased');

  const carriers = await listCarriers(env);
  const connectedIds = new Set(carriers.map((carrier) => text(carrier?.carrier_id, 100)).filter(Boolean));
  if (!connectedIds.size) throw new ShipStationError('shipstation_no_connected_carriers');
  const requestedIds = [...new Set((input?.carrier_ids || []).map((value) => text(value, 100)).filter(Boolean))];
  if (requestedIds.some((carrierId) => !connectedIds.has(carrierId))) {
    throw new ShipStationError('shipstation_carrier_not_connected');
  }
  const carrierIds = requestedIds.length ? requestedIds : [...connectedIds];
  const manualPackages = Array.isArray(input?.packages) && input.packages.length > 0;
  const packages = manualPackages ? input.packages : await loadPackageProfiles(env, order);
  const payload = buildRateRequest({
    order,
    packages,
    warehouseId,
    carrierIds,
    phone: text(input?.phone, 40),
    residential: text(input?.residential, 12),
  });
  const provider = await quoteRates(env, payload);
  const response = provider?.rate_response || provider || {};
  const rates = payloadList(response, 'rates').map(safeRate).filter((rate) => rate.rate_id);
  const shipmentId = text(response?.shipment_id || rates[0]?.shipment_id, 100);
  if (!shipmentId) throw new ShipStationError('shipstation_rate_response_invalid');

  await persistRate(env, id, {
    shipstation_shipment_id: shipmentId,
    shipstation_label_status: 'rated',
    shipstation_error: null,
  });
  await linkShipStationObject(linkProviderObject, env, order, 'shipment', shipmentId);
  await audit(env, context, 'shipstation_rates_quoted', id, {
    shipment_id: shipmentId,
    carrier_ids: carrierIds,
    rate_count: rates.length,
    package_count: payload.shipment.packages.length,
  });
  return {
    shipment_id: shipmentId,
    rates,
    packages: payload.shipment.packages,
    packages_source: manualPackages ? 'manual' : 'cms',
  };
}

export async function buyOrderLabel(env, input, context = {}, dependencies = {}) {
  const id = orderId(input?.order_id);
  const rateId = providerId(input?.rate_id, 'shipstation_rate_required');
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');

  const loadOrder = dependencies.loadOrder || defaultLoadOrder;
  const getRate = dependencies.getRate || defaultGetRate;
  const claimLabel = dependencies.claimLabel || defaultClaimLabel;
  const purchaseLabel = dependencies.purchaseLabel || defaultPurchaseLabel;
  const persistLabel = dependencies.persistLabel || defaultPersistLabel;
  const insertShipmentEvent = dependencies.insertShipmentEvent || defaultInsertShipmentEvent;
  const audit = dependencies.audit || defaultAudit;
  const linkProviderObject = dependencies.linkProviderObject || defaultLinkProviderObject;
  const recordFinancialEntry = dependencies.recordFinancialEntry || defaultRecordFinancialEntry;
  let order = await loadOrder(env, id);
  assertShippable(order);
  if (order.shipstation_label_id && !['label_voided', 'voided'].includes(text(order.shipstation_label_status, 40))) {
    await linkShipStationObject(linkProviderObject, env, order, 'shipment', order.shipstation_shipment_id);
    await linkShipStationObject(linkProviderObject, env, order, 'rate', order.shipstation_rate_id);
    await linkShipStationObject(linkProviderObject, env, order, 'label', order.shipstation_label_id);
    await recordPostagePurchase(recordFinancialEntry, env, order, {
      labelId: order.shipstation_label_id,
      shipmentId: order.shipstation_shipment_id,
      rateId: order.shipstation_rate_id,
      cost: order.shipstation_cost,
      currency: order.currency,
      actorId: context?.user?.id,
    });
    return existingLabel(order);
  }
  const shipmentId = providerId(order.shipstation_shipment_id, 'shipstation_shipment_required');
  if (['purchasing', 'reconcile_required'].includes(text(order.shipstation_label_status, 40))) {
    throw new ShipStationError('shipstation_label_purchase_locked');
  }

  const rate = await getRate(env, rateId);
  if (text(rate?.shipment_id, 100) !== shipmentId) {
    throw new ShipStationError('shipstation_rate_order_mismatch');
  }
  const claimed = await claimLabel(env, id, rateId);
  if (!claimed) {
    order = await loadOrder(env, id);
    if (order?.shipstation_label_id && !['label_voided', 'voided'].includes(text(order.shipstation_label_status, 40))) {
      await linkShipStationObject(linkProviderObject, env, order, 'shipment', order.shipstation_shipment_id);
      await linkShipStationObject(linkProviderObject, env, order, 'rate', order.shipstation_rate_id);
      await linkShipStationObject(linkProviderObject, env, order, 'label', order.shipstation_label_id);
      await recordPostagePurchase(recordFinancialEntry, env, order, {
        labelId: order.shipstation_label_id,
        shipmentId: order.shipstation_shipment_id,
        rateId: order.shipstation_rate_id,
        cost: order.shipstation_cost,
        currency: order.currency,
        actorId: context?.user?.id,
      });
      return existingLabel(order);
    }
    throw new ShipStationError('shipstation_label_purchase_locked');
  }

  let label;
  try {
    label = await purchaseLabel(env, rateId, {
      validate_address: 'validate_and_clean',
      label_layout: '4x6',
      label_format: 'pdf',
      label_download_type: 'url',
      display_scheme: 'label',
    });
  } catch (error) {
    await persistLabel(env, id, {
      shipstation_label_status: 'reconcile_required',
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
    shipstation_cost: money(label?.shipment_cost),
    shipstation_label_status: labelStatus,
    shipstation_error: null,
    tracking_status: 'packing',
    carrier: text(label?.carrier_code || label?.carrier_id, 120) || null,
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
  };
  await persistLabel(env, id, patch);
  await linkShipStationObject(linkProviderObject, env, order, 'shipment', patch.shipstation_shipment_id);
  await linkShipStationObject(linkProviderObject, env, order, 'rate', rateId);
  await linkShipStationObject(linkProviderObject, env, order, 'label', labelId);
  await recordPostagePurchase(recordFinancialEntry, env, order, {
    labelId,
    shipmentId: patch.shipstation_shipment_id,
    rateId,
    cost: patch.shipstation_cost,
    currency: label?.shipment_cost?.currency,
    actorId: context?.user?.id,
  });
  await insertShipmentEvent(env, id, {
    status: 'packing',
    carrier: patch.carrier,
    tracking_number: trackingNumber,
    note: `ShipStation label ${labelId} purchased`,
  });
  await audit(env, context, 'shipstation_label_purchased', id, {
    shipment_id: patch.shipstation_shipment_id,
    label_id: labelId,
    rate_id: rateId,
    cost: patch.shipstation_cost,
    currency: text(label?.shipment_cost?.currency || 'usd', 8).toLowerCase(),
    status: labelStatus,
  });
  return {
    already_purchased: false,
    label_id: labelId,
    shipment_id: patch.shipstation_shipment_id,
    status: labelStatus,
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
    cost: patch.shipstation_cost,
    currency: text(label?.shipment_cost?.currency || 'usd', 8).toLowerCase(),
  };
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

  let order = await loadOrder(env, id);
  assertShippable(order);
  if (text(order.shipstation_label_id, 100) !== labelId) {
    throw new ShipStationError('shipstation_label_order_mismatch');
  }
  if (['label_voided', 'voided'].includes(text(order.shipstation_label_status, 40))) {
    await finalizeVoid(env, {
      orderId: id,
      labelId,
      actorId: text(context?.user?.id, 80) || null,
      reason,
      providerMessage: null,
    });
    return { already_voided: true, label_id: labelId, status: 'label_voided', refund_state: 'pending' };
  }
  if (VOID_BLOCKING_TRACKING_STATUSES.has(text(order.tracking_status, 40))) {
    throw new ShipStationError('shipstation_label_void_blocked');
  }

  const claimed = await claimVoid(env, id, labelId);
  if (!claimed) {
    order = await loadOrder(env, id);
    if (text(order?.shipstation_label_id, 100) === labelId
      && ['label_voided', 'voided'].includes(text(order?.shipstation_label_status, 40))) {
      await finalizeVoid(env, {
        orderId: id,
        labelId,
        actorId: text(context?.user?.id, 80) || null,
        reason,
        providerMessage: null,
      });
      return { already_voided: true, label_id: labelId, status: 'label_voided', refund_state: 'pending' };
    }
    throw new ShipStationError('shipstation_label_void_locked');
  }

  let provider;
  try {
    provider = await voidLabel(env, labelId);
  } catch (error) {
    await persistLabel(env, id, {
      shipstation_label_status: 'void_reconcile_required',
      shipstation_error: text(error?.code || 'shipstation_label_void_failed', 160),
    }).catch(() => {});
    throw error;
  }
  if (provider?.approved !== true) {
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
  return {
    already_voided: false,
    label_id: labelId,
    status: 'label_voided',
    refund_state: 'pending',
    message: providerMessage,
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
  const order = await loadOrder(env, id);
  assertShippable(order);
  if (!['purchasing', 'reconcile_required'].includes(text(order.shipstation_label_status, 40))) {
    throw new ShipStationError('shipstation_label_reconcile_not_required');
  }
  const shipmentId = providerId(order.shipstation_shipment_id, 'shipstation_shipment_required');
  const nowValue = dependencies.now ? dependencies.now() : new Date();
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (Number.isNaN(now.getTime())) throw new ShipStationError('shipstation_label_reconcile_window_invalid');
  const attempt = new Date(order.shipstation_updated_at || order.updated_at || order.created_at || now);
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
    shipstation_rate_id: text(order.shipstation_rate_id, 100) || null,
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
  return { reconciled: true, ...safeLabel(label), status: labelStatus };
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
  let order = await loadOrder(env, id);
  assertShippable(order);
  if (text(order.shipstation_label_id, 100) !== outboundLabelId) {
    throw new ShipStationError('shipstation_label_order_mismatch');
  }
  if (['label_voided', 'voided'].includes(text(order.shipstation_label_status, 40))) {
    throw new ShipStationError('shipstation_return_outbound_voided');
  }
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
  if (['return_purchasing', 'return_reconcile_required'].includes(text(order.shipstation_return_label_status, 40))) {
    throw new ShipStationError('shipstation_return_locked');
  }

  const claimed = await claimReturn(env, id, outboundLabelId);
  if (!claimed) {
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
  try {
    label = await createReturn(env, outboundLabelId, requestBody);
  } catch (error) {
    await persistReturn(env, id, {
      shipstation_return_label_status: 'return_reconcile_required',
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
    cost,
    currency,
    chargeEvent,
    actorId: context?.user?.id,
    reason,
  });
  await audit(env, context, 'shipstation_return_label_created', id, {
    outbound_label_id: outboundLabelId,
    return_label_id: returnLabelId,
    cost,
    currency,
    charge_event: chargeEvent,
    recognition_state: returnRecognitionState(chargeEvent),
    reason,
  });
  return {
    already_created: false,
    ...safeLabel(label),
    label_id: returnLabelId,
    outbound_label_id: outboundLabelId,
    status,
    recognition_state: returnRecognitionState(chargeEvent),
  };
}
