let mapsLoader;
let configLoader;

function component(components, type, short = false) {
  const item = (components || []).find((part) => part.types?.includes(type));
  return String((short ? item?.shortText : item?.longText) || '').trim();
}

export function addressFromPlace(place = {}) {
  const components = Array.isArray(place.addressComponents) ? place.addressComponents : [];
  const streetNumber = component(components, 'street_number');
  const route = component(components, 'route');
  const formattedLine = String(place.formattedAddress || '').split(',')[0].trim();
  const postalCode = component(components, 'postal_code');
  const postalSuffix = component(components, 'postal_code_suffix');
  return {
    line1: [streetNumber, route].filter(Boolean).join(' ') || formattedLine,
    line2: component(components, 'subpremise'),
    city: component(components, 'locality')
      || component(components, 'postal_town')
      || component(components, 'sublocality_level_1'),
    state: component(components, 'administrative_area_level_1', true).toUpperCase(),
    zip: postalSuffix ? `${postalCode}-${postalSuffix}` : postalCode,
    country: component(components, 'country', true).toUpperCase(),
  };
}

export function fillAddressFields(fields, address) {
  for (const [name, field] of Object.entries(fields || {})) {
    if (!field || !(name in address)) continue;
    field.value = address[name] || '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

async function loadConfig(fetchImpl = fetch) {
  if (!configLoader) {
    configLoader = fetchImpl('/api/address-autocomplete-config', { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : { enabled: false })
      .catch(() => ({ enabled: false }));
  }
  return configLoader;
}

function loadGoogleMaps(apiKey) {
  if (globalThis.google?.maps?.importLibrary) return Promise.resolve(globalThis.google.maps);
  if (mapsLoader) return mapsLoader;
  mapsLoader = new Promise((resolve, reject) => {
    const callback = `__masestGoogleMapsReady${Date.now()}`;
    const script = document.createElement('script');
    const cleanup = () => { delete globalThis[callback]; };
    globalThis[callback] = () => {
      cleanup();
      resolve(globalThis.google.maps);
    };
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&v=weekly&callback=${callback}`;
    script.async = true;
    script.onerror = () => {
      cleanup();
      mapsLoader = null;
      reject(new Error('google_maps_load_failed'));
    };
    document.head.appendChild(script);
  });
  return mapsLoader;
}

export async function mountAddressAutocomplete({ mount, fields, fetchImpl } = {}) {
  if (!mount) return { enabled: false };
  const config = await loadConfig(fetchImpl);
  if (!config.enabled || !config.api_key) return { enabled: false };
  await loadGoogleMaps(config.api_key);
  const { PlaceAutocompleteElement } = await globalThis.google.maps.importLibrary('places');
  const autocomplete = new PlaceAutocompleteElement();
  autocomplete.includedRegionCodes = config.included_region_codes || ['us'];
  autocomplete.placeholder = 'Start typing a U.S. street address';
  autocomplete.setAttribute('aria-label', 'Find a street address');
  autocomplete.addEventListener('gmp-select', async (event) => {
    try {
      const place = event.placePrediction.toPlace();
      await place.fetchFields({ fields: ['addressComponents', 'formattedAddress'] });
      const address = addressFromPlace(place);
      if (address.country && address.country !== 'US') return;
      fillAddressFields(fields, address);
      mount.dataset.state = 'selected';
    } catch {
      mount.dataset.state = 'error';
    }
  });
  mount.replaceChildren(autocomplete);
  mount.hidden = false;
  return { enabled: true, autocomplete };
}
