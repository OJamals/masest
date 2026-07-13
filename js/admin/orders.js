// Admin orders tab (#36 per-tab split). Order list with status/tracking/QBO/refund
// controls and NET-aging badges. Shared primitives ($, api, state, message,
// admSkeleton, admEmpty) and the admin-local statusBadge / admListPager helpers are
// injected; esc/money/dateTime/confirmDialog come from util.js and the dirty-edit
// helpers from edits.js. The order-status list and refund-blocking set live here.
import { esc, money, dateTime as date, confirmDialog, delegate, detailDialog, rowMatchesQuery } from '../util.js?v=20260711t';
import { captureDirty, restoreDirty } from './edits.js?v=20260711t';
import { createSavedViews } from './saved-views.js?v=20260711t';

export const ORDER_STATUSES = ['pending_payment', 'paid', 'net_open', 'net_paid', 'fulfilled', 'cancelled', 'refunded'];
const OPEN_NET_STATUS_OPTIONS = ['net_open', 'cancelled'];

export function createOrdersTab({ $, api, state, message, admSkeleton, admEmpty, statusBadge, admListPager, refreshStats }) {
  const REFUND_BLOCKING_STATUSES = new Set(['cancelled', 'refunded']);

  function qboReconciliation(order) {
    const parts = [];
    if (order.qbo_doc_id) parts.push(`${order.qbo_doc_type || 'qbo'} ${order.qbo_doc_id}`);
    if (order.qbo_payment_id) parts.push(`payment ${order.qbo_payment_id}`);
    if (order.qbo_intuit_tid) parts.push(`tid ${order.qbo_intuit_tid}`);
    if (order.qbo_payment_intuit_tid) parts.push(`payment tid ${order.qbo_payment_intuit_tid}`);
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

  const LIFECYCLE_LABELS = {
    cart: 'Cart',
    payment_pending: 'Payment pending',
    unfulfilled: 'Unfulfilled',
    fulfilling: 'Fulfilling',
    shipped: 'Shipped',
    fulfilled: 'Fulfilled',
    delivered_payment_due: 'Delivered, payment due',
    complete: 'Complete',
    blocked: 'Fulfillment hold',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
  };

  function lifecycleFor(order = {}) {
    if (order.lifecycle?.stage) return order.lifecycle;
    const status = String(order.status || '').trim();
    const tracking = String(order.tracking_status || 'processing').trim();
    const settled = ['paid', 'net_paid', 'fulfilled'].includes(status);
    let stage = 'unfulfilled';
    if (status === 'cart' || status === 'cancelled' || status === 'refunded') stage = status;
    else if (status === 'pending_payment') stage = 'payment_pending';
    else if (tracking === 'blocked') stage = 'blocked';
    else if (tracking === 'delivered') stage = settled ? 'complete' : 'delivered_payment_due';
    else if (tracking === 'shipped') stage = 'shipped';
    else if (tracking === 'packing') stage = 'fulfilling';
    else if (status === 'fulfilled') stage = 'fulfilled';
    return {
      stage,
      label: LIFECYCLE_LABELS[stage] || stage,
      next_action: stage === 'delivered_payment_due' ? 'record_payment'
        : stage === 'complete' ? 'complete'
          : stage === 'blocked' ? 'resolve_hold'
            : stage === 'payment_pending' ? 'collect_payment'
              : stage === 'unfulfilled' ? 'fulfill_order'
                : stage === 'fulfilling' ? 'add_tracking'
                  : stage === 'shipped' || stage === 'fulfilled' ? 'monitor_delivery'
                    : 'closed',
    };
  }

  function nextActionLabel(action) {
    return ({
      collect_payment: 'Collect payment',
      fulfill_order: 'Fulfill order',
      add_tracking: 'Add tracking',
      monitor_delivery: 'Monitor delivery',
      record_payment: 'Record payment',
      resolve_hold: 'Resolve hold',
      complete: 'Complete',
      closed: 'Closed',
    })[action] || 'Review order';
  }

  function lifecycleSummary(order) {
    const lifecycle = lifecycleFor(order);
    return `<div class="admin-order-lifecycle"><span>Lifecycle</span><b>${statusBadge(lifecycle.stage, lifecycle.label)}</b><small class="muted">${esc(nextActionLabel(lifecycle.next_action))}</small></div>`;
  }

  function orderStatusOptions(selected, order = {}) {
    const statuses = order.payment_method === 'net' && order.status === 'net_open'
      ? OPEN_NET_STATUS_OPTIONS
      : ORDER_STATUSES;
    return statuses
      .filter((status) => status !== 'refunded' || selected === 'refunded')
      .map((status) => `<option value="${status}" ${status === selected ? 'selected' : ''}>${status.replaceAll('_', ' ')}</option>`)
      .join('');
  }

  function paymentOptions(selected) {
    return ['net', 'stripe']
      .map((method) => `<option value="${method}" ${method === selected ? 'selected' : ''}>${method === 'net' ? 'NET / invoice' : 'Card / external'}</option>`)
      .join('');
  }

  function orderItemsText(order) {
    return (order.order_items || [])
      .map((item) => [
        item.sku || '',
        item.product_sku || '',
        item.name || item.sku || '',
        item.qty || 1,
        item.unit_price || 0,
        item.backordered ? 'yes' : '',
      ].join(' | '))
      .join('\n');
  }

  function parseOrderItemLines(raw) {
    const rows = String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!rows.length) throw new Error('Add at least one line item.');
    return rows.map((line) => {
      const parts = line.split('|').map((part) => part.trim());
      let sku, product_sku, name, qty, unit_price, backordered;
      if (parts.length >= 5) {
        [sku, product_sku, name, qty, unit_price, backordered] = parts;
      } else if (parts.length === 4) {
        [sku, name, qty, unit_price] = parts;
        product_sku = '';
      } else {
        throw new Error('Use SKU | Product SKU | Name | Qty | Unit price for each item.');
      }
      const nQty = Math.floor(Number(qty));
      const nPrice = Number(unit_price);
      if (!sku || !name || !Number.isFinite(nQty) || nQty <= 0 || !Number.isFinite(nPrice) || nPrice < 0) {
        throw new Error('Each item needs a SKU, name, positive quantity, and valid unit price.');
      }
      return {
        sku,
        product_sku: product_sku || null,
        name,
        qty: nQty,
        unit_price: nPrice,
        backordered: /^(y|yes|true|1)$/i.test(backordered || ''),
      };
    });
  }

  function orderEditor(order) {
    const id = esc(order.id);
    return `<details class="adm-order-editor" data-capability-scope="order.write">
      <summary>Edit order</summary>
      <div class="adm-form-grid">
        <label class="wide">Customer email <input class="adm-input" data-edit-email="${id}" type="email" value="${esc(order.customer_email || '')}"></label>
        <label class="wide">Company ID <input class="adm-input" data-edit-company="${id}" value="${esc(order.company_id || '')}"></label>
        <label>Status <select class="adm-select" data-edit-status="${id}">${orderStatusOptions(order.status, order)}</select></label>
        <label>Payment <select class="adm-select" data-edit-payment="${id}">${paymentOptions(order.payment_method || 'net')}</select></label>
        <label>Subtotal <input class="adm-input" data-edit-subtotal="${id}" type="number" min="0" step="0.01" value="${esc(order.subtotal ?? '')}"></label>
        <label>Tax <input class="adm-input" data-edit-tax="${id}" type="number" min="0" step="0.01" value="${esc(order.tax ?? 0)}"></label>
        <label>Total <input class="adm-input" data-edit-total="${id}" type="number" min="0" step="0.01" value="${esc(order.total ?? order.subtotal ?? '')}"></label>
        <label>Currency <input class="adm-input" data-edit-currency="${id}" value="${esc(order.currency || 'usd')}"></label>
        <label class="full">Line items <textarea class="adm-textarea adm-order-lines" data-edit-items="${id}">${esc(orderItemsText(order))}</textarea></label>
        <button class="btn btn-primary btn-sm" data-save-order-edit="${id}" type="button">Save changes</button>
        <button class="btn btn-ghost btn-sm adm-order-danger" data-delete-order="${id}" data-capability="order.delete" type="button">Remove order</button>
      </div>
    </details>`;
  }

  function trackingControls(order) {
    const id = esc(order.id);
    const eta = order.estimated_delivery_at ? new Date(order.estimated_delivery_at).toISOString().slice(0, 16) : '';
    return `${qboReconciliation(order)}<details class="adm-track" data-capability-scope="admin.write"><summary>${statusBadge(order.tracking_status || 'processing')}</summary>
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
        const searchTerm = $('ordSearch')?.value.trim();
        if (searchTerm) params.set('search', searchTerm);
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
    const orders = state.orders.filter((order) => rowMatchesQuery(order, q));
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
        <input class="adm-input admin-input-sm" data-qbo-invoice-input="${id}" data-capability="company.credit" value="${esc(order.qbo_invoice_id || '')}" placeholder="QBO invoice ID" aria-label="QuickBooks invoice ID for order ${id}">
        <button class="btn btn-ghost btn-sm" data-qbo-order="${id}" data-capability="company.credit" type="button">${order.qbo_invoice_id ? 'Update invoice' : 'Add invoice'}</button>
        <input class="adm-input admin-input-sm" data-qbo-payment-input="${id}" data-capability="company.credit" value="${esc(order.qbo_payment_id || '')}" placeholder="QBO payment ID" aria-label="QuickBooks payment ID for order ${id}">
        <button class="btn btn-ghost btn-sm" data-qbo-payment-order="${id}" data-capability="company.credit" type="button">${order.qbo_payment_id ? 'Update payment' : 'Add payment'}</button>
        ${order.status === 'net_open' ? `<button class="btn btn-primary btn-sm" data-mark-net-paid-order="${id}" data-capability="company.credit" type="button" aria-label="Mark NET order ${id} paid">Mark NET paid</button>` : ''}` : '';
      const refundControls = order.payment_method === 'stripe' && order.stripe_payment_intent && !REFUND_BLOCKING_STATUSES.has(order.status) ? `
        <input class="adm-input admin-input-md" data-refund-amount="${id}" data-capability="order.refund" type="number" min="0" step="0.01" placeholder="Amount (blank = full)" aria-label="Partial refund amount for order ${id} (leave blank to refund the full balance)">
        <button class="btn btn-ghost btn-sm" data-refund-order="${id}" data-capability="order.refund" type="button">Refund</button>
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
          ${lifecycleSummary(order)}
          <label><span>Status</span><select class="adm-select" data-order-status="${id}" data-capability="order.write">${orderStatusOptions(order.status, order)}</select></label>
        </div>
        <div class="admin-order-actions">
          <button class="btn btn-ghost btn-sm" data-order-detail="${id}" type="button">Details</button>
          ${orderEditor(order)}
          ${trackingControls(order)}
          <button class="btn btn-ghost btn-sm" data-save-order="${id}" data-capability="order.write" type="button">Save</button>
          ${netControls}
          ${refundControls}
        </div>
      </article>`;
    }).join('')}</div>` + admOrdersPager();
    restoreDirty(box, snap);
  }

  // Refresh a single mutated order in place and re-render without refetching:
  // a bare renderOrders() resets the list to page 1, so any order staff reached
  // via "Load more" would vanish after acting on it (same pattern as quotes.js).
  async function refreshOrder(id) {
    try {
      const res = await api('/api/admin/orders?id=' + encodeURIComponent(id));
      const idx = (state.orders || []).findIndex((o) => String(o.id) === String(id));
      if (idx >= 0 && res.order) state.orders[idx] = { ...state.orders[idx], ...res.order };
    } catch { /* render from current state; the next full refetch reconciles */ }
    await renderOrders({ refetch: false });
  }

  function createOrderBody() {
    return {
      action: 'create_order',
      company_id: $('ordCreateCompany')?.value.trim() || null,
      customer_email: $('ordCreateEmail')?.value.trim() || null,
      status: $('ordCreateStatus')?.value,
      payment_method: $('ordCreatePayment')?.value,
      subtotal: $('ordCreateSubtotal')?.value,
      tax: $('ordCreateTax')?.value,
      total: $('ordCreateTotal')?.value,
      currency: $('ordCreateCurrency')?.value.trim() || 'usd',
      items: parseOrderItemLines($('ordCreateItems')?.value),
    };
  }

  function editOrderBody(box, id) {
    const pick = (name) => box.querySelector(`[data-edit-${name}="${CSS.escape(id)}"]`);
    return {
      id,
      action: 'update_order',
      company_id: pick('company')?.value.trim() || null,
      customer_email: pick('email')?.value.trim() || null,
      status: pick('status')?.value,
      payment_method: pick('payment')?.value,
      subtotal: pick('subtotal')?.value,
      tax: pick('tax')?.value,
      total: pick('total')?.value,
      currency: pick('currency')?.value.trim() || 'usd',
      items: parseOrderItemLines(pick('items')?.value),
    };
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
    const lifecycle = lifecycleFor(order);
    return `<h3 style="margin:0 0 4px">Order ${esc(order.id)}</h3>
      <p class="muted" style="margin:0 0 12px">${esc(order.companies?.name || order.company_id || 'Guest')} · ${esc(order.customer_email || '')} · ${esc(lifecycle.label)} · ${esc(order.status)} · ${esc(order.payment_method || '')}</p>
      <table class="adm" style="width:100%"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Line</th></tr></thead><tbody>${items}</tbody></table>
      <p style="margin:12px 0 0"><b>Total</b> ${esc(money(order.total ?? order.subtotal, order.currency))}${Number(order.tax) ? ` (tax ${esc(money(order.tax, order.currency))})` : ''}${Number(order.refunded_amount) > 0 ? ` · refunded ${esc(money(order.refunded_amount, order.currency))}` : ''}</p>
      <h4 style="margin:16px 0 4px">Ship to</h4><p style="margin:0">${shipLines}</p>
      ${shipHistory}
      <h4 style="margin:16px 0 4px">Staff timeline</h4><ul style="margin:0;padding-left:18px">${events}</ul>`;
  }

  function wireOrders() {
    const box = $('admOrders');
    if (!box) return;
    const createForm = $('ordCreateForm');
    if (createForm && !createForm.dataset.wired) {
      createForm.dataset.wired = '1';
      createForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = $('ordCreateSubmit');
        let body;
        try {
          body = createOrderBody();
        } catch (err) {
          message('ordCreateStatusText', err.message || 'Check the line items.', 'err');
          return;
        }
        button.disabled = true;
        message('ordCreateStatusText', 'Creating order...');
        try {
          await api('/api/admin/orders', { method: 'POST', body });
          message('ordCreateStatusText', 'Order created.', 'ok');
          createForm.reset();
          if ($('ordCreateStatus')) $('ordCreateStatus').value = 'net_open';
          if ($('ordCreatePayment')) $('ordCreatePayment').value = 'net';
          if ($('ordCreateTax')) $('ordCreateTax').value = '0';
          if ($('ordCreateCurrency')) $('ordCreateCurrency').value = 'usd';
          state.orders = [];
          state.ordersOffset = 0;
          await renderOrders({ refetch: true });
          await refreshStats?.();
        } catch (err) {
          message('ordCreateStatusText', err.data?.message || err.data?.error || 'Could not create the order. Retry.', 'err');
        } finally {
          button.disabled = false;
        }
      });
    }
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
      // Cancelling is destructive (can trigger customer notification/credit release) —
      // confirm, matching the refund/mark-NET-paid actions on this same tab.
      if (status === 'cancelled' && !(await confirmDialog('Cancel this order? The customer may be notified and any reserved stock released.', { confirmText: 'Cancel order', cancelText: 'Keep', danger: true }))) return;
      button.disabled = true;
      try {
        await api('/api/admin/orders', { method: 'POST', body: { id, status } });
        await refreshOrder(id);
      } catch (err) {
        message('ordStatus', (err.data && err.data.error) || 'Could not save the order status. Retry.', 'err');
      } finally {
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-save-order-edit]', async (event, button) => {
      const id = button.dataset.saveOrderEdit;
      let body;
      try {
        body = editOrderBody(box, id);
      } catch (err) {
        message('ordStatus', err.message || 'Check the order fields.', 'err');
        return;
      }
      if (body.status === 'cancelled' && !(await confirmDialog('Cancel this order? The customer may be notified and any reserved stock released.', { confirmText: 'Cancel order', cancelText: 'Keep', danger: true }))) return;
      button.disabled = true;
      try {
        await api('/api/admin/orders', { method: 'POST', body });
        message('ordStatus', 'Order updated.', 'ok');
        await refreshOrder(id);
        await refreshStats?.();
      } catch (err) {
        message('ordStatus', err.data?.message || err.data?.error || 'Could not update the order. Retry.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-delete-order]', async (event, button) => {
      const id = button.dataset.deleteOrder;
      if (!(await confirmDialog('Remove this order permanently? This deletes the order row, line items, and shipment history.', { confirmText: 'Remove order', cancelText: 'Keep', danger: true }))) return;
      button.disabled = true;
      try {
        await api('/api/admin/orders', { method: 'POST', body: { id, action: 'delete_order' } });
        state.orders = (state.orders || []).filter((order) => String(order.id) !== String(id));
        if (state.ordersTotal != null) state.ordersTotal = Math.max(0, state.ordersTotal - 1);
        message('ordStatus', 'Order removed.', 'ok');
        await renderOrders({ refetch: false });
        await refreshStats?.();
      } catch (err) {
        message('ordStatus', err.data?.message || err.data?.error || 'Could not remove the order. Retry.', 'err');
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
        await refreshOrder(id);
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
        await refreshOrder(id);
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
        await refreshOrder(id);
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
        await refreshOrder(id);
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
        await refreshOrder(id);
      } catch (err) {
        message('ordStatus', err.data?.error || 'Could not mark the NET balance paid. Retry.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-load-more-orders]', () => renderOrders({ append: true }));
  }

  return { renderOrders, wireOrders };
}
