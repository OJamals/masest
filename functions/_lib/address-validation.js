import { ProviderTimeoutError, fetchWithDeadline } from './provider-fetch.js';

const ENDPOINT = 'https://addressvalidation.googleapis.com/v1:validateAddress';
const DELIVERABLE_GRANULARITY = new Set(['PREMISE', 'SUB_PREMISE']);

export class AddressValidationError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.name = 'AddressValidationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function clean(value, max = 160) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (normalized.length > max || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new AddressValidationError('address_invalid');
  }
  return normalized;
}

function normalizedInput(value) {
  const address = {
    ...value,
    address1: clean(value?.address1, 160),
    address2: clean(value?.address2, 160),
    city: clean(value?.city, 100),
    state: clean(value?.state, 2).toUpperCase(),
    postal_code: clean(value?.postal_code, 10).toUpperCase(),
    country: clean(value?.country || 'US', 2).toUpperCase(),
  };
  if (!address.address1 || !address.city || !/^[A-Z]{2}$/.test(address.state)
    || !/^\d{5}(?:-\d{4})?$/.test(address.postal_code) || address.country !== 'US') {
    throw new AddressValidationError('address_incomplete');
  }
  return address;
}

function comparable(address) {
  return [address.address1, address.address2, address.city, address.state, address.postal_code, address.country]
    .map((value) => clean(value).toUpperCase()).join('|');
}

function standardizedAddress(input, result) {
  const postal = result?.address?.postalAddress;
  const lines = Array.isArray(postal?.addressLines) ? postal.addressLines : [];
  const residential = result?.metadata?.residential;
  return normalizedInput({
    ...input,
    address1: lines[0] || input.address1,
    address2: lines.slice(1).join(', ') || input.address2,
    city: postal?.locality || input.city,
    state: postal?.administrativeArea || input.state,
    postal_code: postal?.postalCode || input.postal_code,
    country: postal?.regionCode || input.country,
    ...(typeof residential === 'boolean' ? { residential } : {}),
  });
}

export async function validateGoogleAddress(value, env = {}, dependencies = {}) {
  const input = normalizedInput(value);
  const key = clean(env.GC_ADDRESS_VALIDATION_API_KEY || env.GC_AUTOCOMPLETE_API_KEY, 256);
  if (!key) throw new AddressValidationError('address_validation_not_configured', 503);
  const fetchImpl = dependencies.fetchImpl || fetch;
  let referer = 'https://masest.co/';
  try { referer = `${new URL(env.APP_URL || referer).origin}/`; } catch { /* use canonical production origin */ }
  let response;
  let payload;
  try {
    ({ response, payload } = await fetchWithDeadline(fetchImpl, `${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: referer },
      body: JSON.stringify({
        address: {
          regionCode: input.country,
          administrativeArea: input.state,
          locality: input.city,
          postalCode: input.postal_code,
          addressLines: [input.address1, input.address2].filter(Boolean),
        },
        enableUspsCass: true,
      }),
    }, {
      timeoutMs: dependencies.timeoutMs || 10_000,
      timeoutCode: 'address_validation_timeout',
      consumeResponse: async (providerResponse) => ({
        response: providerResponse,
        payload: await providerResponse.json(),
      }),
    }));
  } catch (error) {
    if (error instanceof ProviderTimeoutError) {
      throw new AddressValidationError('address_validation_timeout', 503);
    }
    throw new AddressValidationError('address_validation_unavailable', 503);
  }
  if (!response.ok) throw new AddressValidationError('address_validation_unavailable', 503);
  const verdict = payload?.result?.verdict || {};
  const nextAction = verdict.possibleNextAction;
  if (verdict.addressComplete !== true
    || !DELIVERABLE_GRANULARITY.has(verdict.validationGranularity)
    || (nextAction && nextAction !== 'ACCEPT')) {
    throw new AddressValidationError('address_not_deliverable', 422, {
      possible_next_action: nextAction || 'FIX',
      formatted_address: clean(payload?.result?.address?.formattedAddress, 280) || null,
    });
  }
  const address = standardizedAddress(input, payload.result);
  return {
    address,
    corrected: comparable(address) !== comparable(input),
    formatted_address: clean(payload.result?.address?.formattedAddress, 280) || null,
    response_id: clean(payload.responseId, 100) || null,
    possible_next_action: nextAction || 'ACCEPT',
  };
}
