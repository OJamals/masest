// Admin orders tab (#36 per-tab split). Order list with status/tracking/QBO/refund
// controls and NET-aging badges. Shared primitives ($, api, state, message,
// admSkeleton, admEmpty) and the admin-local statusBadge / admListPager helpers are
// injected; esc/money/dateTime/confirmDialog come from util.js and the dirty-edit
// helpers from edits.js. The order-status list and refund-blocking set live here.
import { esc, money, dateTime as date, confirmDialog, delegate, detailDialog } from '../util.js';
import { captureDirty, restoreDirty } from './edits.js';
import { createSavedViews } from './saved-views.js';

export const ORDER_STATUSES = ['pending_payment', 'paid', 'net_open', 'net_paid', 'fulfilled', 'cancelled', 'refunded'];

export function createOrdersTab({ $, api, state, message, admSkeleton, admEmpty, statusBadge, admListPager }) {
  const REFUND_BLOCKING_STATUSES = new Set(['cancelled', 'refunded']);

  function qboReconciliation(order) {
    const parts = [];
    if (order.qbo_doc_id) parts.push(`${order.qbo_doc_type || 'qbo'} ${order.qbo_doc_id}`);
    if (order.qbo_payment_id) parts.push(`payment ${order.qbo_payment_id}`);
    if (!parts.length) return '';
    return `<div class="muted admin-inline-note">QBO: ${parts.map(esc).join(' / ')}</div>`;
  }

  function netAgingBadge(order) {
    const a = order.net_aging;
    if (!a) return '';
    const label = a.overdue ? `overdue ${a.daysOverdue}d` : `${a.ageDays}d open`;
    const due = a.terms ? `, due ${a.dueIso.slice(0, 10)}` : '';
    const title = `NET ${a.terms} — open ${a.ageDays} day(s)${a.overdue ? `, ${a.daysOverdue} past due` : due}`;
    return `<br><span class="net-age net-age--${esc(a.bucket)}" title="${esc(title)}">${esc(label)}</span>`;
  }

  function trackingControls(order) {
    const id = esc(order.id);
    const eta = order.estimated_delivery_at ? new Date(order.estimated_delivery_at).toISOString().slice(0, 16) : '';
    return `${qboReconciliation(order)}<details class="adm-track"><summary>${statusBadge(order.tracking_status || 'processing')}</summary>
      <div class="adm-track-controls">
        <select class="adm-select" data-track-status="${id}">
          ${['processing', 'packing', 'shipped', 'delivered', 'blocked'].map((status) => `<option value="${status}" ${status === (order.tracking_status || 'processing') ? 'selected' : ''}>${status.replaceAll('_', ' ')}</option>`).join('')}
        </select>
        <input class="adm-input" data-track-carrier="${id}" value="${esc(order.carrier || '')}" placeholder="Carrier">
        <input class="adm-input" data-track-number="${id}" value="${esc(order.tracking_number || '')}" placeholder="Tracking #">
        <input class="adm-input admin-input-wide" data-track-url="${id}" value="${esc(order.tracking_url || '')}" placeholder="Tracking URL">
        <input class="adm-input" data-track-eta="${id}" value="${esc(eta)}" type="datetime-local" aria-label="Estimated delivery">
        <input class="adm-input admin-input-wide" data-track-note="${id}" placeholder="Note (shown to customer)" aria-label="Shipment note">
        <button class="btn btn-ghost btn-sm" data-save-tracking="${id}" type="button">Save tracking</button>
      </div>
    </details>`;
  }

  function admOrdersPager() {
    if (!state.ordersHasMore) return '';
    const count = state.ordersTotal != null ? ` (${state.orders.length} of ${state.ordersTotal})` : '';
    return `<div class="adm-list-pager"><button class="btn btn-ghost btn-sm" data-load-more-orders type="button">Load more${count}</button></div>`;
  }

  // Saved filter views (status + search), injected once above #admOrders. Reuses the
  // quotes-tab helper with an 'orders' key so the two tabs keep separate saved views.
  const savedViews = createSavedViews({
    key: 'orders',
    getFilters: () => ({ status: $('ordFilter')?.value || '', search: $('ordSearch')?.value || '' }),
    applyFilters: (f) => {
      if ($('ordFilter')) $('ordFilter').value = f.status || '';
      if ($('ordSearch')) $('ordSearch').value = f.search || '';
      renderOrders({ refetch: true }); // status is a server-side filter → refetch
    },
  });
  function ensureSavedViews() {
    const box = $('admOrders');
    if (box) savedViews.mount(box);
  }

  async function renderOrders({ append = false, refetch = true } = {}) {
    const box = $('admOrders');
    ensureSavedViews();
    const snap = captureDirty(box);
    const status = $('ordFilter').value;
    if (refetch) {
      if (!append) { state.orders = []; state.ordersOffset = 0; box.innerHTML = admSkeleton(); }
      try {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        params.set('limit', '100');
        params.set('offset', String(state.ordersOffset || 0));
        const res = await api('/api/admin/orders?' + params.toString());
        state.orders = (state.orders || []).concat(res.orders || []);
        state.ordersOffset = (state.ordersOffset || 0) + (res.orders || []).length;
        state.ordersTotal = res.total;
        state.ordersHasMore = !!res.has_more;
        state.loaded.add('orders');
      } catch {
        if (!append) box.innerHTML = '<p class="adm-status" data-state="err">Could not load orders. Reload to retry.</p>';
        return;
      }
    }
    const q = $('ordSearch').value.trim().toLowerCase();
    const orders = state.orders.filter((order) => JSON.stringify(order).toLowerCase().includes(q));
    if (!orders.length) {
      box.innerHTML = admEmpty('ph-package', q ? 'No matching orders' : 'No orders yet', q ? 'No orders match your search.' : 'Orders appear here once customers check out.') + admOrdersPager();
      return;
    }
    box.innerHTML = `<div class="admin-order-list">${orders.map((order) => {
      const id = esc(order.id);
      const items = (order.order_items || [])
        .map((item) => `<li>${esc(item.qty)} x ${esc(item.name || item.sku)}</li>`)
        .join('');
      const netControls = order.payment_method === 'net' ? `
        <input class="adm-input admin-input-sm" data-qbo-invoice-input="${id}" value="${esc(order.qbo_invoice_id || '')}" placeholder="QBO invoice ID" aria-label="QuickBooks invoice ID for order ${id}">
        <button class="btn btn-ghost btn-sm" data-qbo-order="${id}" type="button">${order.qbo_invoice_id ? 'Update invoice' : 'Add invoice'}</button>
        <input class="adm-input admin-input-sm" data-qbo-payment-input="${id}" value="${esc(order.qbo_payment_id || '')}" placeholder="QBO payment ID" aria-label="QuickBooks payment ID for order ${id}">
        <button class="btn btn-ghost btn-sm" data-qbo-payment-order="${id}" type="button">${order.qbo_payment_id ? 'Update payment' : 'Add payment'}</button>
        ${order.status === 'net_open' ? `<button class="btn btn-primary btn-sm" data-mark-net-paid-order="${id}" type="button" aria-label="Mark NET order ${id} paid">Mark NET paid</button>` : ''}` : '';
      const refundControls = order.payment_method === 'stripe' && !REFUND_BLOCKING_STATUSES.has(order.status) ? `
        <input class="adm-input admin-input-md" data-refund-amount="${id}" type="number" min="0" step="0.01" placeholder="Amount (blank = full)" aria-label="Partial refund amount for order ${id} (leave blank to refund the full balance)">
        <button class="btn btn-ghost btn-sm" data-refund-order="${id}" type="button">Refund</button>
        ${Number(order.refunded_amount) > 0 ? `<span class="muted admin-inline-note">refunded ${esc(money(order.refunded_amount, order.currency))}</span>` : ''}` : '';
      return `<article class="admin-order-card">
        <div class="admin-order-head">
          <div>
            <span class="admin-kicker">${esc(date(order.created_at))}</span>
            <h3>${esc(order.companies?.name || order.company_name || order.company_id || 'Guest')}</h3>
          </div>
          <b>${esc(money(order.total ?? order.subtotal, order.currency))}</b>
        </div>
        <div class="admin-order-meta">
          <div><span>Items</span><ul class="admin-order-items">${items || '<li class="muted">No items</li>'}</ul></div>
          <div><span>Pay</span><b>${esc(order.payment_method || '')}${netAgingBadge(order)}</b></div>
          <label><span>Status</span><select class="adm-select" data-order-status="${id}">${ORDER_STATUSES.map((s) => `<option value="${s}" ${s === order.status ? 'selected' : ''}>${s.replaceAll('_', ' ')}</option>`).join('')}</select></label>
        </div>
        <div class="admin-order-actions">
          <button class="btn btn-ghost btn-sm" data-order-detail="${id}" type="button">Details</button>
          ${trackingControls(order)}
          <button class="btn btn-ghost btn-sm" data-save-order="${id}" type="button">Save</button>
          ${netControls}
          ${refundControls}
        </div>
      </article>`;
    }).join('')}</div>` + admOrdersPager();
    restoreDirty(box, snap);
  }

  // Row actions are delegated once on the stable #admOrders container (#36): a single
  // listener per action survives every innerHTML re-render instead of re-binding per row.
  function orderDetailHtml(order, timeline) {
    const addr = order.ship_address?.address || order.ship_address || null;
    const shipLines = addr
      ? [addr.line1, addr.line2, [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '), addr.country]
        .filter(Boolean).map(esc).join('<br>')
      : '<span class="muted">No shipping address</span>';
    const items = (order.order_items || []).map((i) => `<tr>
      <td>${esc(i.name || i.sku)}${i.backordered ? ' <span class="badge badge-warning">backordered</span>' : ''}</td>
      <td style="text-align:center">${esc(i.qty)}</td>
      <td style="text-align:right">${esc(money(i.unit_price, order.currency))}</td>
      <td style="text-align:right">${esc(money(i.line_total, order.currency))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No items</td></tr>';
    const events = (timeline || []).map((e) =>
      `<li><b>${esc(e.action)}</b> — ${esc(date(e.created_at))}${e.actor_email ? ` by ${esc(e.actor_email)}` : ''}</li>`).join('')
      || '<li class="muted">No staff actions recorded</li>';
    const shipEvents = (order.shipment_events || [])
      .slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const shipHistory = shipEvents.length
      ? `<h4 style="margin:16px 0 4px">Shipment history</h4><ul style="margin:0;padding-left:18px">${shipEvents.map((e) =>
          `<li><b>${esc(e.status)}</b> — ${esc(date(e.created_at))}${e.carrier ? ` · ${esc(e.carrier)}` : ''}${e.tracking_number ? ` ${esc(e.tracking_number)}` : ''}${e.note ? ` — ${esc(e.note)}` : ''}</li>`).join('')}</ul>`
      : '';
    return `<h3 style="margin:0 0 4px">Order ${esc(order.id)}</h3>
      <p class="muted" style="margin:0 0 12px">${esc(order.companies?.name || order.company_id || 'Guest')} · ${esc(order.customer_email || '')} · ${esc(order.status)} · ${esc(order.payment_method || '')}</p>
      <table class="adm" style="width:100%"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Line</th></tr></thead><tbody>${items}</tbody></table>
      <p style="margin:12px 0 0"><b>Total</b> ${esc(money(order.total ?? order.subtotal, order.currency))}${Number(order.tax) ? ` (tax ${esc(money(order.tax, order.currency))})` : ''}${Number(order.refunded_amount) > 0 ? ` · refunded ${esc(money(order.refunded_amount, order.currency))}` : ''}</p>
      <h4 style="margin:16px 0 4px">Ship to</h4><p style="margin:0">${shipLines}</p>
      ${shipHistory}
      <h4 style="margin:16px 0 4px">Staff timeline</h4><ul style="margin:0;padding-left:18px">${events}</ul>`;
  }

  function wireOrders() {
    const box = $('admOrders');
    if (!box) return;
    delegate(box, 'click', '[data-order-detail]', async (event, button) => {
      button.disabled = true;
      try {
        const res = await api('/api/admin/orders?id=' + encodeURIComponent(button.dataset.orderDetail));
        detailDialog(orderDetailHtml(res.order, res.timeline));
      } catch (err) {
        message('ordStatus', err.data?.error || 'Could not load order detail. Retry.', 'err');
      } finally {
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-save-order]', async (event, button) => {
      const id = button.dataset.saveOrder;
      const status = box.querySelector(`[data-order-status="${CSS.escape(id)}"]`).value;
      button.disabled = true;
      try {
        await api('/api/admin/orders', { method: 'POST', body: { id, status } });
        await renderOrders();
      } finally {
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-save-tracking]', async (event, button) => {
      const id = button.dataset.saveTracking;
      const pick = (name) => box.querySelector(`[data-track-${name}="${CSS.escape(id)}"]`);
      button.disabled = true;
      try {
        await api('/api/admin/orders', {
          method: 'POST',
          body: {
            id,
            action: 'update_tracking',
            tracking_status: pick('status').value,
            carrier: pick('carrier').value.trim(),
            tracking_number: pick('number').value.trim(),
            tracking_url: pick('url').value.trim(),
            estimated_delivery_at: pick('eta').value,
            note: pick('note').value.trim(),
          },
        });
        message('ordStatus', 'Tracking saved.', 'ok');
        await renderOrders();
      } catch (err) {
        message('ordStatus', err.data?.error || 'Could not update tracking. Retry.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-refund-order]', async (event, button) => {
      const id = button.dataset.refundOrder;
      const amountInput = box.querySelector(`[data-refund-amount="${CSS.escape(id)}"]`);
      const raw = amountInput?.value.trim();
      const amount = raw ? Number(raw) : undefined;
      if (raw && (!Number.isFinite(amount) || amount <= 0)) {
        message('ordStatus', 'Enter a valid refund amount, or leave it blank to refund the full balance.', 'err');
        return;
      }
      const prompt = amount
        ? `Refund $${amount.toFixed(2)} to this order via Stripe?`
        : 'Refund the full remaining balance via Stripe?';
      if (!(await confirmDialog(prompt, { confirmText: 'Refund', danger: true }))) return;
      button.disabled = true;
      message('ordStatus', 'Refunding...');
      try {
        const res = await api('/api/admin/orders', { method: 'POST', body: { id, action: 'refund', amount } });
        message('ordStatus', res.partial ? `Partial refund of $${Number(res.amount).toFixed(2)} issued.` : 'Refunded.', 'ok');
        await renderOrders();
      } catch (err) {
        message('ordStatus', err.data?.error || 'Refund did not go through. Refresh and check before retrying.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-qbo-order]', async (event, button) => {
      const id = button.dataset.qboOrder;
      const invoiceId = box.querySelector(`[data-qbo-invoice-input="${CSS.escape(id)}"]`)?.value.trim();
      if (!invoiceId) { message('ordStatus', 'Enter a QuickBooks invoice ID first.', 'err'); return; }
      button.disabled = true;
      try {
        await api('/api/admin/orders', { method: 'POST', body: { id, action: 'record_qbo_invoice', qbo_invoice_id: invoiceId } });
        message('ordStatus', 'Invoice recorded.', 'ok');
        await renderOrders();
      } catch (err) {
        message('ordStatus', err.data?.error || 'Could not update the invoice. Refresh and check before retrying.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-qbo-payment-order]', async (event, button) => {
      const id = button.dataset.qboPaymentOrder;
      const paymentId = box.querySelector(`[data-qbo-payment-input="${CSS.escape(id)}"]`)?.value.trim();
      if (!paymentId) { message('ordStatus', 'Enter a QuickBooks payment ID first.', 'err'); return; }
      button.disabled = true;
      try {
        await api('/api/admin/orders', { method: 'POST', body: { id, action: 'record_qbo_payment', qbo_payment_id: paymentId } });
        message('ordStatus', 'Payment recorded.', 'ok');
        await renderOrders();
      } catch (err) {
        message('ordStatus', err.data?.error || 'Could not update payment status. Refresh and check before retrying.', 'err');
        button.disabled = false;
      }
    });
    // Manual NET settlement (#10): mark an open NET balance paid without a QuickBooks
    // payment id. Finance action — gated server-side by staffCan('company.credit').
    delegate(box, 'click', '[data-mark-net-paid-order]', async (event, button) => {
      const id = button.dataset.markNetPaidOrder;
      if (!(await confirmDialog('Mark this NET balance as paid? This settles the order and frees the company\'s credit.', { confirmText: 'Mark paid' }))) return;
      button.disabled = true;
      message('ordStatus', 'Marking paid...');
      try {
        await api('/api/admin/orders', { method: 'POST', body: { id, action: 'mark_net_paid' } });
        message('ordStatus', 'NET balance marked paid.', 'ok');
        await renderOrders();
      } catch (err) {
        message('ordStatus', err.data?.error || 'Could not mark the NET balance paid. Retry.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-load-more-orders]', () => renderOrders({ append: true }));
  }

  return { renderOrders, wireOrders };
}
