// Browser configuration for Google Places autocomplete. This key is intentionally
// client-visible and must be restricted to MASEST HTTPS referrers + required APIs.
import { json } from '../_lib/supabase.js';

export function addressAutocompleteConfig(env = {}) {
  const apiKey = String(env.GC_AUTOCOMPLETE_API_KEY || '').trim();
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(apiKey)) return { enabled: false };
  return {
    enabled: true,
    api_key: apiKey,
    included_region_codes: ['us'],
  };
}

export async function onRequestGet({ env }) {
  return json(200, addressAutocompleteConfig(env), {
    'cache-control': 'private, max-age=300',
    'x-content-type-options': 'nosniff',
  });
}
