import { requireStaff, json, readBody } from '../../_lib/supabase.js';
import { staffCan } from '../../_lib/authz.js';
import {
  configureShipStationTrackingWebhook,
  ShipStationError,
  shipStationStatus,
} from '../../_lib/shipstation.js';
import { buyOrderLabel, rateOrderShipment, voidOrderLabel } from '../../_lib/shipstation-orders.js';

function errorResponse(error) {
  const code = error?.code || 'shipstation_request_failed';
  const status = error?.status >= 400 ? 502 : 400;
  return json(status, { error: code });
}

export function createShipStationAdminHandler(dependencies = {}) {
  const requireStaffImpl = dependencies.requireStaff || requireStaff;
  const statusImpl = dependencies.status || shipStationStatus;
  const rateOrderImpl = dependencies.rateOrder || rateOrderShipment;
  const buyLabelImpl = dependencies.buyLabel || buyOrderLabel;
  const voidLabelImpl = dependencies.voidLabel || voidOrderLabel;
  const configureWebhookImpl = dependencies.configureWebhook || configureShipStationTrackingWebhook;

  return async function shipStationAdminHandler({ request, env }) {
    const { user, staff, role } = await requireStaffImpl(request, env);
    if (!user) return json(401, { error: 'unauthenticated' });
    if (!staff) return json(403, { error: 'forbidden' });
    return handleShipStationRequest({ request, env, user, role }, {
      status: statusImpl,
      rateOrder: rateOrderImpl,
      buyLabel: buyLabelImpl,
      voidLabel: voidLabelImpl,
      configureWebhook: configureWebhookImpl,
    });
  };
}

async function handleShipStationRequest({ request, env, user, role }, dependencies) {
  try {
    if (request.method === 'GET') return json(200, await dependencies.status(env));
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!staffCan(role, 'order.write')) return json(403, { error: 'forbidden' });
    const body = await readBody(request);
    if (body.action === 'configure_tracking_webhook' && !staffCan(role, 'integration.configure')) {
      return json(403, { error: 'forbidden' });
    }
    if (body.action === 'rates') return json(200, await dependencies.rateOrder(env, body, { user, role }));
    if (body.action === 'buy_label') return json(200, await dependencies.buyLabel(env, body, { user, role }));
    if (body.action === 'void_label') return json(200, await dependencies.voidLabel(env, body, { user, role }));
    if (body.action === 'configure_tracking_webhook') {
      return json(200, await dependencies.configureWebhook(env, { user, role }));
    }
    return json(400, { error: 'invalid_action' });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  return handleShipStationRequest({ request, env, user, role }, {
    status: shipStationStatus,
    rateOrder: rateOrderShipment,
    buyLabel: buyOrderLabel,
    voidLabel: voidOrderLabel,
    configureWebhook: configureShipStationTrackingWebhook,
  });
}
