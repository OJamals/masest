// Admin quotes pipeline tab (#36 per-tab split). Quote/lead list with status,
// priority, owner, due-date and conversation controls. Shared primitives ($, api,
// state, message, admSkeleton, admEmpty) and the admin-local statusBadge / badge /
// admListPager helpers are injected; esc comes from util.js and the dirty-edit
// helpers from edits.js. The quote-status list + due-date helper live here.
import { esc } from '../util.js';
import { captureDirty, restoreDirty } from './edits.js';

export function createQuotesTab({ $, api, state, message, admSkeleton, admEmpty, statusBadge, badge, admListPager }) {
  const QUOTE_STATUSES = ['new', 'contacted', 'closed', 'spam'];

  function quoteDueInDays(days) {
    return new Date(Date.now() + days * 86400e3).toISOString();
  }

  async function renderQuotePipeline({ append = false, refetch = true } = {}) {
    const box = $('admQuotes');
    const snap = captureDirty(box);
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
    if (state.quotesNeedsMigration) {
      box.innerHTML = '<p class="muted">No quote database yet. Apply supabase/schema-quotes.sql to store and triage leads here.</p>';
      return;
    }
    if (!state.companies?.length) {
      try { state.companies = (await api('/api/admin/companies?limit=500')).companies || []; } catch { state.companies = []; }
    }
    const quotesPager = admListPager('data-load-more-quotes', state.quotes.length, state.quotesTotal, state.quotesHasMore);
    const wireQuotesMore = () => box.querySelector('[data-load-more-quotes]')?.addEventListener('click', () => renderQuotePipeline({ append: true }));

    const coOpts = (state.companies || [])
      .map((company) => `<option value="${esc(company.id)}">${esc(company.name)} (${esc(company.status || '')})</option>`)
      .join('');
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
      wireQuotesMore();
      return;
    }

    box.innerHTML = quotes.map((quote) => {
      const id = esc(quote.id);
      const dueValue = quote.due_at ? new Date(quote.due_at).toISOString().slice(0, 16) : '';
      const score = Number.isFinite(Number(quote.lead_score)) ? Number(quote.lead_score) : 0;
      return `
        <details class="quote-item">
          <summary>
            <b>${esc(quote.company || quote.name || quote.email)}</b>
            ${statusBadge(quote.status || 'new')}
            ${statusBadge(quote.priority || 'normal')}
            <span class="muted">Score ${esc(score)}</span>
          </summary>
          <p>${esc(quote.message || '')}</p>
          <div class="adm-tools" style="margin-top:8px;align-items:end;flex-wrap:wrap">
            <select class="adm-select" data-quote-status="${id}">
              ${QUOTE_STATUSES.map((status) => `<option value="${status}" ${status === quote.status ? 'selected' : ''}>${status}</option>`).join('')}
            </select>
            <select class="adm-select" data-quote-priority="${id}">
              ${['urgent', 'high', 'normal', 'low'].map((value) => `<option value="${value}" ${value === (quote.priority || 'normal') ? 'selected' : ''}>${value}</option>`).join('')}
            </select>
            <input class="adm-input" data-quote-next-step="${id}" value="${esc(quote.next_step || '')}" placeholder="Next step" style="max-width:220px">
            <input class="adm-input" data-quote-owner="${id}" value="${esc(quote.assigned_to || '')}" placeholder="Owner" style="max-width:160px">
            <input class="adm-input" data-quote-due-at="${id}" type="datetime-local" value="${esc(dueValue)}" aria-label="Follow-up due" style="max-width:190px">
            <button class="btn btn-ghost btn-sm" data-save-quote="${id}" type="button">Save</button>
            <button class="btn btn-ghost btn-sm" data-snooze-quote="${id}" type="button">Snooze 2d</button>
            <button class="btn btn-ghost btn-sm" data-followup="${id}" type="button">Send follow-up</button>
            <a class="btn btn-ghost btn-sm" href="mailto:${esc(quote.email || '')}?subject=${encodeURIComponent('MASEST quote request')}">Email</a>
          </div>
          <textarea class="adm-textarea" data-quote-notes="${id}" placeholder="Internal notes">${esc(quote.notes || '')}</textarea>
          <div class="adm-tools" style="margin-top:8px;align-items:end;flex-wrap:wrap">
            <select class="adm-select" data-conv-co="${id}" style="max-width:200px"><option value="">Convert to order for...</option>${coOpts}</select>
            <input class="adm-input" data-conv-sku="${id}" placeholder="SKU" style="max-width:120px">
            <input class="adm-input" data-conv-name="${id}" placeholder="Item name" style="max-width:150px">
            <input class="adm-input" type="number" min="1" value="1" data-conv-qty="${id}" style="max-width:64px" aria-label="Qty">
            <input class="adm-input" type="number" min="0" step="0.01" data-conv-price="${id}" placeholder="Unit $" style="max-width:90px">
            <button class="btn btn-ghost btn-sm" data-convert="${id}" type="button">Convert to order</button>
          </div>
        </details>
      `;
    }).join('') + quotesPager;
    restoreDirty(box, snap);
    wireQuotesMore();

    box.querySelectorAll('[data-save-quote]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.saveQuote;
        button.disabled = true;
        try {
          await api('/api/admin/quotes', {
            method: 'POST',
            body: {
          id,
          status: box.querySelector(`[data-quote-status="${CSS.escape(id)}"]`).value,
          priority: box.querySelector(`[data-quote-priority="${CSS.escape(id)}"]`).value,
          assigned_to: box.querySelector(`[data-quote-owner="${CSS.escape(id)}"]`).value,
          next_step: box.querySelector(`[data-quote-next-step="${CSS.escape(id)}"]`).value,
              due_at: box.querySelector(`[data-quote-due-at="${CSS.escape(id)}"]`).value,
              notes: box.querySelector(`[data-quote-notes="${CSS.escape(id)}"]`).value,
            },
          });
          message('qStatus', 'Lead saved.', 'ok');
          await renderQuotePipeline();
        } catch (err) {
          message('qStatus', err.data?.error || 'Could not save the lead. Retry.', 'err');
          button.disabled = false;
        }
      });
    });

    box.querySelectorAll('[data-convert]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.convert;
        const pick = (key) => box.querySelector(`[data-conv-${key}="${CSS.escape(id)}"]`);
        const company_id = pick('co').value;
        const sku = pick('sku').value.trim();
        const name = pick('name').value.trim();
        const qty = pick('qty').value;
        const unit_price = pick('price').value;
        if (!company_id) { message('qStatus', 'Pick a company to convert into.', 'err'); return; }
        if (!sku || unit_price === '') { message('qStatus', 'SKU and unit price are required.', 'err'); return; }
        button.disabled = true;
        message('qStatus', 'Creating order...');
        try {
          const res = await api('/api/admin/quotes', { method: 'POST', body: { id, action: 'convert', company_id, items: [{ sku, name, qty, unit_price }] } });
          message('qStatus', `Order ${res.order_id} created.`, 'ok');
          await renderQuotePipeline();
        } catch (err) {
          message('qStatus', err.data?.error || 'Could not convert the lead. Refresh and check for a new order before retrying.', 'err');
          button.disabled = false;
        }
      });
    });

    box.querySelectorAll('[data-snooze-quote]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.snoozeQuote;
        button.disabled = true;
        try {
          await api('/api/admin/quotes', {
            method: 'POST',
            body: {
              id,
              status: 'contacted',
              next_step: 'Snoozed for two days',
              due_at: quoteDueInDays(2),
            },
          });
          message('qStatus', 'Follow-up snoozed.', 'ok');
          await renderQuotePipeline();
        } catch (err) {
          message('qStatus', err.data?.error || 'Could not snooze the follow-up. Retry.', 'err');
          button.disabled = false;
        }
      });
    });

    box.querySelectorAll('[data-followup]').forEach((button) => {
      button.addEventListener('click', async () => {
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
          await renderQuotePipeline();
        } catch (err) {
          message('qStatus', err.data?.error || 'Could not send the follow-up. Retry.', 'err');
          button.disabled = false;
        }
      });
    });
  }

  return { renderQuotePipeline };
}
