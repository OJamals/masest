// Authoritative ShipStation label ownership.
//
// `orders.shipstation_*` fields are deliberately absent from this module. They are a
// latest-action projection for staff convenience, not provider identity. Ownership comes
// from immutable order_provider_links joined to canonical order_shipments; financial state
// comes from append-only order_financial_entries.

const OUTBOUND_TYPES = new Set(['label']);
const RETURN_TYPES = new Set(['return_label']);
const VOID_STATES = new Set(['label_voided', 'voided']);
const TERMINAL_TRACKING = new Set(['shipped', 'delivered']);

function text(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function metadata(link) {
  return link?.metadata && typeof link.metadata === 'object' && !Array.isArray(link.metadata)
    ? link.metadata
    : {};
}

function activeShipments(order) {
  return (Array.isArray(order?.order_shipments) ? order.order_shipments : [])
    .filter((shipment) => shipment?.id && text(shipment.status, 40) !== 'cancelled');
}

function shipmentIndexes(order) {
  const shipments = activeShipments(order);
  return {
    shipments,
    byId: new Map(shipments.map((shipment) => [text(shipment.id, 80), shipment])),
    byProviderId: new Map(shipments
      .filter((shipment) => text(shipment.provider_shipment_id, 100))
      .map((shipment) => [text(shipment.provider_shipment_id, 100), shipment])),
  };
}

function owningShipment(link, indexes) {
  const detail = metadata(link);
  const explicitShipmentId = text(detail.order_shipment_id, 80);
  if (explicitShipmentId) return indexes.byId.get(explicitShipmentId) || null;
  return indexes.byProviderId.get(text(detail.shipment_id, 100)) || null;
}

function evidenceByLabel(order) {
  const result = new Map();
  for (const entry of Array.isArray(order?.order_financial_entries) ? order.order_financial_entries : []) {
    if (entry?.source !== 'shipstation') continue;
    const labelId = text(entry.provider_object_id, 255);
    if (!labelId) continue;
    if (!result.has(labelId)) result.set(labelId, []);
    result.get(labelId).push({
      entry_type: text(entry.entry_type, 80),
      amount: Number.isFinite(Number(entry.amount)) ? Number(entry.amount) : null,
      currency: text(entry.currency, 8).toLowerCase() || null,
      recognition_state: text(entry.recognition_state, 24) || null,
      created_at: text(entry.created_at, 80) || null,
    });
  }
  return result;
}

function financialSummary(entries, kind) {
  const preferred = kind === 'return'
    ? entries.find((entry) => entry.entry_type === 'postage_return_label')
    : entries.find((entry) => entry.entry_type === 'postage_purchase');
  return preferred || null;
}

function outboundRecord(order, link, shipment, evidence) {
  const detail = metadata(link);
  const labelId = text(link.provider_object_id, 255);
  const entries = evidence.get(labelId) || [];
  const voided = VOID_STATES.has(text(detail.status, 80))
    || entries.some((entry) => entry.entry_type === 'postage_void_requested');
  const finance = financialSummary(entries, 'outbound');
  return {
    kind: 'outbound',
    provider_link_id: text(link.id, 80) || null,
    order_id: text(order.id, 80),
    order_shipment_id: text(shipment.id, 80),
    split_key: text(shipment.split_key, 40) || 'default',
    label_id: labelId,
    parent_label_id: null,
    provider_shipment_id: text(detail.shipment_id || shipment.provider_shipment_id, 100) || null,
    revision: Number.isSafeInteger(Number(detail.revision)) ? Number(detail.revision) : null,
    status: text(detail.status, 80) || 'label_purchased',
    active: !voided,
    tracking_number: text(detail.tracking_number, 160) || null,
    tracking_status: text(detail.tracking_status, 40) || 'packing',
    tracking_occurred_at: text(detail.tracking_occurred_at, 80) || null,
    carrier: text(detail.carrier, 120) || null,
    cost: finance?.amount ?? (Number.isFinite(Number(detail.cost)) ? Number(detail.cost) : null),
    currency: text(finance?.currency || detail.currency, 8).toLowerCase() || null,
    financial_evidence: finance,
    financial_entries: entries,
  };
}

function returnRecord(order, link, parent, evidence) {
  const detail = metadata(link);
  const labelId = text(link.provider_object_id, 255);
  const entries = evidence.get(labelId) || [];
  const finance = financialSummary(entries, 'return');
  return {
    kind: 'return',
    provider_link_id: text(link.id, 80) || null,
    order_id: text(order.id, 80),
    order_shipment_id: parent.order_shipment_id,
    split_key: parent.split_key,
    label_id: labelId,
    parent_label_id: parent.label_id,
    provider_shipment_id: text(detail.shipment_id, 100) || null,
    revision: parent.revision,
    status: text(detail.status, 80) || 'return_label_created',
    active: !VOID_STATES.has(text(detail.status, 80)),
    tracking_number: text(detail.tracking_number, 160) || null,
    tracking_status: text(detail.tracking_status, 40) || null,
    tracking_occurred_at: text(detail.tracking_occurred_at, 80) || null,
    carrier: text(detail.carrier, 120) || null,
    charge_event: text(detail.charge_event, 40) || null,
    cost: finance?.amount ?? (Number.isFinite(Number(detail.cost)) ? Number(detail.cost) : null),
    currency: text(finance?.currency || detail.currency, 8).toLowerCase() || null,
    financial_evidence: finance,
    financial_entries: entries,
  };
}

export function shipmentLabelOwnership(order = {}) {
  const indexes = shipmentIndexes(order);
  const evidence = evidenceByLabel(order);
  const links = (Array.isArray(order?.order_provider_links) ? order.order_provider_links : [])
    .filter((link) => link?.provider === 'shipstation' && text(link.provider_object_id, 255));
  const outbound = [];
  const outboundById = new Map();

  for (const link of links) {
    if (!OUTBOUND_TYPES.has(text(link.object_type, 64))) continue;
    const shipment = owningShipment(link, indexes);
    if (!shipment) continue;
    const record = outboundRecord(order, link, shipment, evidence);
    outbound.push(record);
    outboundById.set(record.label_id, record);
  }

  const returns = [];
  for (const link of links) {
    if (!RETURN_TYPES.has(text(link.object_type, 64))) continue;
    const detail = metadata(link);
    const parent = outboundById.get(text(detail.outbound_label_id, 255));
    if (!parent) continue;
    const explicitShipmentId = text(detail.order_shipment_id, 80);
    if (explicitShipmentId && explicitShipmentId !== parent.order_shipment_id) continue;
    returns.push(returnRecord(order, link, parent, evidence));
  }

  return {
    order_id: text(order.id, 80) || null,
    shipments: indexes.shipments,
    outbound,
    returns,
    labels: [...outbound, ...returns],
  };
}

export function resolveShipmentLabel(order, labelId, { kind = null, requireActive = false } = {}) {
  const wanted = text(labelId, 255);
  if (!wanted) return null;
  const label = shipmentLabelOwnership(order).labels.find((entry) => entry.label_id === wanted) || null;
  if (!label || (kind && label.kind !== kind) || (requireActive && !label.active)) return null;
  return label;
}

export function activeOutboundShipmentLabels(order) {
  return shipmentLabelOwnership(order).outbound
    .filter((label) => label.active)
    .sort((left, right) => (
      left.order_shipment_id.localeCompare(right.order_shipment_id)
      || left.label_id.localeCompare(right.label_id)
    ));
}

export function requiredOutboundLabelVoids(order) {
  return activeOutboundShipmentLabels(order).map((label) => ({
    order_id: label.order_id,
    order_shipment_id: label.order_shipment_id,
    label_id: label.label_id,
    provider_link_id: label.provider_link_id,
    tracking_status: label.tracking_status,
    effect_key: `shipstation-label-void:${label.order_id}:${label.label_id}`,
  }));
}

export function deriveOrderFulfillment(order) {
  const ownership = shipmentLabelOwnership(order);
  const required = ownership.shipments;
  const pending = [];
  let anyLabel = false;
  let anyBlocked = false;
  let allDelivered = required.length > 0;

  for (const shipment of required) {
    const shipmentId = text(shipment.id, 80);
    const labels = ownership.outbound.filter((label) => (
      label.active && label.order_shipment_id === shipmentId
    ));
    anyLabel ||= labels.length > 0;
    anyBlocked ||= labels.some((label) => label.tracking_status === 'blocked');
    const terminal = labels.length > 0
      && labels.every((label) => TERMINAL_TRACKING.has(label.tracking_status));
    if (!terminal) pending.push(shipmentId);
    if (!labels.length || labels.some((label) => label.tracking_status !== 'delivered')) {
      allDelivered = false;
    }
  }

  const complete = required.length > 0 && pending.length === 0;
  const trackingStatus = allDelivered
    ? 'delivered'
    : anyBlocked
      ? 'blocked'
      : complete
        ? 'shipped'
        : anyLabel
          ? 'packing'
          : 'processing';

  return {
    complete,
    tracking_status: trackingStatus,
    required_shipment_ids: required.map((shipment) => text(shipment.id, 80)),
    pending_shipment_ids: pending,
  };
}
