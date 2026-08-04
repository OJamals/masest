import { requireStaff, json, readBody } from '../../_lib/supabase.js';
import { staffCan } from '../../_lib/authz.js';
import {
  configureShipStationTrackingWebhook,
  ShipStationError,
  shipStationStatus,
} from '../../_lib/shipstation.js';
import {
  buyOrderLabel,
  createOrderReturnLabel,
  downloadOrderLabel,
  getOrderLabel,
  rateOrderShipment,
  reconcileOrderLabelPurchase,
  voidOrderLabel,
} from '../../_lib/shipstation-orders.js';

const LABEL_GET_ACTIONS = new Set(['label', 'label_document']);

function isLabelGet(request) {
  if (request.method !== 'GET') return false;
  return LABEL_GET_ACTIONS.has(new URL(request.url).searchParams.get('action'));
}

function noStore(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function errorResponse(error, cacheSafe = false) {
  const code = error?.code || 'shipstation_request_failed';
  const status = error?.status >= 400 ? 502 : 400;
  const response = json(status, { error: code });
  return cacheSafe ? noStore(response) : response;
}

export function createShipStationAdminHandler(dependencies = {}) {
  const requireStaffImpl = dependencies.requireStaff || requireStaff;
  const statusImpl = dependencies.status || shipStationStatus;
  const rateOrderImpl = dependencies.rateOrder || rateOrderShipment;
  const buyLabelImpl = dependencies.buyLabel || buyOrderLabel;
  const voidLabelImpl = dependencies.voidLabel || voidOrderLabel;
  const getLabelImpl = dependencies.getLabel || getOrderLabel;
  const downloadLabelImpl = dependencies.downloadLabel || downloadOrderLabel;
  const reconcileLabelImpl = dependencies.reconcileLabel || reconcileOrderLabelPurchase;
  const returnLabelImpl = dependencies.returnLabel || createOrderReturnLabel;
  const configureWebhookImpl = dependencies.configureWebhook || configureShipStationTrackingWebhook;

  return async function shipStationAdminHandler({ request, env }) {
    const cacheSafe = isLabelGet(request);
    let auth;
    try {
      auth = await requireStaffImpl(request, env);
    } catch (error) {
      return errorResponse(error, cacheSafe);
    }
    const { user, staff, role } = auth;
    if (!user) return json(401, { error: 'unauthenticated' }, cacheSafe ? { 'cache-control': 'no-store' } : {});
    if (!staff) return json(403, { error: 'forbidden' }, cacheSafe ? { 'cache-control': 'no-store' } : {});
    return handleShipStationRequest({ request, env, user, role }, {
      status: statusImpl,
      rateOrder: rateOrderImpl,
      buyLabel: buyLabelImpl,
      voidLabel: voidLabelImpl,
      getLabel: getLabelImpl,
      downloadLabel: downloadLabelImpl,
      reconcileLabel: reconcileLabelImpl,
      returnLabel: returnLabelImpl,
      configureWebhook: configureWebhookImpl,
    });
  };
}

async function handleShipStationRequest({ request, env, user, role }, dependencies) {
  const cacheSafe = isLabelGet(request);
  try {
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      const action = params.get('action');
      if (!LABEL_GET_ACTIONS.has(action)) return json(200, await dependencies.status(env));
      if (!staffCan(role, 'order.read')) return noStore(json(403, { error: 'forbidden' }));
      const input = {
        order_id: params.get('order_id'),
        label_id: params.get('label_id'),
        format: params.get('format'),
      };
      if (action === 'label') return noStore(json(200, await dependencies.getLabel(env, input, { user, role })));
      return noStore(await dependencies.downloadLabel(env, input, { user, role }));
    }
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!staffCan(role, 'order.write')) return json(403, { error: 'forbidden' });
    const body = await readBody(request);
    if (body.action === 'configure_tracking_webhook' && !staffCan(role, 'integration.configure')) {
      return json(403, { error: 'forbidden' });
    }
    if (body.action === 'rates') return json(200, await dependencies.rateOrder(env, body, { user, role }));
    if (body.action === 'buy_label') return json(200, await dependencies.buyLabel(env, body, { user, role }));
    if (body.action === 'void_label') return json(200, await dependencies.voidLabel(env, body, { user, role }));
    if (body.action === 'reconcile_label_purchase') {
      return json(200, await dependencies.reconcileLabel(env, body, { user, role }));
    }
    if (body.action === 'return_label') return json(200, await dependencies.returnLabel(env, body, { user, role }));
    if (body.action === 'configure_tracking_webhook') {
      return json(200, await dependencies.configureWebhook(env, { user, role }));
    }
    return json(400, { error: 'invalid_action' });
  } catch (error) {
    return errorResponse(error, cacheSafe);
  }
}

export async function onRequest({ request, env }) {
  const cacheSafe = isLabelGet(request);
  let auth;
  try {
    auth = await requireStaff(request, env);
  } catch (error) {
    return errorResponse(error, cacheSafe);
  }
  const { user, staff, role } = auth;
  if (!user) return json(401, { error: 'unauthenticated' }, cacheSafe ? { 'cache-control': 'no-store' } : {});
  if (!staff) return json(403, { error: 'forbidden' }, cacheSafe ? { 'cache-control': 'no-store' } : {});
  return handleShipStationRequest({ request, env, user, role }, {
    status: shipStationStatus,
    rateOrder: rateOrderShipment,
    buyLabel: buyOrderLabel,
    voidLabel: voidOrderLabel,
    getLabel: getOrderLabel,
    downloadLabel: downloadOrderLabel,
    reconcileLabel: reconcileOrderLabelPurchase,
    returnLabel: createOrderReturnLabel,
    configureWebhook: configureShipStationTrackingWebhook,
  });
}
