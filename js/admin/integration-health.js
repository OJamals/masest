import { api } from '../auth.js?v=20260807i';
import { esc } from '../util.js?v=20260807i';

const $ = (id) => document.getElementById(id);

function age(value) {
  if (!value) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function providerName(value) {
  return {
    stripe: 'Stripe',
    shipstation: 'ShipStation',
    resend: 'Resend',
    quickbooks: 'QuickBooks',
  }[value] || value;
}

function healthHtml(rows) {
  return `<div class="adm-grid">${rows.map((row) => {
    const state = row.dead_count ? 'err' : row.pending_count ? 'warn' : 'ok';
    return `<article class="adm-card adm-stat">
      <small>${esc(providerName(row.provider))}</small>
      <b>${esc(row.completed_count)} complete · ${esc(row.pending_count)} pending</b>
      <span class="adm-status" data-state="${state}">${row.dead_count ? `${esc(row.dead_count)} dead` : 'No dead letters'}</span>
      <span class="muted">Last receipt ${esc(age(row.last_received_at))} · ${esc(row.unmatched_count)} unmatched</span>
      ${row.last_error_code ? `<code>${esc(row.last_error_code)}</code>` : ''}
    </article>`;
  }).join('')}</div>`;
}

function deadHtml(effects) {
  const dead = effects.filter((effect) => effect.status === 'dead');
  if (!dead.length) return '<p class="muted">No dead-letter effects.</p>';
  return `<div class="adm-table-wrap"><table class="adm"><thead><tr><th>Effect</th><th>Aggregate</th><th>Attempts</th><th>Error</th><th></th></tr></thead><tbody>${dead.map((effect) => `<tr>
    <td>${esc(effect.effect_type)}</td>
    <td>${esc(effect.aggregate_type || '—')} ${esc(effect.aggregate_id || '')}</td>
    <td>${esc(effect.attempt_count)}</td>
    <td><code>${esc(effect.last_error_code || 'unknown')}</code></td>
    <td><button class="btn btn-ghost btn-sm" type="button" data-integration-replay="${esc(effect.id)}" data-capability="admin.write">Replay</button></td>
  </tr>`).join('')}</tbody></table></div>`;
}

export async function renderIntegrationHealth() {
  const root = $('integrationHealth');
  const dead = $('integrationDeadLetters');
  const status = $('integrationHealthStatus');
  if (!root || !dead || !status) return;
  status.textContent = 'Loading provider receipts…';
  status.dataset.state = '';
  try {
    const data = await api('/api/admin/integrations?status=dead&limit=100');
    root.innerHTML = healthHtml(data.health || []);
    dead.innerHTML = deadHtml(data.effects || []);
    status.textContent = data.truncated
      ? 'More dead letters available; use returned cursor through API for older failures.'
      : 'Provider inbox current.';
    status.dataset.state = 'ok';
  } catch (error) {
    status.textContent = error.data?.error || 'Integration health unavailable.';
    status.dataset.state = 'err';
  }
}

export function wireIntegrationHealth() {
  $('integrationRefresh')?.addEventListener('click', renderIntegrationHealth);
  $('integrationRunWorker')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api('/api/admin/integrations', { method: 'POST', body: { action: 'run_worker', limit: 25 } });
      await renderIntegrationHealth();
    } finally {
      button.disabled = false;
    }
  });
  $('integrationDeadLetters')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-integration-replay]');
    if (!button) return;
    const reason = $('integrationReplayReason')?.value || '';
    if (!reason || reason.trim().length < 5) return;
    button.disabled = true;
    try {
      await api('/api/admin/integrations', {
        method: 'POST',
        body: { action: 'replay_effect', id: button.dataset.integrationReplay, reason: reason.trim() },
      });
      await renderIntegrationHealth();
    } finally {
      button.disabled = false;
    }
  });
}
