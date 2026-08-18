export class ProviderTimeoutError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProviderTimeoutError';
    this.code = code;
    this.status = 503;
    this.retryable = true;
  }
}

export async function fetchWithDeadline(fetchImpl, url, options = {}, {
  timeoutMs = 10_000,
  timeoutCode = 'provider_timeout',
  consumeResponse = null,
} = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const parentSignal = options.signal;
  const cancel = () => controller.abort(parentSignal?.reason || 'cancelled');
  if (parentSignal?.aborted) cancel();
  else parentSignal?.addEventListener('abort', cancel, { once: true });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort('timeout');
      reject(new ProviderTimeoutError(timeoutCode));
    }, Math.max(1, Number(timeoutMs) || 10_000));
  });
  const operation = (async () => {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return typeof consumeResponse === 'function'
      ? consumeResponse(response, controller.signal)
      : response;
  })();
  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (timedOut && !(error instanceof ProviderTimeoutError)) {
      throw new ProviderTimeoutError(timeoutCode);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', cancel);
  }
}
