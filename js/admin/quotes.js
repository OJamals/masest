// Admin quotes pipeline tab (#36 per-tab split). Two views over the same lead data:
// a List (status/priority/owner/due accordions) and a Board (slice-2 deal pipeline —
// 6-stage drag kanban, forecast strip, deal drawer). Shared primitives ($, api, state,
// message, admSkeleton, admEmpty) and the admin-local statusBadge / badge / admListPager
// helpers are injected; esc/delegate/money/confirmDialog/dateTime come from util.js and
// the dirty-edit helpers from edits.js. The CRM activity panel (Timeline/Tasks/Notes,
// slice 1) is reused inside the drawer via createCrmPanel — no js/admin.js change needed.
import { esc, delegate, money, confirmDialog } from '../util.js';
import { captureDirty, restoreDirty } from './edits.js';
import { createCrmPanel } from './crm.js';

export function createQuotesTab({ $, api, state, message, admSkeleton, admEmpty, statusBadge, badge, admListPager }) {
  const QUOTE_STATUSES = ['new', 'contacted', 'closed', 'spam'];
  const STAGES = ['new', 'qualified', 'sample_audit', 'proposal', 'won', 'lost'];
  const STAGE_LABELS = { new: 'New', qualified: 'Qualified', sample_audit: 'Sample / Audit', proposal: 'Proposal', won: 'Won', lost: 'Lost' };
  const LOST_REASONS = ['price', 'competitor', 'spec', 'timing', 'no_decision', 'other'];
  const STALE_DAYS = 7;
  const crm = createCrmPanel({ $, api, admSkeleton, admEmpty });
  let dragId = null;

  function quoteDueInDays(days) { return new Date(Date.now() + days * 86400e3).toISOString(); }
  function fmtMoney(v) { return (v == null || v === '') ? '—' : money(v, 'usd'); }
  function validStageLocal(stage) { return STAGES.includes(String(stage)); }
  function companyOptions() {
    return (state.companies || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.status || '')})</option>`).join('');
  }
  function isStale(quote) {
    if (['won', 'lost'].includes(quote.pipeline_stage)) return false;
    const t = quote.stage_changed_at ? new Date(quote.stage_changed_at).getTime() : null;
    return t != null && (Date.now() - t) > STALE_DAYS * 86400e3;
  }

  // ---- View toggle (injected once above #admQuotes, survives list innerHTML swaps) ----
  function reflectToggle() {
    const wrap = $('admQuotes')?.parentElement?.querySelector('.pipe-toggle');
    if (!wrap) return;
    wrap.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === (state.quotesView || 'list')));
  }
  function ensureToggle() {
    const box = $('admQuotes');
    if (!box || !box.parentElement) return;
    if (box.parentElement.querySelector('.pipe-toggle')) { reflectToggle(); return; }
    const wrap = document.createElement('div');
    wrap.className = 'pipe-toggle';
    wrap.innerHTML = `<button class="btn btn-ghost btn-sm" data-view="list" type="button">List</button>
      <button class="btn btn-ghost btn-sm" data-view="board" type="button">Board</button>
      <button class="btn btn-ghost btn-sm" data-view="report" type="button">Reports</button>`;
    box.parentElement.insertBefore(wrap, box);
    wrap.addEventListener('click', (event) => {
      const b = event.target.closest('[data-view]');
      if (!b) return;
      state.quotesView = b.dataset.view;
      reflectToggle();
      renderQuotePipeline({ refetch: false });
    });
    reflectToggle();
  }

  // ---- Board view ----
  function boardQuotes() { return (state.quotes || []).filter((q) => q.status !== 'spam'); }

  function forecastHtml(summary) {
    if (!summary) return '';
    const chips = summary.stages.map((s) => `<span class="pipe-chip">${STAGE_LABELS[s.stage]}: ${s.count}</span>`).join('');
    return `<div class="pipe-forecast">
      <span>Open <b>${fmtMoney(summary.open_value)}</b></span>
      <span>Weighted forecast <b>${fmtMoney(summary.weighted)}</b></span>
      ${chips}
    </div>`;
  }

  // ---- Reports view (slice 3) ----
  function kpiCards(k) {
    const card = (label, val) => `<div class="pipe-kpi"><span class="muted">${label}</span><b>${val}</b></div>`;
    return `<div class="pipe-kpis">
      ${card('Open deals', k.open_count)}
      ${card('Open value', fmtMoney(k.open_value))}
      ${card('Weighted forecast', fmtMoney(k.weighted))}
      ${card('Win rate', `${Math.round((k.win_rate || 0) * 100)}%`)}
      ${card('Won', `${k.won_count} · ${fmtMoney(k.won_value)}`)}
      ${card('Avg deal', fmtMoney(k.avg_deal))}
    </div>`;
  }
  function funnelHtml(funnel) {
    const max = Math.max(1, funnel[0]?.reached || 1);
    const rows = funnel.map((f) => `<div class="pipe-funnel-row">
      <span class="pipe-funnel-label">${STAGE_LABELS[f.stage]}</span>
      <span class="pipe-bar"><span class="pipe-bar-fill" style="width:${Math.round((f.reached / max) * 100)}%"></span></span>
      <span class="pipe-funnel-val">${f.reached}${f.rate < 1 ? ` · ${Math.round(f.rate * 100)}%` : ''}</span>
    </div>`).join('');
    return `<section class="pipe-report-block"><h3>Conversion funnel</h3>${rows}</section>`;
  }
  function forecastMonthsHtml(months) {
    if (!months.length) return '<section class="pipe-report-block"><h3>Forecast by month</h3><p class="muted">No open deals with a value yet.</p></section>';
    const max = Math.max(1, ...months.map((m) => m.value));
    const rows = months.map((m) => `<div class="pipe-funnel-row">
      <span class="pipe-funnel-label">${m.month === 'unscheduled' ? 'Unscheduled' : esc(m.month)}</span>
      <span class="pipe-bar"><span class="pipe-bar-fill" style="width:${Math.round((m.value / max) * 100)}%"></span></span>
      <span class="pipe-funnel-val">${fmtMoney(m.weighted)} <span class="muted">of ${fmtMoney(m.value)}</span></span>
    </div>`).join('');
    return `<section class="pipe-report-block"><h3>Weighted forecast by close month</h3>${rows}</section>`;
  }
  function lossHtml(reasons) {
    if (!reasons.length) return '';
    const chips = reasons.map((r) => `<span class="pipe-chip"><b>${r.count}</b> ${esc(String(r.reason).replace(/_/g, ' '))}</span>`).join('');
    return `<section class="pipe-report-block"><h3>Loss reasons</h3><div class="pipe-loss">${chips}</div></section>`;
  }
  async function renderReport() {
    const box = $('admQuotes');
    let report = null;
    try { report = (await api('/api/admin/quotes?view=report')).report; } catch { report = null; }
    if (!report) { box.innerHTML = '<p class="adm-status" data-state="err">Could not load the report. Reload to retry.</p>'; return; }
    box.innerHTML = `<div class="pipe-report">
      ${kpiCards(report.kpis)}
      ${funnelHtml(report.funnel || [])}
      ${forecastMonthsHtml(report.forecast_months || [])}
      ${lossHtml(report.loss_reasons || [])}
    </div>`;
  }

  function cardHtml(q) {
    const id = esc(q.id);
    const stale = isStale(q) ? ' is-stale' : '';
    const due = q.due_at ? new Date(q.due_at).getTime() : null;
    const overdue = due && !['won', 'lost'].includes(q.pipeline_stage) && due <= Date.now();
    return `<div class="pipe-card${stale}" data-card-id="${id}" draggable="true" tabindex="0" role="listitem">
      <div class="pipe-card-title">${esc(q.company || q.name || q.email || 'Lead')}</div>
      <div class="pipe-card-meta">
        <b>${fmtMoney(q.deal_value)}</b>
        ${statusBadge(q.priority || 'normal')}
        ${q.assigned_to ? `<span>${esc(q.assigned_to)}</span>` : ''}
        ${overdue ? '<span class="badge badge-warning">Overdue</span>' : ''}
        ${stale ? '<span class="badge badge-warning">Stale</span>' : ''}
      </div>
      <select class="adm-select" data-card-stage="${id}" aria-label="Move ${esc(q.company || q.name || 'lead')} to stage">
        ${STAGES.map((s) => `<option value="${s}"${s === (q.pipeline_stage || 'new') ? ' selected' : ''}>${STAGE_LABELS[s]}</option>`).join('')}
      </select>
    </div>`;
  }

  async function renderBoard() {
    const box = $('admQuotes');
    let summary = null;
    try { summary = (await api('/api/admin/quotes?view=pipeline')).summary; } catch { summary = null; }
    const cols = STAGES.map((stage) => {
      const items = boardQuotes().filter((q) => (q.pipeline_stage || 'new') === stage);
      const colValue = items.reduce((s, q) => s + (Number(q.deal_value) || 0), 0);
      const cards = items.map(cardHtml).join('') || '<p class="muted" style="padding:6px 4px">No deals</p>';
      return `<div class="pipe-col" data-col="${stage}">
        <div class="pipe-col-head"><span>${STAGE_LABELS[stage]}</span><span class="muted">${items.length}${colValue ? ` · ${fmtMoney(colValue)}` : ''}</span></div>
        ${cards}
      </div>`;
    }).join('');
    box.innerHTML = forecastHtml(summary) + `<div class="pipe-board" role="list">${cols}</div>`;
  }

  // ---- Stage moves (drag, keyboard select, drawer) ----
  function pickLostReason() {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'confirm-dialog';
      dlg.innerHTML = `<form method="dialog" class="confirm-dialog-body">
        <p class="confirm-dialog-msg">Why was this deal lost?</p>
        <label>Reason <select class="adm-select" data-reason>${LOST_REASONS.map((r) => `<option value="${r}">${r.replace(/_/g, ' ')}</option>`).join('')}</select></label>
        <menu class="confirm-dialog-actions">
          <button value="cancel" class="btn btn-ghost btn-sm" type="submit">Cancel</button>
          <button value="ok" class="btn btn-danger btn-sm" type="submit">Mark lost</button>
        </menu>
      </form>`;
      if (typeof dlg.showModal !== 'function') { resolve('other'); return; }
      document.body.appendChild(dlg);
      dlg.addEventListener('close', () => {
        const reason = dlg.returnValue === 'ok' ? (dlg.querySelector('[data-reason]')?.value || 'other') : null;
        dlg.remove();
        resolve(reason);
      });
      dlg.showModal();
    });
  }

  async function moveStage(id, stage) {
    if (!validStageLocal(stage)) return;
    const q = (state.quotes || []).find((x) => String(x.id) === String(id));
    if (q && (q.pipeline_stage || 'new') === stage) return;
    const body = { id, pipeline_stage: stage };
    if (stage === 'lost') {
      const reason = await pickLostReason();
      if (reason === null) { await renderQuotePipeline({ refetch: false }); return; }
      body.lost_reason = reason;
    } else if (stage === 'won') {
      if (!(await confirmDialog('Mark this deal Won? Use “Convert to order” in the drawer to create the order.', { confirmText: 'Mark won' }))) {
        await renderQuotePipeline({ refetch: false });
        return;
      }
    }
    try {
      const res = await api('/api/admin/quotes', { method: 'POST', body });
      if (res.quote && q) Object.assign(q, res.quote);
      message('qStatus', 'Stage updated.', 'ok');
    } catch (err) {
      message('qStatus', err.data?.error || 'Could not move the deal. Retry.', 'err');
    }
    await renderQuotePipeline({ refetch: false });
  }

  // ---- Deal drawer (Details + reused CRM Timeline/Tasks/Notes) ----
  function detailsHtml(q) {
    const dueValue = q.due_at ? new Date(q.due_at).toISOString().slice(0, 16) : '';
    const closeValue = q.expected_close ? String(q.expected_close).slice(0, 10) : '';
    return `<div class="drawer-details">
      <label>Stage <select class="adm-select" data-d-stage>${STAGES.map((s) => `<option value="${s}"${s === (q.pipeline_stage || 'new') ? ' selected' : ''}>${STAGE_LABELS[s]}</option>`).join('')}</select></label>
      <label>Status <select class="adm-select" data-d-status>${QUOTE_STATUSES.map((s) => `<option value="${s}"${s === (q.status || 'new') ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>Priority <select class="adm-select" data-d-priority>${['urgent', 'high', 'normal', 'low'].map((p) => `<option value="${p}"${p === (q.priority || 'normal') ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
      <label>Deal value <input class="adm-input" data-d-deal type="number" min="0" step="0.01" value="${q.deal_value ?? ''}"></label>
      <label>Expected close <input class="adm-input" data-d-close type="date" value="${esc(closeValue)}"></label>
      <label>Owner <input class="adm-input" data-d-owner value="${esc(q.assigned_to || '')}"></label>
      <label>Next step <input class="adm-input" data-d-next value="${esc(q.next_step || '')}"></label>
      <label>Follow-up due <input class="adm-input" data-d-due type="datetime-local" value="${esc(dueValue)}"></label>
      <label>Notes <textarea class="adm-textarea" data-d-notes>${esc(q.notes || '')}</textarea></label>
      <div class="adm-tools" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" data-drawer-save type="button">Save</button></div>
      <hr>
      <h4 style="margin:4px 0">Convert to order</h4>
      <label>Company <select class="adm-select" data-d-co><option value="">Pick company…</option>${companyOptions()}</select></label>
      <div class="adm-tools" style="flex-wrap:wrap">
        <input class="adm-input" data-d-sku placeholder="SKU" style="max-width:120px">
        <input class="adm-input" data-d-name placeholder="Item name" style="max-width:150px">
        <input class="adm-input" data-d-qty type="number" min="1" value="1" style="max-width:64px" aria-label="Qty">
        <input class="adm-input" data-d-price type="number" min="0" step="0.01" placeholder="Unit $" style="max-width:90px">
        <button class="btn btn-ghost btn-sm" data-drawer-convert type="button">Convert</button>
      </div>
    </div>`;
  }

  async function saveDrawer(dlg, quote) {
    const v = (sel) => dlg.querySelector(sel)?.value;
    const status = dlg.querySelector('[data-drawer-status]');
    try {
      const res = await api('/api/admin/quotes', { method: 'POST', body: {
        id: quote.id,
        pipeline_stage: v('[data-d-stage]'),
        status: v('[data-d-status]'),
        priority: v('[data-d-priority]'),
        deal_value: v('[data-d-deal]') === '' ? null : v('[data-d-deal]'),
        expected_close: v('[data-d-close]') || null,
        assigned_to: v('[data-d-owner]'),
        next_step: v('[data-d-next]'),
        due_at: v('[data-d-due]'),
        notes: v('[data-d-notes]'),
      } });
      if (res.quote) Object.assign(quote, res.quote);
      status.textContent = 'Saved.';
      status.dataset.state = 'ok';
      await renderQuotePipeline({ refetch: false });
    } catch (err) {
      status.textContent = err.data?.error || 'Save failed.';
      status.dataset.state = 'err';
    }
  }

  async function convertDrawer(dlg, quote) {
    const v = (sel) => dlg.querySelector(sel)?.value;
    const status = dlg.querySelector('[data-drawer-status]');
    const company_id = v('[data-d-co]');
    const sku = (v('[data-d-sku]') || '').trim();
    const name = (v('[data-d-name]') || '').trim();
    const qty = v('[data-d-qty]');
    const unit_price = v('[data-d-price]');
    if (!company_id) { status.textContent = 'Pick a company to convert into.'; status.dataset.state = 'err'; return; }
    if (!sku || unit_price === '') { status.textContent = 'SKU and unit price are required.'; status.dataset.state = 'err'; return; }
    try {
      const res = await api('/api/admin/quotes', { method: 'POST', body: { id: quote.id, action: 'convert', company_id, items: [{ sku, name, qty, unit_price }] } });
      status.textContent = `Order ${res.order_id} created.`;
      status.dataset.state = 'ok';
      Object.assign(quote, { pipeline_stage: 'won', status: 'closed' });
      await renderQuotePipeline({ refetch: false });
    } catch (err) {
      status.textContent = err.data?.error || 'Could not convert. Refresh and check for a new order before retrying.';
      status.dataset.state = 'err';
    }
  }

  function openQuoteDrawer(quote) {
    document.querySelector('.adm-drawer[data-quote-drawer]')?.remove();
    const dlg = document.createElement('dialog');
    dlg.className = 'adm-drawer';
    dlg.setAttribute('data-quote-drawer', '');
    dlg.innerHTML = `<div class="adm-drawer-inner">
      <div class="adm-tools" style="justify-content:space-between;align-items:start">
        <div><h2 style="margin:0">${esc(quote.company || quote.name || quote.email || 'Lead')}</h2>
        <p class="muted" style="margin:2px 0 0">${esc(quote.type || 'quote')} · ${esc(quote.status || 'new')} · ${esc(STAGE_LABELS[quote.pipeline_stage || 'new'])}</p></div>
        <button class="btn btn-ghost btn-sm" data-drawer-close type="button" aria-label="Close">✕</button>
      </div>
      <div data-drawer-details>${detailsHtml(quote)}</div>
      <p class="adm-status" data-drawer-status role="status" aria-live="polite"></p>
      <div data-drawer-crm></div>
    </div>`;
    if (typeof dlg.showModal !== 'function') return;
    document.body.appendChild(dlg);
    // Drawer-level actions only; the mounted CRM panel binds its own listeners and
    // owns the Timeline / Tasks / Notes sub-tabs (same shape as the company drawer).
    dlg.addEventListener('click', async (event) => {
      if (event.target.closest('[data-drawer-close]')) { dlg.close(); return; }
      if (event.target.closest('[data-drawer-save]')) { await saveDrawer(dlg, quote); return; }
      if (event.target.closest('[data-drawer-convert]')) { await convertDrawer(dlg, quote); }
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    crm.mount(dlg.querySelector('[data-drawer-crm]'), 'quote', quote.id);
  }

  // ---- List view (the original accordion pipeline) ----
  function renderList() {
    const box = $('admQuotes');
    const snap = captureDirty(box);
    const quotesPager = admListPager('data-load-more-quotes', state.quotes.length, state.quotesTotal, state.quotesHasMore);
    const q = $('qSearch').value.trim().toLowerCase();
    const filter = $('qFilter').value;
    const priority = $('qPriority')?.value || '';
    const ownerFilter = $('qOwner')?.value.trim().toLowerCase() || '';
    const dueFilter = $('qDue')?.value || '';
    const now = Date.now();
    const quotes = state.quotes.filter((quote) => {
      const text = JSON.stringify(quote).toLowerCase();
      const ownerMatch = !ownerFilter || String(quote.assigned_to || '').toLowerCase().includes(ownerFilter);
      const dueAt = quote.due_at ? new Date(quote.due_at).getTime() : null;
      const active = !['closed', 'spam'].includes(quote.status);
      const dueMatch = !dueFilter
        || (dueFilter === 'overdue' && active && dueAt && dueAt <= now)
        || (dueFilter === 'upcoming' && active && dueAt && dueAt > now)
        || (dueFilter === 'unscheduled' && active && !dueAt);
      return (!q || text.includes(q))
        && (!filter || quote.status === filter)
        && (!priority || quote.priority === priority)
        && ownerMatch
        && dueMatch;
    });

    if (!quotes.length) {
      box.innerHTML = admEmpty('ph-chats-circle', 'No quotes', 'Quote requests from the site appear here.') + quotesPager;
      return;
    }

    const bulkBar = `<div class="adm-tools adm-tools-flush" style="flex-wrap:wrap">
      <label class="admin-select-all"><input type="checkbox" id="qAll" aria-label="Select all"> Select all</label>
      <select class="adm-select" id="qBulkStage"><option value="">Set stage…</option>${STAGES.map((s) => `<option value="${s}">${STAGE_LABELS[s]}</option>`).join('')}</select>
      <select class="adm-select" id="qBulkPriority"><option value="">Set priority…</option>${['urgent', 'high', 'normal', 'low'].map((p) => `<option value="${p}">${p}</option>`).join('')}</select>
      <input class="adm-input" id="qBulkOwner" placeholder="Assign owner" style="max-width:160px">
      <button class="btn btn-ghost btn-sm" id="qBulkApply" type="button">Apply to selected</button>
    </div>`;

    box.innerHTML = bulkBar + quotes.map((quote) => {
      const id = esc(quote.id);
      const dueValue = quote.due_at ? new Date(quote.due_at).toISOString().slice(0, 16) : '';
      const score = Number.isFinite(Number(quote.lead_score)) ? Number(quote.lead_score) : 0;
      return `
        <details class="quote-item">
          <summary>
            <label class="q-check-wrap"><input type="checkbox" class="q-check" value="${id}" aria-label="Select lead"></label>
            <b>${esc(quote.company || quote.name || quote.email)}</b>
            ${statusBadge(quote.pipeline_stage || 'new')}
            ${statusBadge(quote.status || 'new')}
            ${statusBadge(quote.priority || 'normal')}
            <span class="muted">${fmtMoney(quote.deal_value)} · Score ${esc(score)}</span>
          </summary>
          <p>${esc(quote.message || '')}</p>
          <div class="adm-tools" style="margin-top:8px;align-items:end;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" data-open-quote="${id}" type="button">Open deal</button>
            <select class="adm-select" data-quote-stage="${id}" aria-label="Stage">
              ${STAGES.map((s) => `<option value="${s}" ${s === (quote.pipeline_stage || 'new') ? 'selected' : ''}>${STAGE_LABELS[s]}</option>`).join('')}
            </select>
            <select class="adm-select" data-quote-status="${id}">
              ${QUOTE_STATUSES.map((status) => `<option value="${status}" ${status === quote.status ? 'selected' : ''}>${status}</option>`).join('')}
            </select>
            <select class="adm-select" data-quote-priority="${id}">
              ${['urgent', 'high', 'normal', 'low'].map((value) => `<option value="${value}" ${value === (quote.priority || 'normal') ? 'selected' : ''}>${value}</option>`).join('')}
            </select>
            <input class="adm-input" data-quote-deal="${id}" type="number" min="0" step="0.01" value="${quote.deal_value ?? ''}" placeholder="Deal $" style="max-width:110px">
            <input class="adm-input" data-quote-next-step="${id}" value="${esc(quote.next_step || '')}" placeholder="Next step" style="max-width:220px">
            <input class="adm-input" data-quote-owner="${id}" value="${esc(quote.assigned_to || '')}" placeholder="Owner" style="max-width:160px">
            <input class="adm-input" data-quote-due-at="${id}" type="datetime-local" value="${esc(dueValue)}" aria-label="Follow-up due" style="max-width:190px">
            <button class="btn btn-ghost btn-sm" data-save-quote="${id}" type="button">Save</button>
            <button class="btn btn-ghost btn-sm" data-snooze-quote="${id}" type="button">Snooze 2d</button>
            <button class="btn btn-ghost btn-sm" data-followup="${id}" type="button">Send follow-up</button>
            <a class="btn btn-ghost btn-sm" href="mailto:${esc(quote.email || '')}?subject=${encodeURIComponent('MASEST quote request')}">Email</a>
          </div>
          <textarea class="adm-textarea" data-quote-notes="${id}" placeholder="Internal notes">${esc(quote.notes || '')}</textarea>
        </details>
      `;
    }).join('') + quotesPager;
    restoreDirty(box, snap);
  }

  async function renderQuotePipeline({ append = false, refetch = true } = {}) {
    const box = $('admQuotes');
    if (!box) return;
    if (refetch) {
      if (!append) { state.quotes = []; state.quotesOffset = 0; box.innerHTML = admSkeleton(); }
      let data;
      try {
        const params = new URLSearchParams({ limit: '100', offset: String(state.quotesOffset || 0) });
        data = await api('/api/admin/quotes?' + params.toString());
      } catch {
        if (!append) box.innerHTML = '<p class="adm-status" data-state="err">Could not load quotes. Reload to retry.</p>';
        return;
      }
      state.quotes = (state.quotes || []).concat(data.quotes || []);
      state.quotesOffset = (state.quotesOffset || 0) + (data.quotes || []).length;
      state.quotesTotal = data.total;
      state.quotesHasMore = !!data.has_more;
      state.quotesNeedsMigration = !!data.needs_migration;
      badge('aBadgeQuotes', data.urgent_count || data.new_count || 0);
      state.loaded.add('quotes');
    }
    ensureToggle();
    if (state.quotesNeedsMigration) {
      box.innerHTML = '<p class="muted">No quote database yet. Apply supabase/schema-quotes.sql to store and triage leads here.</p>';
      return;
    }
    if (!state.companies?.length) {
      try { state.companies = (await api('/api/admin/companies?limit=500')).companies || []; } catch { state.companies = []; }
    }
    const view = state.quotesView || 'list';
    if (view === 'board') { await renderBoard(); return; }
    if (view === 'report') { await renderReport(); return; }
    renderList();
  }

  // Row + board actions delegated once on the stable #admQuotes container (#36).
  function wireQuotes() {
    const box = $('admQuotes');
    if (!box) return;
    delegate(box, 'click', '[data-load-more-quotes]', () => renderQuotePipeline({ append: true }));

    // Board: open drawer, drag, and the keyboard stage select.
    delegate(box, 'click', '[data-card-id]', (event, card) => {
      if (event.target.closest('select')) return;
      const q = (state.quotes || []).find((x) => String(x.id) === card.dataset.cardId);
      if (q) openQuoteDrawer(q);
    });
    delegate(box, 'keydown', '[data-card-id]', (event, card) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('select')) return;
      event.preventDefault();
      const q = (state.quotes || []).find((x) => String(x.id) === card.dataset.cardId);
      if (q) openQuoteDrawer(q);
    });
    delegate(box, 'change', '[data-card-stage]', (event, sel) => moveStage(sel.dataset.cardStage, sel.value));
    delegate(box, 'dragstart', '[data-card-id]', (event, card) => { dragId = card.dataset.cardId; card.classList.add('is-dragging'); });
    delegate(box, 'dragend', '[data-card-id]', (event, card) => card.classList.remove('is-dragging'));
    delegate(box, 'dragover', '[data-col]', (event, col) => { event.preventDefault(); col.classList.add('is-over'); });
    delegate(box, 'dragleave', '[data-col]', (event, col) => col.classList.remove('is-over'));
    delegate(box, 'drop', '[data-col]', (event, col) => {
      event.preventDefault();
      col.classList.remove('is-over');
      if (dragId) { const id = dragId; dragId = null; moveStage(id, col.dataset.col); }
    });

    // List: bulk selection + actions.
    delegate(box, 'click', '.q-check', (event) => event.stopPropagation());
    delegate(box, 'change', '#qAll', (event, all) => box.querySelectorAll('.q-check').forEach((c) => { c.checked = all.checked; }));
    delegate(box, 'click', '#qBulkApply', async (event, button) => {
      const ids = [...box.querySelectorAll('.q-check:checked')].map((c) => c.value);
      if (!ids.length) { message('qStatus', 'Select at least one lead.', 'err'); return; }
      const stage = box.querySelector('#qBulkStage')?.value || '';
      const priority = box.querySelector('#qBulkPriority')?.value || '';
      const owner = box.querySelector('#qBulkOwner')?.value.trim() || '';
      const payload = { ids };
      if (stage) payload.pipeline_stage = stage;
      if (priority) payload.priority = priority;
      if (owner) payload.assigned_to = owner;
      if (Object.keys(payload).length === 1) { message('qStatus', 'Pick a stage, priority or owner to apply.', 'err'); return; }
      button.disabled = true;
      try {
        const res = await api('/api/admin/quotes', { method: 'POST', body: payload });
        message('qStatus', `Updated ${res.updated ?? ids.length} lead(s).`, 'ok');
        await renderQuotePipeline({ refetch: true });
      } catch (err) {
        message('qStatus', err.data?.error || 'Bulk update failed. Retry.', 'err');
        button.disabled = false;
      }
    });

    // List: open drawer + the existing row controls.
    delegate(box, 'click', '[data-open-quote]', (event, button) => {
      const q = (state.quotes || []).find((x) => String(x.id) === button.dataset.openQuote);
      if (q) openQuoteDrawer(q);
    });
    delegate(box, 'click', '[data-save-quote]', async (event, button) => {
      const id = button.dataset.saveQuote;
      button.disabled = true;
      try {
        const stageEl = box.querySelector(`[data-quote-stage="${CSS.escape(id)}"]`);
        const dealEl = box.querySelector(`[data-quote-deal="${CSS.escape(id)}"]`);
        await api('/api/admin/quotes', {
          method: 'POST',
          body: {
            id,
            pipeline_stage: stageEl ? stageEl.value : undefined,
            status: box.querySelector(`[data-quote-status="${CSS.escape(id)}"]`).value,
            priority: box.querySelector(`[data-quote-priority="${CSS.escape(id)}"]`).value,
            assigned_to: box.querySelector(`[data-quote-owner="${CSS.escape(id)}"]`).value,
            next_step: box.querySelector(`[data-quote-next-step="${CSS.escape(id)}"]`).value,
            due_at: box.querySelector(`[data-quote-due-at="${CSS.escape(id)}"]`).value,
            notes: box.querySelector(`[data-quote-notes="${CSS.escape(id)}"]`).value,
            deal_value: dealEl ? (dealEl.value === '' ? null : dealEl.value) : undefined,
          },
        });
        message('qStatus', 'Lead saved.', 'ok');
        await renderQuotePipeline({ refetch: false });
      } catch (err) {
        message('qStatus', err.data?.error || 'Could not save the lead. Retry.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-snooze-quote]', async (event, button) => {
      const id = button.dataset.snoozeQuote;
      button.disabled = true;
      try {
        await api('/api/admin/quotes', { method: 'POST', body: { id, status: 'contacted', next_step: 'Snoozed for two days', due_at: quoteDueInDays(2) } });
        message('qStatus', 'Follow-up snoozed.', 'ok');
        await renderQuotePipeline({ refetch: false });
      } catch (err) {
        message('qStatus', err.data?.error || 'Could not snooze the follow-up. Retry.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-followup]', async (event, button) => {
      const id = button.dataset.followup;
      button.disabled = true;
      try {
        await api('/api/admin/quotes', {
          method: 'POST',
          body: {
            id,
            action: 'followup',
            next_step: box.querySelector(`[data-quote-next-step="${CSS.escape(id)}"]`).value,
            due_at: box.querySelector(`[data-quote-due-at="${CSS.escape(id)}"]`).value,
          },
        });
        message('qStatus', 'Follow-up sent.', 'ok');
        await renderQuotePipeline({ refetch: false });
      } catch (err) {
        message('qStatus', err.data?.error || 'Could not send the follow-up. Retry.', 'err');
        button.disabled = false;
      }
    });
  }

  return { renderQuotePipeline, wireQuotes };
}
