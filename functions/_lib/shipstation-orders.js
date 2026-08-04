import { adminClient } from './supabase.js';
import { recordAudit } from './audit.js';
import {
  ShipStationError,
  buildRateRequest,
  shipStationRequest,
} from './shipstation.js';

const SHIPPABLE_STATUSES = new Set(['paid', 'net_open', 'net_paid', 'fulfilled']);

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
    label_url: text(order?.shipstation_label_url, 1000) || null,
    tracking_number: text(order?.tracking_number, 160) || null,
    tracking_url: text(order?.tracking_url, 1000) || null,
  };
}

async function defaultLoadOrder(env, id) {
  const { data, error } = await adminClient(env).from('orders')
    .select('id,status,customer_email,currency,ship_address,shipstation_shipment_id,shipstation_label_id,shipstation_label_status,shipstation_label_url,tracking_number,tracking_url,order_items(sku,name,qty,unit_price)')
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

async function defaultPersistLabel(env, id, patch) {
  const { error } = await adminClient(env).from('orders')
    .update({ ...patch, shipstation_updated_at: new Date().toISOString() })
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

function assertShippable(order) {
  if (!order) throw new ShipStationError('shipping_order_not_found');
  if (!SHIPPABLE_STATUSES.has(text(order.status, 40))) {
    throw new ShipStationError('shipping_order_not_shippable');
  }
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
  let order = await loadOrder(env, id);
  assertShippable(order);
  if (order.shipstation_label_id) return existingLabel(order);
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
    if (order?.shipstation_label_id) return existingLabel(order);
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
    label_url: labelUrl,
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
    cost: patch.shipstation_cost,
    currency: text(label?.shipment_cost?.currency || 'usd', 8).toLowerCase(),
  };
}
