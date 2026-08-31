import { verifyEmailBridgePayload } from '../../shared/email-bridge.js';
import { RequestBodyTooLargeError, readBoundedBytes } from './request-body.js';

export class EmailBridgeRequestError extends Error {
  constructor(status, code) {
    super(code);
    this.name = 'EmailBridgeRequestError';
    this.status = status;
    this.code = code;
  }
}

export async function verifiedEmailBridgeJson(request, env, {
  maxBytes = 256 * 1024,
  now = Date.now,
  readBody = readBoundedBytes,
} = {}) {
  const secret = String(env?.EMAIL_INGRESS_SECRET || '');
  if (!secret) throw new EmailBridgeRequestError(503, 'email_ingress_not_configured');
  let rawBody;
  try {
    rawBody = new TextDecoder().decode(await readBody(request, maxBytes));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      throw new EmailBridgeRequestError(413, 'request_too_large');
    }
    throw new EmailBridgeRequestError(400, 'bad_request');
  }
  const verified = await verifyEmailBridgePayload({
    secret,
    timestamp: request.headers.get('x-masest-email-timestamp'),
    signature: request.headers.get('x-masest-email-signature'),
    rawBody,
    nowMs: now(),
  });
  if (!verified) throw new EmailBridgeRequestError(401, 'invalid_signature');
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new EmailBridgeRequestError(400, 'bad_request');
  }
}
