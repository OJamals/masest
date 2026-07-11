export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the allowed size');
    this.name = 'RequestBodyTooLargeError';
    this.code = 'request_too_large';
  }
}

export async function readBoundedBytes(request, maxBytes) {
  const declaredLength = request.headers.get('content-length');
  if (/^\d+$/.test(declaredLength || '') && Number(declaredLength) > maxBytes) {
    throw new RequestBodyTooLargeError();
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Cancellation is best effort; the size error remains the public contract.
      }
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedJson(request, maxBytes) {
  const bytes = await readBoundedBytes(request, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function readBoundedFormData(request, maxBytes) {
  const bytes = await readBoundedBytes(request, maxBytes);
  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const boundedRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: bytes,
  });
  return boundedRequest.formData();
}
