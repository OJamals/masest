/* Automations card: one line per scheduled job, so "did the review sweep run?"
 * has an answer in the console instead of requiring a database query.
 *
 * A job with no recorded run at all is shown as "Never run", which is the state
 * that matters most — it means the cron was never applied, its secret drifted,
 * or it fails before it can even record.
 */
import { esc } from '../util.js?v=20260807a';

const STATE_LABEL = { ok: 'Healthy', stale: 'Overdue', failing: 'Failing', never: 'Never run' };
// Reuses the shared status-badge tints rather than introducing new colours.
const STATE_BADGE = { ok: 'approved', stale: 'pending', failing: 'rejected', never: 'rejected' };

function relative(iso) {
  if (!iso) return 'never';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return 'unknown';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function cadence(minutes) {
  if (minutes < 60) return `every ${minutes} min`;
  if (minutes < 60 * 24) return `every ${Math.round(minutes / 60)} hr`;
  return `every ${Math.round(minutes / (60 * 24))} d`;
}

export function createAutomationCard({ $, api, admSkeleton }) {
  async function renderAutomation() {
    const box = $('admAutomation');
    if (!box) return;
    box.innerHTML = admSkeleton(4);
    let data;
    try {
      data = await api('/api/admin/automation');
    } catch {
      box.innerHTML = '<p class="adm-status" data-state="err">Could not load automation status. Retry.</p>';
      return;
    }
    const jobs = data.jobs || [];
    const attention = data.attention || 0;
    const banner = data.needs_migration
      ? '<p class="adm-status" data-state="err">Run log not installed — apply supabase/schema-automation-runs.sql to record job runs.</p>'
      : attention
        ? `<p class="adm-status" data-state="err">${attention} job${attention === 1 ? '' : 's'} need attention.</p>`
        : '<p class="adm-status" data-state="ok">All scheduled jobs reporting.</p>';

    box.innerHTML = banner + `<div class="adm-list">${jobs.map((entry) => `
      <div class="dash-row adm-automation-row" data-automation-state="${esc(entry.state)}">
        <span>
          <b>${esc(entry.label)}</b>
          <small class="muted">${esc(cadence(entry.expectedMinutes))} · last run ${esc(relative(entry.last_run_at))}${entry.processed ? ` · ${esc(entry.processed)} processed` : ''}${entry.error_code ? ` · ${esc(entry.error_code)}` : ''}</small>
        </span>
        <span class="badge" data-s="${esc(STATE_BADGE[entry.state] || 'pending')}">${esc(STATE_LABEL[entry.state] || entry.state)}</span>
      </div>`).join('')}</div>`;
  }

  return { renderAutomation };
}
