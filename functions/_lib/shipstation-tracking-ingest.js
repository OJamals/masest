import { ingestProviderEvent } from './integration-effects.js';
import { adminClient } from './supabase.js';
import { canonicalShipStationTrackingUpdate } from './shipstation-tracking.js';

export async function ingestShipStationTrackingUpdate(env, update, dependencies = {}) {
  const canonical = canonicalShipStationTrackingUpdate(update);
  const ingest = dependencies.ingestProviderEvent || ingestProviderEvent;
  const sb = dependencies.sb || adminClient(env);
  return ingest(sb, {
    provider: 'shipstation',
    environmentOrTenant: 'production',
    providerEventId: `canonical:v2:${update.event_key}`,
    providerEventType: 'track',
    providerObjectId: update.tracking_number,
    occurredAt: update.occurred_at,
    metadata: { source: 'shipstation_tracking', schema_version: 2, digest_basis: 'canonical_tracking_v2' },
  }, canonical, [{
    effect_key: 'tracking-projection',
    effect_type: 'shipstation_tracking_projection',
    aggregate_type: 'shipment',
    aggregate_id: update.tracking_number,
    payload: update,
    max_attempts: 3,
  }]);
}
