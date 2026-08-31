import {
  EmailBridgeRequestError,
  verifiedEmailBridgeJson,
} from '../../_lib/email-bridge-request.js';
import {
  applyEmailLifecycleEvent,
  normalizeEmailLifecycleEvent,
} from '../../_lib/email-events.js';
import { json } from '../../_lib/supabase.js';

const BODY_MAX_BYTES = 256 * 1024;
const EVENT_BATCH_MAX = 100;

export function createEmailEventsHandler(dependencies = {}) {
  const applyEvent = dependencies.applyEvent || applyEmailLifecycleEvent;
  const readVerified = dependencies.verifiedJson || verifiedEmailBridgeJson;
  return async function emailEventsHandler({ request, env }) {
    let body;
    try {
      body = await readVerified(request, env, {
        maxBytes: BODY_MAX_BYTES,
        now: dependencies.now || Date.now,
        readBody: dependencies.readBoundedBytes,
      });
    } catch (error) {
      if (error instanceof EmailBridgeRequestError) return json(error.status, { error: error.code });
      return json(400, { error: 'bad_request' });
    }
    if (!Array.isArray(body?.events) || !body.events.length || body.events.length > EVENT_BATCH_MAX) {
      return json(400, { error: 'invalid_event_batch' });
    }
    let events;
    try {
      events = body.events.map((event) => normalizeEmailLifecycleEvent(event));
    } catch (error) {
      return json(400, { error: String(error?.message || 'invalid_email_event').slice(0, 120) });
    }
    try {
      for (const event of events) await applyEvent(env, event);
    } catch {
      return json(503, { error: 'email_event_apply_failed' });
    }
    return json(200, { ok: true, processed: events.length });
  };
}

const defaultHandler = createEmailEventsHandler();

export async function onRequestPost(context) {
  return defaultHandler(context);
}
