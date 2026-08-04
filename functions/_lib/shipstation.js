import { orderReference } from './order-integrations.js';
import { normalizeShipStationTrackingUpdate } from './shipstation-tracking.js';
import { ingestShipStationTrackingUpdate } from './shipstation-tracking-ingest.js';

const API_BASE_URL = 'https://api.shipstation.com/v2';

function text(value) {
  return String(value || '').trim();
}

export class ShipStationError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'ShipStationError';
    this.code = code;
    this.status = status;
  }
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function hasPackagePrecision(value) {
  return Math.abs((value * 1000) - Math.round(value * 1000)) < 1e-7;
}

export function normalizePackages(input) {
  if (!Array.isArray(input) || !input.length) {
    throw new ShipStationError('shipping_packages_required');
  }
  if (input.length > 20) throw new ShipStationError('too_many_shipping_packages');
  return input.map((raw) => {
    const value = positiveNumber(raw?.weight?.value ?? raw?.weight ?? raw?.weight_value);
    const unit = text(raw?.weight?.unit || raw?.unit || raw?.weight_unit || 'pound').toLowerCase();
    if (!value || value > 10_000 || !hasPackagePrecision(value)
      || !['pound', 'ounce', 'gram', 'kilogram'].includes(unit)) {
      throw new ShipStationError('invalid_package_weight');
    }
    const dimensions = [
      raw?.dimensions?.length ?? raw?.length,
      raw?.dimensions?.width ?? raw?.width,
      raw?.dimensions?.height ?? raw?.height,
    ].map(positiveNumber);
    const hasAnyDimension = dimensions.some(Boolean);
    if (hasAnyDimension && dimensions.some((dimension) => !dimension || dimension > 1_000 || !hasPackagePrecision(dimension))) {
      throw new ShipStationError('invalid_package_dimensions');
    }
    return {
      package_code: 'package',
      weight: { value, unit },
      ...(hasAnyDimension ? {
        dimensions: {
          unit: 'inch',
          length: dimensions[0],
          width: dimensions[1],
          height: dimensions[2],
        },
      } : {}),
    };
  });
}

function stripeShipTo(order, overrides = {}) {
  const root = order?.ship_address || {};
  const address = root.address || root;
  const required = {
    name: text(root.name || address.name),
    phone: text(overrides.phone || root.phone || address.phone),
    address_line1: text(address.line1 || address.address_line1),
    city_locality: text(address.city || address.city_locality),
    state_province: text(address.state || address.state_province),
    postal_code: text(address.postal_code),
    country_code: text(address.country || address.country_code || 'US').toUpperCase(),
  };
  if (!required.name) throw new ShipStationError('shipping_name_required');
  if (!required.phone) throw new ShipStationError('shipping_phone_required');
  if (!required.address_line1 || !required.city_locality || !required.state_province || !required.postal_code) {
    throw new ShipStationError('shipping_address_incomplete');
  }
  return {
    ...required,
    email: text(order?.customer_email) || null,
    ...(text(address.line2 || address.address_line2)
      ? { address_line2: text(address.line2 || address.address_line2) }
      : {}),
    address_residential_indicator: ['yes', 'no'].includes(text(overrides.residential).toLowerCase())
      ? text(overrides.residential).toLowerCase()
      : 'unknown',
  };
}

export function buildRateRequest({ order, packages, warehouseId, carrierIds, phone, residential }) {
  const warehouse = text(warehouseId);
  const carriers = [...new Set((carrierIds || []).map(text).filter(Boolean))];
  if (!warehouse) throw new ShipStationError('shipstation_warehouse_required');
  if (!carriers.length) throw new ShipStationError('shipstation_carriers_required');
  const normalizedPackages = normalizePackages(packages);
  const reference = text(orderReference(order));
  if (!reference) throw new ShipStationError('shipping_order_required');
  const currency = text(order?.currency || 'usd').toLowerCase();
  return {
    rate_options: { carrier_ids: carriers },
    shipment: {
      validate_address: 'validate_and_clean',
      shipment_number: reference.slice(0, 50),
      warehouse_id: warehouse,
      ship_to: stripeShipTo(order, { phone, residential }),
      packages: normalizedPackages,
      items: (order?.order_items || []).map((item) => ({
        sku: text(item?.sku),
        name: text(item?.name || item?.sku),
        quantity: Math.max(1, Math.floor(Number(item?.qty) || 1)),
        unit_price: { currency, amount: Number(item?.unit_price) || 0 },
      })),
      confirmation: 'none',
      insurance_provider: 'none',
    },
  };
}

export function shipStationConfig(env = {}) {
  const apiKey = text(env.SHIPSTATION_API_KEY);
  const warehouseId = text(env.SHIPSTATION_WAREHOUSE_ID);
  const webhookToken = text(env.SHIPSTATION_WEBHOOK_TOKEN);
  return {
    api_key: apiKey ? 'present' : 'missing',
    warehouse_id: warehouseId || null,
    webhook_token: webhookToken ? 'present' : 'missing',
    ready: Boolean(apiKey && warehouseId),
  };
}

export async function shipStationRequest(env, path, options = {}, dependencies = {}) {
  const apiKey = text(env?.SHIPSTATION_API_KEY);
  if (!apiKey) throw new ShipStationError('shipstation_not_configured');
  const route = `/${text(path).replace(/^\/+/, '')}`;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const response = await fetchImpl(`${API_BASE_URL}${route}`, {
    method: options.method || 'GET',
    headers: {
      'API-Key': apiKey,
      accept: 'application/json',
      ...(options.body == null ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body == null ? {} : { body: JSON.stringify(options.body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ShipStationError(`shipstation_http_${response.status}`, response.status);
  return payload;
}

export async function fetchShipStationLabelTracking(env, labelId, dependencies = {}) {
  const id = text(labelId);
  if (!/^se-[a-z0-9-]+$/i.test(id)) throw new ShipStationError('shipstation_label_required');
  const request = dependencies.request || shipStationRequest;
  const payload = await request(env, `/labels/${encodeURIComponent(id)}/track`, {}, dependencies);
  const update = await normalizeShipStationTrackingUpdate(payload);
  if (!update) throw new ShipStationError('shipstation_tracking_response_invalid');
  const ingest = dependencies.ingestTracking || ingestShipStationTrackingUpdate;
  const result = await ingest(env, update, dependencies);
  if (result?.error) throw result.error;
  return update;
}

function carrierSummary(carrier) {
  return {
    carrier_id: text(carrier?.carrier_id),
    carrier_code: text(carrier?.carrier_code),
    name: text(carrier?.friendly_name || carrier?.nickname || carrier?.carrier_code || 'Carrier'),
  };
}

function warehouseSummary(warehouse) {
  return {
    warehouse_id: text(warehouse?.warehouse_id),
    name: text(warehouse?.name || warehouse?.warehouse_name || 'Warehouse'),
  };
}

function webhookUrl(env = {}) {
  const appUrl = text(env.APP_URL).replace(/\/+$/, '');
  return appUrl ? `${appUrl}/api/shipstation-webhook` : null;
}

function webhookList(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.webhooks) ? payload.webhooks : [];
}

function webhookSummary(env, payload) {
  const url = webhookUrl(env);
  const token = text(env.SHIPSTATION_WEBHOOK_TOKEN);
  const endpoint = webhookList(payload).find((item) => item?.event === 'track' && text(item?.url) === url);
  const headers = Array.isArray(endpoint?.headers) ? endpoint.headers : [];
  const authHeader = headers.find((header) => text(header?.key).toLowerCase() === 'x-masest-webhook-token');
  const returnedValue = text(authHeader?.value);
  const headerReady = Boolean(endpoint && token && returnedValue === token);
  // ShipStation's list response currently omits headers or replaces their values with
  // a short mask. Preserve the distinction: list proves registration, not secret parity.
  const providerMasked = Boolean(endpoint && token && (
    headers.length === 0
    || (authHeader && token.length >= 20 && returnedValue !== token && returnedValue.length <= 8)
  ));
  return {
    url,
    registered: Boolean(endpoint),
    authenticated: headerReady,
    authentication: headerReady ? 'verified' : providerMasked ? 'provider_masked' : 'missing_or_mismatch',
    ready: Boolean(endpoint && (headerReady || providerMasked)),
  };
}

export async function configureShipStationTrackingWebhook(env, dependencies = {}) {
  const token = text(env?.SHIPSTATION_WEBHOOK_TOKEN);
  const url = webhookUrl(env);
  if (!text(env?.SHIPSTATION_API_KEY)) throw new ShipStationError('shipstation_not_configured');
  if (!token) throw new ShipStationError('shipstation_webhook_token_required');
  if (!url) throw new ShipStationError('app_url_not_configured');
  const request = dependencies.request || shipStationRequest;
  const existingPayload = await request(env, '/environment/webhooks', {}, dependencies);
  const existing = webhookList(existingPayload).find((item) => item?.event === 'track');
  const body = {
    name: 'MASEST tracking updates',
    event: 'track',
    url,
    headers: [{ key: 'X-MASEST-Webhook-Token', value: token }],
  };
  const provider = existing?.webhook_id
    ? await request(env, `/environment/webhooks/${encodeURIComponent(existing.webhook_id)}`, {
      method: 'PUT',
      body: { name: body.name, url: body.url, headers: body.headers },
    }, dependencies)
    : await request(env, '/environment/webhooks', { method: 'POST', body }, dependencies);
  return {
    configured: true,
    created: !existing?.webhook_id,
    webhook_id: text(provider?.webhook_id || existing?.webhook_id) || null,
    event: 'track',
    url,
  };
}

export async function shipStationStatus(env, dependencies = {}) {
  const config = shipStationConfig(env);
  if (config.api_key === 'missing') {
    return { connected: false, ready: false, warehouse_match: false, config, carriers: [], warehouses: [] };
  }
  const request = dependencies.request || shipStationRequest;
  const [carrierPayload, warehousePayload, webhookPayload] = await Promise.all([
    request(env, '/carriers', {}, dependencies),
    request(env, '/warehouses', {}, dependencies),
    request(env, '/environment/webhooks', {}, dependencies),
  ]);
  const carriers = (carrierPayload?.carriers || carrierPayload || [])
    .map(carrierSummary)
    .filter((carrier) => carrier.carrier_id);
  const warehouses = (warehousePayload?.warehouses || warehousePayload || [])
    .map(warehouseSummary)
    .filter((warehouse) => warehouse.warehouse_id);
  const warehouseMatch = warehouses.some((warehouse) => warehouse.warehouse_id === config.warehouse_id);
  return {
    connected: true,
    ready: Boolean(config.ready && warehouseMatch && carriers.length),
    warehouse_match: warehouseMatch,
    config,
    carriers,
    warehouses,
    webhook: webhookSummary(env, webhookPayload),
  };
}
