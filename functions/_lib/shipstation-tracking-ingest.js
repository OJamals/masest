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
  }, {
    // The projection owns the state transition; this effect owns telling the buyer about
    // it. Splitting them means a Resend outage retries the email without re-applying the
    // status, and the projection's own result decides whether an email is warranted at all
    // (unmatched order, stale scan, repeated in-transit ping → skipped).
    effect_key: 'shipment-notification',
    effect_type: 'shipment_notification',
    aggregate_type: 'shipment',
    aggregate_id: update.tracking_number,
    depends_on_effect_key: 'tracking-projection',
    payload: {
      tracking_number: update.tracking_number,
      tracking_status: update.tracking_status,
    },
    max_attempts: 5,
  }]);
}
