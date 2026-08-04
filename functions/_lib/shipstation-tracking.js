function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function isoOrNull(value) {
  const raw = text(value, 80);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function trackingStatus(code) {
  const normalized = text(code, 20).toUpperCase();
  if (normalized === 'DE') return 'delivered';
  if (normalized === 'EX') return 'blocked';
  if (['AC', 'AT', 'NY'].includes(normalized)) return 'packing';
  return normalized ? 'shipped' : null;
}

function newestEvent(events) {
  return (Array.isArray(events) ? events : [])
    .map((event) => ({
      occurred_at: isoOrNull(event?.occurred_at || event?.carrier_occurred_at),
      event_code: text(event?.event_code || event?.code, 40).toUpperCase() || null,
      description: text(event?.description, 500),
    }))
    .filter((event) => event.occurred_at)
    .sort((left, right) => (
      right.occurred_at.localeCompare(left.occurred_at)
      || String(right.event_code || '').localeCompare(String(left.event_code || ''))
      || right.description.localeCompare(left.description)
    ))[0] || {};
}

export function canonicalShipStationTrackingUpdate(update) {
  return JSON.stringify({
    version: 2,
    tracking_number: update.tracking_number,
    tracking_status: update.tracking_status,
    status_code: update.status_code,
    event_code: update.event_code,
    occurred_at: update.occurred_at,
    note: update.note,
    estimated_delivery_at: update.estimated_delivery_at,
  });
}

// Accepts both API_TRACK webhook envelopes and direct GET label/tracking responses.
export async function normalizeShipStationTrackingUpdate(payload) {
  const data = payload?.resource_type === 'API_TRACK' ? payload?.data : payload;
  if (!data || typeof data !== 'object') return null;
  const trackingNumber = text(data.tracking_number, 160);
  const statusCode = text(data.status_code, 20).toUpperCase();
  const status = trackingStatus(statusCode);
  if (!trackingNumber || !status) return null;
  const latest = newestEvent(data.events);
  const occurredAt = latest.occurred_at || isoOrNull(data.actual_delivery_date);
  const estimatedDelivery = isoOrNull(data.estimated_delivery_date);
  const update = {
    tracking_number: trackingNumber,
    tracking_status: status,
    status_code: statusCode,
    event_code: latest.event_code || null,
    occurred_at: occurredAt,
    note: text(data.status_description || latest.description || statusCode, 500),
    estimated_delivery_at: estimatedDelivery,
  };
  return {
    ...update,
    event_key: await sha256(canonicalShipStationTrackingUpdate(update)),
  };
}
