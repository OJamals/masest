function timingSafeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function isoOrNull(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function clean(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

export async function verifyQboWebhookSignature(verifierToken, signature, rawBody) {
  if (!verifierToken || !signature) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(String(verifierToken)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
    return timingSafeEqual(signature, expected);
  } catch {
    return false;
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalQboChange(event) {
  return JSON.stringify({
    version: 2,
    realm_id: event.realm_id,
    entity_name: event.entity_name,
    entity_id: event.entity_id,
    operation: event.operation,
    occurred_at: event.occurred_at,
  });
}

function cloudEventChange(event) {
  const type = clean(event?.type, 160);
  const match = type.toLowerCase().match(/^qbo\.([a-z][a-z0-9_-]{0,79})\.([a-z][a-z0-9_-]{0,39})\.v[0-9]+$/);
  const entityName = match?.[1] || '';
  const operation = match?.[2] || '';
  return {
    event_id: clean(event?.id, 512),
    event_type: type,
    realm_id: clean(event?.intuitaccountid || event?.realmId || event?.data?.realm_id, 110),
    entity_name: entityName,
    entity_id: clean(event?.intuitentityid || event?.data?.intuitentityid || event?.data?.id, 255),
    operation,
    occurred_at: isoOrNull(event?.time || event?.data?.lastUpdated),
  };
}

async function legacyChanges(payload) {
  const changes = [];
  for (const notification of payload?.eventNotifications || []) {
    const realmId = clean(notification?.realmId, 110);
    for (const entity of notification?.dataChangeEvent?.entities || []) {
      const occurredAt = isoOrNull(entity?.lastUpdated);
      const entityName = clean(entity?.name, 80).toLowerCase();
      const entityId = clean(entity?.id, 255);
      const operation = clean(entity?.operation, 40).toLowerCase();
      const change = {
        event_id: '',
        event_type: `legacy.${entityName}.${operation}`.slice(0, 160),
        realm_id: realmId,
        entity_name: entityName,
        entity_id: entityId,
        operation,
        occurred_at: occurredAt,
      };
      change.event_id = `legacy:v2:${await sha256(canonicalQboChange(change))}`;
      changes.push(change);
    }
  }
  return changes;
}

export async function normalizeQboWebhookEvents(payload) {
  const candidates = Array.isArray(payload)
    ? payload.map(cloudEventChange)
    : await legacyChanges(payload);
  const valid = candidates.filter((event) => (
    event.event_id
    && event.event_type
    && event.realm_id
    && event.entity_name
    && event.entity_id
    && event.operation
  ));
  return [...new Map(valid.map((event) => [event.event_id, event])).values()];
}
