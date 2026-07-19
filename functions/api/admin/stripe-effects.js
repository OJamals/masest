// POST /api/admin/stripe-effects
// Operator/scheduler entry point for bounded Stripe webhook effect processing.
// No scheduler is provisioned here; STRIPE_EFFECTS_WORKER_SECRET owns access.
import { json } from '../../_lib/supabase.js';
import { runStripeEffectsWorker } from '../../_lib/stripe-effects.js';

function timingSafeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function boundedLimit(request) {
  const value = Number(new URL(request.url).searchParams.get('limit'));
  return Math.min(Math.max(Number.isFinite(value) && value > 0 ? Math.floor(value) : 10, 1), 25);
}

function newWorkerId() {
  return `stripe-effects:${globalThis.crypto.randomUUID()}`;
}

export function createStripeEffectsWorkerHandler(dependencies = {}) {
  const runWorker = dependencies.runWorker || runStripeEffectsWorker;
  const workerId = dependencies.workerId || newWorkerId;
  return async function stripeEffectsWorkerHandler({ request, env }) {
    const configuredSecret = env.STRIPE_EFFECTS_WORKER_SECRET || '';
    if (!configuredSecret) {
      return json(503, { error: 'stripe_effects_worker_not_configured' });
    }
    const providedSecret = request.headers.get('x-stripe-effects-secret') || '';
    if (!timingSafeEqual(providedSecret, configuredSecret)) {
      return json(401, { error: 'unauthorized' });
    }
    try {
      const result = await runWorker({
        env,
        workerId: workerId(),
        limit: boundedLimit(request),
      });
      return json(200, result);
    } catch {
      return json(503, { error: 'stripe_effects_worker_failed' });
    }
  };
}

const defaultHandler = createStripeEffectsWorkerHandler();

export async function onRequestPost(context) {
  return defaultHandler(context);
}
