// POST /api/admin/integration-effects
// Operator/scheduler entry point for bounded provider effect processing.
// Existing STRIPE_EFFECTS_WORKER_SECRET binding remains the cutover access secret.
import { json } from '../../_lib/supabase.js';
import { runIntegrationEffectsWorker } from '../../_lib/integration-effects.js';
import { timingSafeEqual } from '../../_lib/secret.js';

function boundedLimit(request) {
  const value = Number(new URL(request.url).searchParams.get('limit'));
  return Math.min(Math.max(Number.isFinite(value) && value > 0 ? Math.floor(value) : 10, 1), 25);
}

function newWorkerId() {
  return `integration-effects:${globalThis.crypto.randomUUID()}`;
}

export function createIntegrationEffectsWorkerHandler(dependencies = {}) {
  const runWorker = dependencies.runWorker || runIntegrationEffectsWorker;
  const workerId = dependencies.workerId || newWorkerId;
  return async function integrationEffectsWorkerHandler({ request, env }) {
    const configuredSecret = env.STRIPE_EFFECTS_WORKER_SECRET || '';
    if (!configuredSecret) {
      return json(503, { error: 'integration_effects_worker_not_configured' });
    }
    const providedSecret = request.headers.get('x-integration-effects-secret') || '';
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
      return json(503, { error: 'integration_effects_worker_failed' });
    }
  };
}

const defaultHandler = createIntegrationEffectsWorkerHandler();

export async function onRequestPost(context) {
  return defaultHandler(context);
}
