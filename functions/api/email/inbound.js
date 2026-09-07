import {
  EmailBridgeRequestError,
  verifiedEmailBridgeJson,
} from '../../_lib/email-bridge-request.js';
import { routeInboundMessageReply } from '../../_lib/support-email.js';
import { json } from '../../_lib/supabase.js';

const BODY_MAX_BYTES = 256 * 1024;

export function createEmailInboundHandler(dependencies = {}) {
  const readVerified = dependencies.verifiedJson || verifiedEmailBridgeJson;
  const routeInbound = dependencies.routeInbound || routeInboundMessageReply;
  return async function emailInboundHandler({ request, env }) {
    let input;
    try {
      input = await readVerified(request, env, {
        maxBytes: BODY_MAX_BYTES,
        now: dependencies.now || Date.now,
        readBody: dependencies.readBoundedBytes,
      });
    } catch (error) {
      if (error instanceof EmailBridgeRequestError) return json(error.status, { error: error.code });
      return json(400, { error: 'bad_request' });
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return json(400, { error: 'invalid_email' });
    }
    try {
      const result = await routeInbound(env, input);
      return json(200, {
        ok: true,
        routed: result?.routed === true,
        duplicate: result?.duplicate === true,
        ...(result?.reason ? { reason: String(result.reason).slice(0, 120) } : {}),
      });
    } catch (error) {
      if (error?.code === 'support_writes_paused'
          || String(error?.message || '').includes('support_writes_paused')) {
        return json(503, { error: 'support_writes_paused', retryable: true }, { 'Retry-After': '60' });
      }
      return json(503, { error: 'email_ingress_failed' });
    }
  };
}

const defaultHandler = createEmailInboundHandler();

export async function onRequestPost(context) {
  return defaultHandler(context);
}
