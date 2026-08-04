// Staff integration operations: redacted health, dead-letter replay, and worker drain.
import { adminClient, json, requireStaff } from '../../_lib/supabase.js';
import { staffCanWrite } from '../../_lib/authz.js';
import { runIntegrationEffectsWorker } from '../../_lib/integration-effects.js';

const PROVIDERS = new Set(['stripe', 'shipstation', 'resend', 'quickbooks']);

function boundedLimit(value, fallback = 50) {
  return Math.min(Math.max(Number.parseInt(value, 10) || fallback, 1), 100);
}

function safeError(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9_:-]/g, '_').slice(0, 80);
  return normalized || null;
}

async function loadHealthAndDeadLetters(sb, { provider, limit, before, beforeId }) {
  const [{ data: health, error: healthError }, { data: dead, error: deadError }] = await Promise.all([
    sb.rpc('provider_integration_health'),
    sb.rpc('provider_integration_dead_letters', {
      p_provider: provider || null,
      p_limit: limit + 1,
      p_before_created_at: before || null,
      p_before_id: beforeId || null,
    }),
  ]);
  if (healthError) throw healthError;
  if (deadError) throw deadError;
  const rows = dead || [];
  const truncated = rows.length > limit;
  const effects = rows.slice(0, limit);
  const tail = effects.at(-1);
  return {
    health: (health || []).map((row) => ({ ...row, last_error_code: safeError(row.last_error_code) })),
    effects,
    truncated,
    nextCursor: truncated && tail ? { created_at: tail.created_at, id: tail.id } : null,
  };
}

export function createAdminIntegrationsHandlers(dependencies = {}) {
  const authorize = dependencies.requireStaff || requireStaff;
  const client = dependencies.adminClient || adminClient;
  const runWorker = dependencies.runWorker || runIntegrationEffectsWorker;

  async function auth(request, env, write = false) {
    const { user, staff, role } = await authorize(request, env);
    if (!user) return { error: json(401, { error: 'unauthenticated' }) };
    if (!staff) return { error: json(403, { error: 'forbidden' }) };
    if (write && !staffCanWrite(role)) return { error: json(403, { error: 'forbidden' }) };
    return { user, role };
  }

  async function get({ request, env }, authorized = null) {
    const access = authorized || await auth(request, env);
    if (access.error) return access.error;
    const url = new URL(request.url);
    const provider = String(url.searchParams.get('provider') || '').toLowerCase();
    const status = String(url.searchParams.get('status') || 'dead').toLowerCase();
    const limit = boundedLimit(url.searchParams.get('limit'));
    if (provider && !PROVIDERS.has(provider)) return json(400, { error: 'invalid_provider' });
    if (status !== 'dead') return json(400, { error: 'invalid_status' });
    const before = url.searchParams.get('before');
    const beforeId = url.searchParams.get('before_id');
    if (Boolean(before) !== Boolean(beforeId) || (before && Number.isNaN(Date.parse(before)))) {
      return json(400, { error: 'invalid_cursor' });
    }
    try {
      const result = await loadHealthAndDeadLetters(client(env), { provider, limit, before, beforeId });
      return json(200, {
        health: result.health,
        events: [],
        effects: result.effects.map((effect) => ({
          ...effect,
          last_error_code: safeError(effect.last_error_code),
          provider_result: effect.provider_result ? {
            applied: effect.provider_result.applied,
            found: effect.provider_result.found,
            skipped: effect.provider_result.skipped,
          } : null,
        })),
        truncated: result.truncated,
        next_cursor: result.nextCursor,
      });
    } catch {
      return json(503, { error: 'integration_health_unavailable' });
    }
  }

  async function post({ request, env }, authorized = null) {
    const access = authorized || await auth(request, env, true);
    if (access.error) return access.error;
    if (!staffCanWrite(access.role)) return json(403, { error: 'forbidden' });
    let body;
    try { body = await request.json(); } catch { return json(400, { error: 'bad_request' }); }
    const action = String(body?.action || '');
    const sb = client(env);
    if (action === 'run_worker') {
      try {
        const result = await runWorker({
          env,
          sb,
          workerId: `staff-${crypto.randomUUID()}`,
          limit: Math.min(boundedLimit(body?.limit, 10), 25),
        });
        return json(200, result);
      } catch {
        return json(503, { error: 'integration_worker_failed' });
      }
    }
    if (!['replay_effect', 'replay_event'].includes(action)) {
      return json(400, { error: 'invalid_action' });
    }
    const id = String(body?.id || '').trim();
    const reason = String(body?.reason || '').trim();
    if (!id || reason.length < 5 || reason.length > 500) {
      return json(400, { error: 'replay_reason_required' });
    }
    const actor = String(access.user.email || access.user.id || '').slice(0, 128);
    try {
      let effectIds = [id];
      if (action === 'replay_event') {
        const { data, error } = await sb.from('integration_effects')
          .select('id')
          .eq('event_id', id)
          .eq('status', 'dead')
          .limit(100);
        if (error) throw error;
        effectIds = (data || []).map((effect) => effect.id);
      }
      let replayed = 0;
      for (const effectId of effectIds) {
        const { data, error } = await sb.rpc('replay_integration_effect', {
          p_effect_id: effectId,
          p_actor: actor,
          p_reason: reason,
        });
        if (error) throw error;
        if (data === true) replayed += 1;
      }
      return json(200, { ok: true, replayed });
    } catch {
      return json(503, { error: 'integration_replay_failed' });
    }
  }

  return { get, post };
}

const handlers = createAdminIntegrationsHandlers();

export async function onRequestGet(context) {
  const { request, env } = context;
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  return handlers.get(context, { user, staff, role });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  return handlers.post(context, { user, staff, role });
}
