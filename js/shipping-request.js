export const SHIPPING_REQUEST_TIMEOUT_MS = 20_000;

export class ShippingRequestError extends Error {
  constructor(code, { status = 0, retryable = false, data = null } = {}) {
    super(code);
    this.name = 'ShippingRequestError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.data = data;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, canonical(value[key])]));
}

function canonicalCart(cart) {
  return (Array.isArray(cart) ? cart : [])
    .map((line) => ({ sku: String(line?.sku || '').trim(), qty: Number(line?.qty) }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

export function shippingRequestSnapshot(input = {}) {
  return JSON.stringify(canonical({
    cart: canonicalCart(input.cart),
    address: input.address || null,
    billing_address: input.billing_address || null,
    billing_same_as_shipping: input.billing_same_as_shipping !== false,
    postal_code: String(input.postal_code || '').trim().toUpperCase(),
  }));
}

export function createShippingRequestCoordinator() {
  let generation = 0;
  let current = null;
  return {
    begin(snapshot) {
      if (current && !current.signal.aborted) current.controller.abort('superseded');
      const controller = new AbortController();
      current = Object.freeze({ generation: ++generation, snapshot, controller, signal: controller.signal });
      return current;
    },
    cancel() {
      generation += 1;
      if (current && !current.signal.aborted) current.controller.abort('cancelled');
      current = null;
    },
    isCurrent(request, snapshot) {
      return current === request
        && request.generation === generation
        && request.snapshot === snapshot
        && !request.signal.aborted;
    },
    finish(request) {
      if (current === request) current = null;
    },
  };
}

export async function fetchShippingJson(url, options = {}, {
  fetchImpl = fetch,
  timeoutMs = SHIPPING_REQUEST_TIMEOUT_MS,
  signal = null,
} = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal?.reason || 'cancelled');
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort('timeout');
  }, Math.max(1, Number(timeoutMs) || SHIPPING_REQUEST_TIMEOUT_MS));
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ShippingRequestError(data?.error || 'shipping_rates_unavailable', {
        status: response.status,
        retryable: response.status >= 500 || response.status === 429,
        data,
      });
    }
    return data;
  } catch (error) {
    if (timedOut) {
      throw new ShippingRequestError('shipping_rates_timeout', { status: 503, retryable: true });
    }
    if (signal?.aborted || controller.signal.aborted) {
      throw new ShippingRequestError('shipping_request_cancelled');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
