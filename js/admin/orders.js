// Admin orders tab (#36 per-tab split). Order list with status/tracking/QBO/refund
// controls and NET-aging badges. Shared primitives ($, api, state, message,
// admSkeleton, admEmpty) and the admin-local statusBadge / admListPager helpers are
// injected; esc/money/dateTime/confirmDialog come from util.js and the dirty-edit
// helpers from edits.js. The order-status list and refund-blocking set live here.
import { esc, money, dateTime as date, confirmDialog, delegate, detailDialog, promptDialog, rowMatchesQuery } from '../util.js?v=20260808a';
import { captureDirty, restoreDirty } from './edits.js?v=20260808a';
import { createSavedViews } from './saved-views.js?v=20260808a';

export const ORDER_STATUSES = ['pending_payment', 'paid', 'net_open', 'net_paid', 'fulfilled', 'cancelled', 'refunded'];
/* Lifecycle view rather than a column value: everything still owed a shipment.
   Selects the same rows the Overview "Fulfillment queue" number counts. */
export const NEEDS_FULFILLMENT = 'needs_fulfillment';
const OPEN_NET_STATUS_OPTIONS = ['net_open', 'cancelled'];

export function createOrdersTab({ $, api, apiBlob, state, message, admSkeleton, admEmpty, statusBadge, admListPager, refreshStats }) {
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


  // Manual orders are taken over the phone. They used to be entered as a
  // pipe-delimited blob ("SKU | Product SKU | Name | Qty | Unit price"), which is
  // a data format rather than a UI: no validation until submit, no per-field
  // error, and subtotal/tax/total typed by hand could silently disagree with the
  // lines. These are structured rows with running totals derived from them.
  function orderLineRow(item = {}) {
    return `<div class="adm-order-line-row">
      <input class="adm-input" data-line="sku" placeholder="SKU" aria-label="Line item SKU" autocomplete="off" spellcheck="false" value="${esc(item.sku || '')}">
      <input class="adm-input" data-line="product_sku" placeholder="Product SKU" aria-label="Line item product SKU (optional)" autocomplete="off" spellcheck="false" value="${esc(item.product_sku || '')}">
      <input class="adm-input" data-line="name" placeholder="Name" aria-label="Line item name" autocomplete="off" value="${esc(item.name || '')}">
      <input class="adm-input" data-line="qty" type="number" min="1" step="1" value="${esc(item.qty ?? 1)}" aria-label="Line item quantity">
      <input class="adm-input" data-line="unit_price" type="number" min="0" step="0.01" placeholder="Unit price" aria-label="Line item unit price" value="${esc(item.unit_price ?? '')}">
      <label class="admin-select-all"><input type="checkbox" data-line="backordered" aria-label="Line item backordered"${item.backordered ? ' checked' : ''}> Backordered</label>
      <button class="btn btn-ghost btn-sm" data-line-remove type="button" aria-label="Remove this line item">Remove</button>
    </div>`;
  }

  function orderLineRows(order) {
    const items = order.order_items || [];
    return (items.length ? items : [{}]).map(orderLineRow).join('');
  }

  /* Shared by the create form and the per-order editor so both enforce the same
     contract on a line item. */
  function readLinesFrom(container) {
    const rows = [...(container?.querySelectorAll('.adm-order-line-row') || [])];
    const items = rows.map((row) => {
      const pick = (field) => row.querySelector(`[data-line="${field}"]`);
      return {
        sku: pick('sku')?.value.trim() || '',
        product_sku: pick('product_sku')?.value.trim() || null,
        name: pick('name')?.value.trim() || '',
        qty: Math.floor(Number(pick('qty')?.value)),
        unit_price: Number(pick('unit_price')?.value),
        backordered: Boolean(pick('backordered')?.checked),
      };
    }).filter((item) => item.sku || item.name || item.unit_price);
    if (!items.length) throw new Error('Add at least one line item.');
    for (const item of items) {
      if (!item.sku || !item.name || !Number.isFinite(item.qty) || item.qty <= 0
        || !Number.isFinite(item.unit_price) || item.unit_price < 0) {
        throw new Error('Each line needs a SKU, name, positive quantity, and a valid unit price.');
      }
    }
    return items;
  }

  /* Subtotal and total are derived from the lines, so they cannot disagree.
     Deliberately independent of readLinesFrom()'s submit-time validation: the
     running total has to follow the money fields while a row is still being
     filled in, not sit at zero until its SKU and name are also present. */
  function refreshOrderCreateTotals() {
    const rows = [...($('ordCreateLines')?.querySelectorAll('.adm-order-line-row') || [])];
    const subtotal = rows.reduce((sum, row) => {
      const qty = Number(row.querySelector('[data-line="qty"]')?.value);
      const price = Number(row.querySelector('[data-line="unit_price"]')?.value);
      if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price < 0) return sum;
      return sum + (qty * price);
    }, 0);
    const tax = Number($('ordCreateTax')?.value) || 0;
    const fixed = (n) => (Math.round(n * 100) / 100).toFixed(2);
    if ($('ordCreateSubtotal')) $('ordCreateSubtotal').value = fixed(subtotal);
    if ($('ordCreateTotal')) $('ordCreateTotal').value = fixed(subtotal + tax);
  }

  function parseShippingPackages(raw) {
    const rows = String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!rows.length) throw new Error('Add at least one package.');
    if (rows.length > 20) throw new Error('ShipStation supports at most 20 packages per quote.');
    return rows.map((line) => {
      const parts = line.split(',').map((part) => part.trim());
      if (![1, 4].includes(parts.length)) throw new Error('Use weight_lb or weight_lb, length_in, width_in, height_in per line.');
      const values = parts.map(Number);
      if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
        throw new Error('Package weight and dimensions must be positive numbers.');
      }
      return {
        weight: values[0],
        unit: 'pound',
        ...(values.length === 4 ? { length: values[1], width: values[2], height: values[3] } : {}),
      };
    });
  }

  function parseShippingSplitItems(raw) {
    const rows = String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!rows.length) return undefined;
    const seen = new Set();
    return rows.map((line) => {
      const [sku, rawQuantity, extra] = line.split(',').map((part) => part.trim());
      const quantity = Number(rawQuantity);
      if (!sku || extra || seen.has(sku) || !Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error('Use unique SKU, quantity lines for split allocation.');
      }
      seen.add(sku);
      return { sku, quantity };
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
        <div class="full adm-order-lines-field">
          <span class="adm-field-label" id="ordEditLinesLabel-${id}">Line items</span>
          <div class="adm-order-line-list" data-edit-lines="${id}" role="group" aria-labelledby="ordEditLinesLabel-${id}">${orderLineRows(order)}</div>
          <button class="btn btn-ghost btn-sm" data-edit-add-line="${id}" type="button"><i class="ph ph-plus" aria-hidden="true"></i> Add line</button>
        </div>
        <button class="btn btn-primary btn-sm" data-save-order-edit="${id}" type="button">Save changes</button>
        <button class="btn btn-ghost btn-sm adm-order-danger" data-delete-order="${id}" data-capability="order.delete" type="button">Remove order</button>
      </div>
    </details>`;
  }

  function trackingControls(order) {
    const id = esc(order.id);
    const eta = order.estimated_delivery_at ? new Date(order.estimated_delivery_at).toISOString().slice(0, 16) : '';
    const ship = order.ship_address || {};
    const phone = ship.phone || ship.address?.phone || '';
    const labelState = String(order.shipstation_label_status || '');
    const labelVoided = ['label_voided', 'voided'].includes(labelState);
    const activeLabel = Boolean(order.shipstation_label_id) && !labelVoided;
    const orderShipmentId = String(order.shipstation_order_shipment_id || '');
    const shipmentRevision = Number.isInteger(Number(order.shipstation_shipment_revision))
      ? Number(order.shipstation_shipment_revision)
      : 0;
    const shipmentState = String(order.shipstation_shipment_state || '');
    const persistedShipments = Array.isArray(order.order_shipments) && order.order_shipments.length
      ? order.order_shipments
      : orderShipmentId
        ? [{ id: orderShipmentId, split_key: 'default', revision: shipmentRevision, status: shipmentState }]
        : [];
    const voidedLabelIds = new Set((Array.isArray(order.order_financial_entries) ? order.order_financial_entries : [])
      .filter((entry) => entry?.source === 'shipstation' && entry?.entry_type === 'postage_void_requested')
      .map((entry) => String(entry.provider_object_id || ''))
      .filter(Boolean));
    const activeShipmentLabels = (Array.isArray(order.order_provider_links) ? order.order_provider_links : [])
      .filter((link) => link?.provider === 'shipstation'
        && link?.object_type === 'label'
        && link?.provider_object_id
        && !voidedLabelIds.has(String(link.provider_object_id)));
    const hasAnyActiveLabel = activeLabel || activeShipmentLabels.length > 0;
    const shipmentRevisions = Object.fromEntries(persistedShipments
      .filter((shipment) => shipment.status !== 'cancelled')
      .map((shipment) => [
      String(shipment.split_key || 'default'),
      Number(shipment.revision || 0),
      ]));
    const hasShipmentReconcile = persistedShipments.some((shipment) => shipment.operation_state === 'reconcile_required'
      || shipment.status === 'reconcile_required');
    const voidBlocked = ['shipped', 'in_transit', 'out_for_delivery', 'delivered'].includes(order.tracking_status);
    const labelSummary = ['purchasing', 'reconcile_required', 'voiding', 'void_reconcile_required'].includes(labelState)
      ? `<span class="badge" data-s="changes_requested">${esc(order.shipstation_label_status.replaceAll('_', ' '))}</span><small class="muted">Check ShipStation before retrying; prior purchase result may be pending or uncertain.</small>`
      : labelVoided
        ? '<span class="badge" data-s="archived">label voided</span><small class="muted">Carrier refund requested; pending finance reconciliation. Re-rate to buy a replacement.</small>'
        : activeLabel
          ? `<span class="badge" data-s="published">${order.shipstation_label_status === 'label_pending' ? 'label pending' : 'label purchased'}</span>
            <button class="btn btn-ghost btn-sm" data-shipstation-download-label="${id}" data-label-id="${esc(order.shipstation_label_id)}" type="button">Download label</button>`
          : labelState === 'label_void_failed'
            ? '<span class="badge" data-s="changes_requested">void rejected</span><small class="muted">Label remains active. Review carrier response before retrying.</small>'
        : '';
    const shippable = ['paid', 'net_open', 'net_paid', 'fulfilled'].includes(order.status);
    const reconcileControl = ['purchasing', 'reconcile_required'].includes(labelState)
      ? `<details class="adm-shipstation-reconcile" data-capability-scope="order.write">
          <summary>Reconcile uncertain label purchase</summary>
          <label class="admin-input-wide">Reason <textarea class="adm-textarea" data-shipstation-reconcile-reason="${id}" name="shipstation_reconcile_reason_${id}" rows="2" maxlength="280" placeholder="Why this purchase must be reconciled" aria-label="Reconciliation reason for order ${id}"></textarea></label>
          <label class="adm-check"><input data-shipstation-reconcile-confirm="${id}" name="shipstation_reconcile_confirm_${id}" type="checkbox"> Confirm reconciliation of the uncertain carrier charge.</label>
          <button class="btn btn-secondary btn-sm" data-shipstation-reconcile-label="${id}" type="button">Reconcile purchase</button>
          <small class="muted">Searches at most 200 recent labels for this exact shipment. It never purchases a label.</small>
        </details>`
      : '';
    const returnLabelId = String(order.shipstation_return_label_id || '');
    const returnState = String(order.shipstation_return_label_status || '');
    const returnControl = activeLabel
      ? returnLabelId
        ? `<div class="adm-shipstation-return">
            <span class="badge" data-s="published">${esc(returnState.replaceAll('_', ' ') || 'return label created')}</span>
            <button class="btn btn-ghost btn-sm" data-shipstation-download-label="${id}" data-label-id="${esc(returnLabelId)}" type="button">Download return label</button>
          </div>`
        : ['return_purchasing', 'return_reconcile_required'].includes(returnState)
          ? `<small class="muted" data-capability-scope="order.write">Return-label state is ${esc(returnState.replaceAll('_', ' '))}; inspect ShipStation before retrying.</small>`
          : `<details class="adm-shipstation-return" data-capability-scope="order.write">
              <summary>Create return label</summary>
              <label class="admin-input-wide">Reason <textarea class="adm-textarea" data-shipstation-return-reason="${id}" name="shipstation_return_reason_${id}" rows="2" maxlength="280" placeholder="Why a return label is required" aria-label="Return-label reason for order ${id}"></textarea></label>
              <label class="adm-check"><input data-shipstation-return-confirm="${id}" name="shipstation_return_confirm_${id}" type="checkbox"> Confirm return-label carrier charge.</label>
              <button class="btn btn-secondary btn-sm" data-shipstation-return-label="${id}" data-label-id="${esc(order.shipstation_label_id)}" type="button">Create return label</button>
              <small class="muted">Carrier-default billing applies. Delayed charges remain pending financial evidence until carrier acceptance.</small>
            </details>`
      : '';
    const projectedLabelLinked = activeShipmentLabels.some((link) => String(link.provider_object_id) === String(order.shipstation_label_id));
    const voidControl = activeLabel && !projectedLabelLinked && ['label_purchased', 'label_void_failed'].includes(labelState)
      ? `<details class="adm-shipstation-void" data-capability-scope="order.write">
          <summary>${voidBlocked ? 'Void unavailable after carrier movement' : 'Void label / request carrier refund'}</summary>
          ${voidBlocked ? '<small class="muted">Use carrier support/claims workflow after shipment movement.</small>' : `
            <label class="admin-input-wide">Reason <textarea class="adm-textarea" data-shipstation-void-reason="${id}" name="shipstation_void_reason_${id}" rows="2" maxlength="280" placeholder="Why this label must be voided" aria-label="Void reason for order ${id}"></textarea></label>
            <label class="adm-check"><input data-shipstation-void-confirm="${id}" name="shipstation_void_confirm_${id}" type="checkbox"> I confirm this calls ShipStation now and requests carrier refund.</label>
            <button class="btn btn-ghost btn-sm adm-order-danger" data-shipstation-void-label="${id}" data-label-id="${esc(order.shipstation_label_id)}" type="button">Void label</button>
            <small class="muted">Approval confirms void/refund request only. Carrier credit remains pending until reconciled.</small>
          `}
        </details>`
      : '';
    const shipmentControls = persistedShipments.map((shipment) => {
      const split = String(shipment.split_key || 'default');
      const generation = Number(shipment.generation || 0);
      const splitLabel = `${split}${generation ? ` #${generation + 1}` : ''}`;
      const revision = Number(shipment.revision || 0);
      const splitItemsJson = JSON.stringify(Array.isArray(shipment.item_allocations)
        ? shipment.item_allocations
        : []);
      const state = String(shipment.operation_state === 'reconcile_required' ? 'reconcile_required' : shipment.status || '');
      if (state === 'reconcile_required') return `<details class="adm-shipstation-reconcile" data-capability-scope="order.write" data-order-shipment-control>
        <summary>Reconcile ${esc(splitLabel)} shipment · revision ${revision}</summary>
        <label class="admin-input-wide">Reason <textarea class="adm-textarea" data-shipstation-shipment-reconcile-reason rows="2" maxlength="280" placeholder="Why this shipment operation must be reconciled"></textarea></label>
        <label class="adm-check"><input data-shipstation-shipment-reconcile-confirm type="checkbox"> Confirm provider read-only reconciliation.</label>
        <button class="btn btn-secondary btn-sm" data-shipstation-reconcile-shipment="${id}" data-order-shipment-id="${esc(shipment.id)}" data-revision="${revision}" data-split-key="${esc(split)}" type="button">Reconcile shipment</button>
      </details>`;
      if (state !== 'rated') return '';
      const shipmentLabel = activeShipmentLabels.find((link) => {
        const metadata = link?.metadata && typeof link.metadata === 'object' ? link.metadata : {};
        return String(metadata.order_shipment_id || '') === String(shipment.id)
          || String(metadata.shipment_id || '') === String(shipment.provider_shipment_id || '');
      });
      if (shipmentLabel) {
        const labelId = String(shipmentLabel.provider_object_id);
        return `<details class="adm-shipstation-void" data-capability-scope="order.write" data-order-shipment-control>
          <summary>${esc(splitLabel)} shipment · active label ${esc(labelId)}</summary>
          <button class="btn btn-ghost btn-sm" data-shipstation-download-label="${id}" data-label-id="${esc(labelId)}" type="button">Download label</button>
          ${voidBlocked ? '<small class="muted">Void unavailable after carrier movement.</small>' : `
            <label class="admin-input-wide">Reason <textarea class="adm-textarea" data-shipstation-void-reason="${id}" rows="2" maxlength="280" placeholder="Why this label must be voided"></textarea></label>
            <label class="adm-check"><input data-shipstation-void-confirm="${id}" type="checkbox"> Confirm ShipStation void/refund request.</label>
            <button class="btn btn-ghost btn-sm adm-order-danger" data-shipstation-void-label="${id}" data-label-id="${esc(labelId)}" type="button">Void label</button>
          `}
        </details>`;
      }
      const persistedRates = (Array.isArray(shipment.order_shipment_rates) ? shipment.order_shipment_rates : [])
        .filter((rate) => !rate.invalidated_at
          && Number(rate.shipment_revision) === revision
          && String(rate.provider_shipment_id || '') === String(shipment.provider_shipment_id || ''));
      const rateControl = persistedRates.length ? `<label>Persisted rate <select class="adm-select" data-shipstation-rate="${id}" data-order-shipment-id="${esc(shipment.id)}" data-shipment-id="${esc(shipment.provider_shipment_id || '')}" data-revision="${revision}">
          ${persistedRates.map((rate) => {
            const exponent = Number.isSafeInteger(Number(rate.currency_exponent)) ? Number(rate.currency_exponent) : 2;
            const amount = Number(rate.amount_minor) / (10 ** exponent);
            const etaText = rate.delivery_days != null ? ` · ${rate.delivery_days} day(s)` : '';
            const label = `${rate.carrier_name || rate.carrier_code} · ${rate.service_type || rate.service_code} · ${money(amount, rate.currency)}${etaText}`;
            return `<option value="${esc(rate.provider_rate_id)}" ${rate.selected ? 'selected' : ''}>${esc(label)}</option>`;
          }).join('')}
        </select></label>
        <button class="btn btn-primary btn-sm" data-shipstation-buy-label="${id}" type="button">Buy 4 × 6 PDF label</button>
        <small class="muted">Persisted current-revision rates; re-rate if carrier pricing expired.</small>`
        : '<small class="muted">No persisted current-revision rates. Update shipment packages + rates.</small>';
      return `<details class="adm-shipstation-shipment" data-capability-scope="order.write" data-order-shipment-control>
        <summary>Rate or fulfill ${esc(splitLabel)} shipment · revision ${revision}</summary>
        ${rateControl}
        ${hasAnyActiveLabel ? '<small class="muted">Shipment edits/cancellation locked until every active label is voided.</small>' : `
          <label class="admin-input-wide">Change reason <textarea class="adm-textarea" data-shipstation-shipment-reason rows="2" maxlength="280" placeholder="Why package/shipment data changed"></textarea></label>
          <button class="btn btn-secondary btn-sm" data-shipstation-update-shipment="${id}" data-order-shipment-id="${esc(shipment.id)}" data-revision="${revision}" data-split-key="${esc(split)}" data-split-items="${esc(splitItemsJson)}" type="button">Update shipment packages + rates</button>
          <label class="adm-check"><input data-shipstation-cancel-confirm type="checkbox"> Confirm shipment cancellation; all linked labels must already be voided.</label>
          <button class="btn btn-ghost btn-sm adm-order-danger" data-shipstation-cancel-shipment="${id}" data-order-shipment-id="${esc(shipment.id)}" data-revision="${revision}" data-split-key="${esc(split)}" type="button">Cancel shipment</button>
        `}
      </details>`;
    }).join('');
    const quoteControl = shippable && !activeLabel && !['purchasing', 'reconcile_required', 'voiding', 'void_reconcile_required'].includes(labelState) && !hasShipmentReconcile ? `<div data-capability-scope="order.write">
      <label>Phone <input class="adm-input" data-shipstation-phone="${id}" type="tel" value="${esc(phone)}" placeholder="+1 321-555-0100" autocomplete="tel"></label>
      <label>Address type <select class="adm-select" data-shipstation-residential="${id}"><option value="unknown">Unknown</option><option value="yes">Residential</option><option value="no">Commercial</option></select></label>
      <label>Split key <input class="adm-input" data-shipstation-split="${id}" data-shipment-revisions="${esc(JSON.stringify(shipmentRevisions))}" value="default" pattern="[a-z0-9][a-z0-9_-]{0,39}" maxlength="40" aria-label="Shipment split key"></label>
      <label class="admin-input-wide">Split item allocation <textarea class="adm-textarea" data-shipstation-split-items="${id}" rows="2" placeholder="Blank for default/full order&#10;VK-HCR-5G, 1"></textarea><small class="muted">Non-default split requires one unique SKU, quantity line. Across active splits, quantities cannot exceed order items.</small></label>
      <label class="admin-input-wide">Package override <textarea class="adm-textarea adm-shipstation-packages" data-shipstation-packages="${id}" rows="2" placeholder="Leave blank for CMS package profiles&#10;42.5, 14, 14, 18" aria-describedby="shipstation-format-${id}"></textarea><small id="shipstation-format-${id}" class="muted">Blank uses each variant's CMS shipping profile. Override: one/package line with weight_lb, length_in, width_in, height_in.</small></label>
      <button class="btn btn-secondary btn-sm" data-shipstation-rates="${id}" type="button">Create new split shipment + rates</button>
      <div class="adm-shipstation-results" data-shipstation-results="${id}" role="status" aria-live="polite"></div>
    </div>` : '';
    const shipStation = `<details class="adm-track adm-shipstation">
      <summary><b>ShipStation API Free</b>${order.shipstation_label_status ? ` ${statusBadge(order.shipstation_label_status)}` : ''}</summary>
      <div class="adm-track-controls">
        ${labelSummary}
        ${shipmentControls}
        ${reconcileControl}
        ${voidControl}
        ${returnControl}
        ${quoteControl || (!activeLabel && !shippable ? '<small class="muted">Order must be paid, approved NET, or fulfilled before label purchase.</small>' : '')}
      </div>
    </details>`;
    return `${qboReconciliation(order)}<details class="adm-track" data-capability-scope="order.write"><summary>${statusBadge(order.tracking_status || 'processing')}</summary>
      <div class="adm-track-controls">
        <select class="adm-select" data-track-status="${id}" aria-label="Tracking status for order ${id}">
          ${['processing', 'packing', 'shipped', 'delivered', 'blocked'].map((status) => `<option value="${status}" ${status === (order.tracking_status || 'processing') ? 'selected' : ''}>${status.replaceAll('_', ' ')}</option>`).join('')}
        </select>
        <input class="adm-input" data-track-carrier="${id}" value="${esc(order.carrier || '')}" placeholder="Carrier" aria-label="Carrier for order ${id}">
        <input class="adm-input" data-track-number="${id}" value="${esc(order.tracking_number || '')}" placeholder="Tracking #" aria-label="Tracking number for order ${id}">
        <input class="adm-input admin-input-wide" data-track-url="${id}" value="${esc(order.tracking_url || '')}" placeholder="Tracking URL" aria-label="Tracking URL for order ${id}">
        <input class="adm-input" data-track-eta="${id}" value="${esc(eta)}" type="datetime-local" aria-label="Estimated delivery">
        <input class="adm-input admin-input-wide" data-track-note="${id}" placeholder="Note (shown to customer)" aria-label="Shipment note">
        <button class="btn btn-ghost btn-sm" data-save-tracking="${id}" type="button">Save tracking</button>
      </div>
    </details>${shipStation}`;
  }

  function renderShipStationRates(root, orderId, response) {
    const rates = response?.rates || [];
    if (!rates.length) {
      root.innerHTML = '<small class="muted">No valid rates returned. Check package/address data and connected carriers.</small>';
      return;
    }
    root.innerHTML = `<div data-order-shipment-control><label>Live rate <select class="adm-select" data-shipstation-rate="${esc(orderId)}" data-order-shipment-id="${esc(response.order_shipment_id || '')}" data-shipment-id="${esc(response.shipment_id || '')}" data-revision="${esc(response.revision ?? '')}">
      ${rates.map((rate) => {
        const eta = rate.delivery_days != null ? ` · ${rate.delivery_days} day(s)` : '';
        const label = `${rate.carrier_name || rate.carrier_code} · ${rate.service_type || rate.service_code} · ${money(rate.amount, rate.currency)}${eta}`;
        return `<option value="${esc(rate.rate_id)}">${esc(label)}</option>`;
      }).join('')}
    </select></label>
    <button class="btn btn-primary btn-sm" data-shipstation-buy-label="${esc(orderId)}" type="button">Buy 4 × 6 PDF label</button>
    <small class="muted">Live purchase; charged through connected ShipStation carrier account.</small></div>`;
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
    // Accept is the only order action safe to batch — it stamps ownership and
    // touches no money, stock, or fulfillment state. Status moves stay per-row
    // because each is guarded by its own transition plan.
    const bulkBar = `<div class="adm-tools adm-tools-flush" data-capability-scope="order.write">
      <label class="admin-select-all"><input type="checkbox" id="ordAll" aria-label="Select all orders"> Select all</label>
      <button class="btn btn-ghost btn-sm" id="ordBulkAccept" type="button">Accept selected</button>
    </div>`;
    box.innerHTML = bulkBar + `<div class="admin-order-list">${orders.map((order) => {
      const id = esc(order.id);
      const reference = esc(order.order_number || order.id);
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
      // Acceptance is the "a human owns this" marker the queue sorts on; cancellation
      // reverses label + payment + stock + books in one confirmed pass.
      const openStatus = ['paid', 'net_open', 'pending_payment'].includes(order.status);
      // The one action that moves this row through the queue stays on the surface;
      // everything else lives behind "Manage order" so the queue stays scannable.
      const primaryAction = openStatus && !order.accepted_at
        ? `<button class="btn btn-primary btn-sm" data-accept-order="${id}" data-capability="order.write" type="button">Accept order</button>`
        : '';
      const lifecycleControls = `
        ${order.accepted_at ? `<span class="muted admin-inline-note">accepted ${esc(date(order.accepted_at))}</span>` : ''}
        <a class="btn btn-ghost btn-sm" href="/api/admin/orders?id=${encodeURIComponent(id)}&amp;format=packing_slip" target="_blank" rel="noopener">Packing slip</a>
        ${['cancelled', 'refunded', 'cart'].includes(order.status) ? '' : `<button class="btn btn-ghost btn-sm adm-order-danger" data-cancel-order="${id}" data-capability="order.refund" type="button">Cancel &amp; reverse</button>`}`;
      return `<article class="admin-order-card">
        <div class="admin-order-head">
          <div>
            <span class="admin-kicker"><label class="admin-select-all"><input type="checkbox" class="ord-check" value="${id}" data-capability="order.write" aria-label="Select order ${reference}"></label> ${reference} · ${esc(date(order.created_at))}</span>
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
        <div class="admin-order-primary">
          <button class="btn btn-ghost btn-sm" data-order-detail="${id}" type="button">Details</button>
          ${primaryAction}
        </div>
        <details class="adm-order-manage">
          <summary><i class="ph ph-sliders-horizontal" aria-hidden="true"></i> Manage order</summary>
          <div class="admin-order-actions">
            ${orderEditor(order)}
            ${trackingControls(order)}
            <button class="btn btn-ghost btn-sm" data-save-order="${id}" data-capability="order.write" type="button">Save</button>
            ${netControls}
            ${refundControls}
            ${lifecycleControls}
          </div>
        </details>
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
      items: readLinesFrom($('ordCreateLines')),
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
      items: readLinesFrom(pick('lines')),
    };
  }

  // Row actions are delegated once on the stable #admOrders container (#36): a single
  // listener per action survives every innerHTML re-render instead of re-binding per row.
  function auditDetail(event) {
    const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {};
    const values = [];
    if (detail.split_key) values.push(`split ${esc(detail.split_key)}`);
    if (detail.revision != null) values.push(`revision ${esc(detail.revision)}`);
    if (detail.package_hash) values.push(`hash <code>${esc(detail.package_hash)}</code>`);
    if (detail.reason) values.push(`reason: ${esc(detail.reason)}`);
    return values.length ? ` · <small class="muted">${values.join(' · ')}</small>` : '';
  }

  function orderDetailHtml(order, timeline, integrationTimeline = []) {
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
      `<li><b>${esc(e.action)}</b> — ${esc(date(e.created_at))}${e.actor_email ? ` by ${esc(e.actor_email)}` : ''}${auditDetail(e)}</li>`).join('')
      || '<li class="muted">No staff actions recorded</li>';
    const shipEvents = (order.shipment_events || [])
      .slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const shipHistory = shipEvents.length
      ? `<h4 style="margin:16px 0 4px">Shipment history</h4><ul style="margin:0;padding-left:18px">${shipEvents.map((e) =>
          `<li><b>${esc(e.status)}</b> — ${esc(date(e.created_at))}${e.carrier ? ` · ${esc(e.carrier)}` : ''}${e.tracking_number ? ` ${esc(e.tracking_number)}` : ''}${e.note ? ` — ${esc(e.note)}` : ''}</li>`).join('')}</ul>`
      : '';
    const lifecycle = lifecycleFor(order);
    const providerLinks = (order.order_provider_links || [])
      .slice().sort((a, b) => `${a.provider}:${a.object_type}`.localeCompare(`${b.provider}:${b.object_type}`));
    const providerObject = (link) => {
      const id = esc(link.provider_object_id);
      if (link.provider !== 'shipstation' || !['label', 'return_label'].includes(link.object_type)) return `<code>${id}</code>`;
      return `<button class="btn btn-ghost btn-sm" data-shipstation-download-label="${esc(order.id)}" data-label-id="${esc(link.provider_object_id)}" type="button"><code>${id}</code></button>`;
    };
    const providerLedger = providerLinks.length
      ? `<h4 style="margin:16px 0 4px">Provider ledger</h4><ul style="margin:0;padding-left:18px">${providerLinks.map((link) =>
          `<li><b>${esc(link.provider)}</b> ${esc(link.object_type)} — ${providerObject(link)}</li>`).join('')}</ul>`
      : '<h4 style="margin:16px 0 4px">Provider ledger</h4><p class="muted" style="margin:0">No external provider objects linked.</p>';
    const normalizedShipments = (order.order_shipments || [])
      .slice().sort((a, b) => String(a.split_key).localeCompare(String(b.split_key)));
    const shipmentLedger = normalizedShipments.length
      ? `<h4 style="margin:16px 0 4px">Persisted shipments & packages</h4><ul style="margin:0;padding-left:18px">${normalizedShipments.map((shipment) => {
          const packageSummary = (shipment.order_shipment_packages || [])
            .slice().sort((a, b) => Number(a.sequence) - Number(b.sequence))
            .map((pkg) => {
              const dimensions = pkg.length_in == null ? '' : ` · ${pkg.length_in} × ${pkg.width_in} × ${pkg.height_in} in`;
              return `#${pkg.sequence} ${pkg.weight_value} ${pkg.weight_unit}${dimensions}`;
            }).join('; ') || 'no persisted packages';
          const selectedRate = (shipment.order_shipment_rates || []).find((rate) => rate.selected && !rate.invalidated_at);
          const selectedSummary = selectedRate
            ? ` · selected ${esc(selectedRate.carrier_name || selectedRate.carrier_code || '')} ${esc(selectedRate.service_type || selectedRate.service_code || '')} ${esc(money(Number(selectedRate.amount_minor) / (10 ** Number(selectedRate.currency_exponent || 0)), selectedRate.currency))}`
            : '';
          const allocationSummary = (shipment.item_allocations || [])
            .map((item) => `${item.sku} × ${item.quantity}`).join(', ') || 'no item allocation';
          return `<li><b>${esc(shipment.split_key)}</b> · revision ${esc(shipment.revision)} · provider ${esc(shipment.status)} · <code>${esc(shipment.provider_shipment_id || shipment.external_shipment_id)}</code>${selectedSummary}<br><small class="muted">${esc(allocationSummary)} · ${esc(packageSummary)} · hash ${esc(shipment.package_hash || 'pending')}</small></li>`;
        }).join('')}</ul>`
      : '<h4 style="margin:16px 0 4px">Persisted shipments & packages</h4><p class="muted" style="margin:0">No normalized shipment revision yet.</p>';
    const integrationHistory = integrationTimeline.length
      ? `<h4 style="margin:16px 0 4px">Integration delivery</h4><ul style="margin:0;padding-left:18px">${integrationTimeline.map((entry) =>
          `<li><b>${esc(entry.provider)}</b> ${esc(entry.effect_type)} — ${esc(entry.status)} · ${esc(date(entry.completed_at || entry.dead_at || entry.created_at))}${entry.result?.skipped ? ` · ${esc(entry.result.skipped)}` : ''}${entry.last_error_code ? ` · <code>${esc(entry.last_error_code)}</code>` : ''}</li>`).join('')}</ul>`
      : '<h4 style="margin:16px 0 4px">Integration delivery</h4><p class="muted" style="margin:0">No order-scoped provider effects.</p>';
    const financialEntries = (order.order_financial_entries || [])
      .slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const realizedPostage = financialEntries
      .filter((entry) => entry.recognition_state === 'recognized')
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const pendingPostage = financialEntries
      .filter((entry) => entry.recognition_state === 'pending')
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const pendingPostageLabel = pendingPostage < 0 ? 'pending carrier credit' : 'pending carrier charge';
    const financialLedger = financialEntries.length
      ? `<h4 style="margin:16px 0 4px">Financial evidence</h4>
        <p class="muted" style="margin:0 0 4px">Realized postage ${esc(money(realizedPostage, order.currency))}${pendingPostage ? ` · ${pendingPostageLabel} ${esc(money(pendingPostage, order.currency))}` : ''}</p>
        <ul style="margin:0;padding-left:18px">${financialEntries.map((entry) =>
          `<li><b>${esc(entry.source)}</b> ${esc(entry.entry_type.replaceAll('_', ' '))} — ${esc(money(entry.amount, entry.currency))} · ${esc(entry.recognition_state)} · <code>${esc(entry.provider_object_id)}</code>${entry.reason ? ` — ${esc(entry.reason)}` : ''}</li>`).join('')}</ul>`
      : '<h4 style="margin:16px 0 4px">Financial evidence</h4><p class="muted" style="margin:0">No provider cost entries.</p>';
    return `<h3 style="margin:0 0 4px">Order ${esc(order.order_number || order.id)}</h3>
      <p class="muted" style="margin:0 0 12px">${esc(order.companies?.name || order.company_id || 'Guest')} · ${esc(order.customer_email || '')} · ${esc(lifecycle.label)} · ${esc(order.status)} · ${esc(order.payment_method || '')}</p>
      ${order.purchase_order_number ? `<p style="margin:0 0 12px"><b>Purchase order:</b> ${esc(order.purchase_order_number)}</p>` : ''}
      <table class="adm" style="width:100%"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Line</th></tr></thead><tbody>${items}</tbody></table>
      <p style="margin:12px 0 0"><b>Total</b> ${esc(money(order.total ?? order.subtotal, order.currency))}${Number(order.tax) ? ` (tax ${esc(money(order.tax, order.currency))})` : ''}${Number(order.refunded_amount) > 0 ? ` · refunded ${esc(money(order.refunded_amount, order.currency))}` : ''}</p>
      <h4 style="margin:16px 0 4px">Ship to</h4><p style="margin:0">${shipLines}</p>
      ${shipHistory}
      ${shipmentLedger}
      ${providerLedger}
      ${financialLedger}
      ${integrationHistory}
      <h4 style="margin:16px 0 4px">Staff timeline</h4><ul style="margin:0;padding-left:18px">${events}</ul>`;
  }

  function wireLabelDownloads(root) {
    delegate(root, 'click', '[data-shipstation-download-label]', async (event, button) => {
      const id = button.dataset.shipstationDownloadLabel;
      const labelId = button.dataset.labelId;
      const url = `/api/admin/shipstation?action=label_document&order_id=${encodeURIComponent(id)}&label_id=${encodeURIComponent(labelId)}&format=pdf`;
      button.disabled = true;
      message('ordStatus', 'Preparing authenticated label download…');
      try {
        const blob = await apiBlob(url);
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `${id}-label-${labelId}.pdf`.replace(/[^A-Za-z0-9_.-]+/g, '-');
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        message('ordStatus', 'Label downloaded.', 'ok');
      } catch (error) {
        message('ordStatus', error.data?.error || 'Could not download label. Refresh and retry.', 'err');
      } finally {
        button.disabled = false;
      }
    });
  }

  function wireOrders() {
    const box = $('admOrders');
    if (!box) return;
    const createForm = $('ordCreateForm');
    if (createForm && !createForm.dataset.wired) {
      createForm.dataset.wired = '1';
      const lines = $('ordCreateLines');
      const addLine = () => { lines?.insertAdjacentHTML('beforeend', orderLineRow()); refreshOrderCreateTotals(); };
      if (lines && !lines.children.length) addLine();
      $('ordCreateAddLine')?.addEventListener('click', addLine);
      createForm.addEventListener('input', refreshOrderCreateTotals);
      delegate(createForm, 'click', '[data-line-remove]', (event, button) => {
        // Always leave one row so the form never becomes a dead end.
        if (lines.querySelectorAll('.adm-order-line-row').length > 1) button.closest('.adm-order-line-row').remove();
        else button.closest('.adm-order-line-row').querySelectorAll('input').forEach((input) => {
          if (input.type === 'checkbox') input.checked = false;
          else input.value = input.dataset.line === 'qty' ? '1' : '';
        });
        refreshOrderCreateTotals();
      });

      // Business picker: staff type a name instead of pasting a UUID.
      const companySearch = $('ordCreateCompanySearch');
      const companySelect = $('ordCreateCompany');
      if (companySearch && companySelect) {
        let lookupSeq = 0;
        let lookupTimer;
        const runLookup = (fn) => { clearTimeout(lookupTimer); lookupTimer = setTimeout(fn, 220); };
        companySearch.addEventListener('input', () => runLookup(async () => {
          const term = companySearch.value.trim();
          const token = ++lookupSeq;
          if (term.length < 2) {
            companySelect.innerHTML = '<option value="">No business (guest order)</option>';
            return;
          }
          try {
            const res = await api(`/api/admin/companies?search=${encodeURIComponent(term)}&limit=20`);
            if (token !== lookupSeq) return; // a newer keystroke already won
            const options = (res.companies || [])
              .map((company) => `<option value="${esc(company.id)}">${esc(company.name)}${company.status === 'approved' ? '' : ` (${esc(company.status)})`}</option>`)
              .join('');
            companySelect.innerHTML = `<option value="">No business (guest order)</option>${options}`;
            if (!options) message('ordCreateStatusText', `No business matches “${term}”.`, '');
          } catch { /* leave the current options in place */ }
        }));
      }
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
        message('ordCreateStatusText', 'Creating order…');
        try {
          await api('/api/admin/orders', { method: 'POST', body });
          message('ordCreateStatusText', 'Order created.', 'ok');
          createForm.reset();
          if ($('ordCreateStatus')) $('ordCreateStatus').value = 'net_open';
          if ($('ordCreatePayment')) $('ordCreatePayment').value = 'net';
          if ($('ordCreateTax')) $('ordCreateTax').value = '0';
          if ($('ordCreateCurrency')) $('ordCreateCurrency').value = 'usd';
          // form.reset() clears field values but not the rows we appended.
          if (lines) lines.innerHTML = orderLineRow();
          if (companySelect) companySelect.innerHTML = '<option value="">No business (guest order)</option>';
          refreshOrderCreateTotals();
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
        const dialog = detailDialog(orderDetailHtml(res.order, res.timeline, res.integration_timeline));
        if (dialog) wireLabelDownloads(dialog);
      } catch (err) {
        message('ordStatus', err.data?.error || 'Could not load order detail. Retry.', 'err');
      } finally {
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-save-order]', async (event, button) => {
      const id = button.dataset.saveOrder;
      const status = box.querySelector(`[data-order-status="${CSS.escape(id)}"]`).value;
      // A bare status write to 'cancelled' moves no money, voids no label, and returns no
      // stock — it just relabels the row. Route it through the real reversal instead.
      if (status === 'cancelled') { await cancelOrderFlow(id); return; }
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
      if (body.status === 'cancelled') { await cancelOrderFlow(id); return; }
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
    // Turn the server's preflight into the sentences an operator has to agree to. The plan
    // is authoritative: the dialog never guesses at what will happen, it reads it back.
    function cancellationConsequences(plan) {
      const lines = [];
      lines.push(plan.label.will_void
        ? `Void shipping label ${plan.label.label_id}${plan.label.postage_at_risk ? ` (recover ${money(plan.label.postage_at_risk, plan.refund.currency)} postage)` : ''}.`
        : `No label will be voided (${(plan.label.reason || 'none').replace(/_/g, ' ')}).`);
      lines.push(plan.refund.will_refund
        ? `Refund ${money(plan.refund.amount, plan.refund.currency)} to the original payment method.`
        : `No Stripe refund (${(plan.refund.reason || 'none').replace(/_/g, ' ')}).`);
      lines.push(plan.restock.will_restock
        ? `Return ${plan.restock.lines.reduce((sum, line) => sum + line.qty, 0)} unit(s) to stock: ${plan.restock.lines.map((line) => `${line.sku} ×${line.qty}`).join(', ')}.`
        : 'No stock is returned.');
      if (plan.accounting.will_credit_memo) lines.push('Queue a reversing QuickBooks credit memo.');
      if (plan.notification.buyer) lines.push(`Email ${plan.notification.buyer} that the order was cancelled.`);
      if (plan.blockers.includes('shipment_in_transit')) {
        lines.push('WARNING: the parcel is already moving. It will not be recalled and the postage is spent.');
      }
      return lines;
    }

    async function cancelOrderFlow(id) {
      let plan;
      try {
        const preflight = await api('/api/admin/orders', { method: 'POST', body: { id, action: 'cancel_order' } });
        plan = preflight.plan;
      } catch (err) {
        message('ordStatus', err.data?.message || err.data?.error || 'Could not prepare the cancellation.', 'err');
        return;
      }
      if (plan.blockers.includes('already_cancelled')) {
        message('ordStatus', 'Order is already cancelled.', 'ok');
        return;
      }
      if (plan.blockers.includes('already_refunded')) {
        message('ordStatus', 'Order is already fully refunded; cancel is not available.', 'err');
        return;
      }
      const reason = await promptDialog(
        `Cancel order ${plan.order_number || id}? This runs every step below.`,
        {
          label: 'Reason (recorded on the order and shown to the buyer)',
          confirmText: 'Cancel & reverse',
          cancelText: 'Keep order',
          danger: true,
          minLength: 8,
          consequences: cancellationConsequences(plan),
        },
      );
      if (!reason) return;
      try {
        await api('/api/admin/orders', {
          method: 'POST',
          body: {
            id,
            action: 'cancel_order',
            confirm: true,
            reason,
            acknowledge_in_transit: plan.blockers.includes('shipment_in_transit'),
          },
        });
        message('ordStatus', 'Cancellation queued. Track each step on the order timeline.', 'ok');
        await refreshOrder(id);
        await refreshStats?.();
      } catch (err) {
        message('ordStatus', err.data?.message || err.data?.error || 'Could not cancel the order. Retry.', 'err');
      }
    }

    // Line-item rows in the per-order editor. Same markup and reader as the
    // create form, so both surfaces enforce one contract.
    delegate(box, 'click', '[data-edit-add-line]', (event, button) => {
      box.querySelector(`[data-edit-lines="${CSS.escape(button.dataset.editAddLine)}"]`)
        ?.insertAdjacentHTML('beforeend', orderLineRow());
    });
    delegate(box, 'click', '[data-line-remove]', (event, button) => {
      const list = button.closest('.adm-order-line-list');
      if (!list) return; // the create form has its own handler
      if (list.querySelectorAll('.adm-order-line-row').length > 1) button.closest('.adm-order-line-row').remove();
      else button.closest('.adm-order-line-row').querySelectorAll('input').forEach((input) => {
        if (input.type === 'checkbox') input.checked = false;
        else input.value = input.dataset.line === 'qty' ? '1' : '';
      });
    });
    delegate(box, 'change', '#ordAll', (event, all) => {
      box.querySelectorAll('.ord-check').forEach((check) => { check.checked = all.checked; });
    });
    delegate(box, 'click', '#ordBulkAccept', async (event, button) => {
      const ids = [...box.querySelectorAll('.ord-check:checked')].map((check) => check.value);
      if (!ids.length) { message('ordStatus', 'Select at least one order.', 'err'); return; }
      button.disabled = true;
      try {
        const result = await api('/api/admin/orders', { method: 'POST', body: { action: 'accept_orders', ids } });
        // Already-accepted or closed rows are skipped rather than failed, so the
        // count tells the operator what actually moved.
        message('ordStatus', result.skipped
          ? `Accepted ${result.accepted} order(s); ${result.skipped} skipped (already accepted or closed).`
          : `Accepted ${result.accepted} order(s).`, 'ok');
        await renderOrders({ refetch: true });
        await refreshStats?.();
      } catch (err) {
        message('ordStatus', err.data?.message || err.data?.error || 'Bulk accept failed. Retry.', 'err');
      } finally {
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-accept-order]', async (event, button) => {
      const id = button.dataset.acceptOrder;
      button.disabled = true;
      try {
        const result = await api('/api/admin/orders', { method: 'POST', body: { id, action: 'accept_order' } });
        message('ordStatus', result.already_accepted ? 'Order was already accepted.' : 'Order accepted.', 'ok');
        await refreshOrder(id);
      } catch (err) {
        message('ordStatus', err.data?.message || err.data?.error || 'Could not accept the order. Retry.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-cancel-order]', async (event, button) => {
      const id = button.dataset.cancelOrder;
      button.disabled = true;
      try {
        await cancelOrderFlow(id);
      } finally {
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
    delegate(box, 'click', '[data-shipstation-rates]', async (event, button) => {
      const id = button.dataset.shipstationRates;
      const pick = (name) => box.querySelector(`[data-shipstation-${name}="${CSS.escape(id)}"]`);
      const results = pick('results');
      let packages;
      let splitItems;
      try {
        const rawPackages = pick('packages')?.value.trim();
        packages = rawPackages ? parseShippingPackages(rawPackages) : undefined;
        splitItems = parseShippingSplitItems(pick('split-items')?.value);
        if (!pick('phone')?.value.trim()) throw new Error('Shipping phone is required by ShipStation.');
      } catch (err) {
        message('ordStatus', err.message || 'Check package details.', 'err');
        return;
      }
      button.disabled = true;
      results.textContent = 'Loading live rates…';
      try {
        const splitKey = pick('split')?.value.trim() || 'default';
        const knownRevisions = JSON.parse(pick('split')?.dataset.shipmentRevisions || '{}');
        const res = await api('/api/admin/shipstation', {
          method: 'POST',
          body: {
            action: 'rates',
            order_id: id,
            phone: pick('phone').value.trim(),
            residential: pick('residential').value,
            split_key: splitKey,
            expected_revision: Number(knownRevisions[splitKey] || 0),
            ...(packages ? { packages } : {}),
            ...(splitItems ? { split_items: splitItems } : {}),
          },
        });
        knownRevisions[res.split_key || splitKey] = Number(res.revision || 0);
        pick('split').dataset.shipmentRevisions = JSON.stringify(knownRevisions);
        renderShipStationRates(results, id, res);
        message('ordStatus', `${(res.rates || []).length} live rate(s) loaded using ${res.packages_source || 'provided'} package data.`, 'ok');
      } catch (err) {
        results.textContent = '';
        message('ordStatus', err.data?.error || 'Could not load ShipStation rates. Check integration configuration.', 'err');
      } finally {
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-shipstation-update-shipment]', async (event, button) => {
      const id = button.dataset.shipstationUpdateShipment;
      const pick = (name) => box.querySelector(`[data-shipstation-${name}="${CSS.escape(id)}"]`);
      const results = pick('results');
      const control = button.closest('[data-order-shipment-control]');
      const reason = control?.querySelector('[data-shipstation-shipment-reason]')?.value.trim() || '';
      if (reason.length < 8) {
        message('ordStatus', 'Enter a specific shipment change reason (at least 8 characters).', 'err');
        return;
      }
      let packages;
      let splitItems;
      try {
        const rawPackages = pick('packages')?.value.trim();
        packages = rawPackages ? parseShippingPackages(rawPackages) : undefined;
        splitItems = parseShippingSplitItems(pick('split-items')?.value);
        if (!splitItems && button.dataset.splitItems) {
          const persistedItems = JSON.parse(button.dataset.splitItems);
          splitItems = Array.isArray(persistedItems) && persistedItems.length ? persistedItems : undefined;
        }
      } catch (err) {
        message('ordStatus', err.message || 'Check package and split details.', 'err');
        return;
      }
      button.disabled = true;
      message('ordStatus', 'Updating persisted ShipStation shipment…');
      try {
        const res = await api('/api/admin/shipstation', {
          method: 'POST',
          body: {
            action: 'update_shipment',
            order_id: id,
            order_shipment_id: button.dataset.orderShipmentId,
            expected_revision: Number(button.dataset.revision),
            reason,
            phone: pick('phone')?.value.trim() || '',
            residential: pick('residential')?.value || 'unknown',
            split_key: button.dataset.splitKey || 'default',
            ...(packages ? { packages } : {}),
            ...(splitItems ? { split_items: splitItems } : {}),
          },
        });
        renderShipStationRates(results, id, res);
        message('ordStatus', `Shipment packages updated; ${(res.rates || []).length} replacement rate(s) persisted.`, 'ok');
      } catch (err) {
        message('ordStatus', err.data?.error || err.message || 'Shipment update uncertain. Reconcile before retrying.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-shipstation-cancel-shipment]', async (event, button) => {
      const id = button.dataset.shipstationCancelShipment;
      const control = button.closest('[data-order-shipment-control]');
      const reason = control?.querySelector('[data-shipstation-shipment-reason]')?.value.trim() || '';
      const confirmed = control?.querySelector('[data-shipstation-cancel-confirm]')?.checked === true;
      if (reason.length < 8) {
        message('ordStatus', 'Enter a specific shipment cancellation reason (at least 8 characters).', 'err');
        return;
      }
      if (!confirmed) {
        message('ordStatus', 'Confirm shipment cancellation first.', 'err');
        return;
      }
      if (!(await confirmDialog('Cancel this provider shipment? Every linked label must already be voided.', {
        confirmText: 'Cancel shipment',
        cancelText: 'Keep shipment',
        danger: true,
      }))) return;
      button.disabled = true;
      try {
        await api('/api/admin/shipstation', {
          method: 'POST',
          body: {
            action: 'cancel_shipment',
            order_id: id,
            order_shipment_id: button.dataset.orderShipmentId,
            expected_revision: Number(button.dataset.revision),
            split_key: button.dataset.splitKey || 'default',
            confirm: true,
            reason,
          },
        });
        message('ordStatus', 'Provider shipment cancelled; provider history retained.', 'ok');
        await refreshOrder(id);
      } catch (err) {
        message('ordStatus', err.data?.error || 'Shipment cancellation uncertain. Reconcile before retrying.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-shipstation-reconcile-shipment]', async (event, button) => {
      const id = button.dataset.shipstationReconcileShipment;
      const control = button.closest('[data-order-shipment-control]');
      const reason = control?.querySelector('[data-shipstation-shipment-reconcile-reason]')?.value.trim() || '';
      const confirmed = control?.querySelector('[data-shipstation-shipment-reconcile-confirm]')?.checked === true;
      if (reason.length < 8 || !confirmed) {
        message('ordStatus', 'Enter a specific reconciliation reason and confirm read-only provider lookup.', 'err');
        return;
      }
      button.disabled = true;
      try {
        await api('/api/admin/shipstation', {
          method: 'POST',
          body: {
            action: 'reconcile_shipment',
            order_id: id,
            order_shipment_id: button.dataset.orderShipmentId,
            confirm: true,
            reason,
          },
        });
        message('ordStatus', 'Shipment operation reconciled without purchase.', 'ok');
        await refreshOrder(id);
      } catch (err) {
        message('ordStatus', err.data?.error || 'Shipment reconciliation unresolved.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-shipstation-buy-label]', async (event, button) => {
      const id = button.dataset.shipstationBuyLabel;
      const control = button.closest('[data-order-shipment-control]');
      const rate = control?.querySelector(`[data-shipstation-rate="${CSS.escape(id)}"]`)
        || box.querySelector(`[data-shipstation-rate="${CSS.escape(id)}"]`);
      if (!rate?.value) { message('ordStatus', 'Load and select a live rate first.', 'err'); return; }
      const selected = rate.options[rate.selectedIndex]?.textContent || 'selected rate';
      if (!(await confirmDialog(`Buy ${selected}? ShipStation will charge the connected carrier account.`, {
        confirmText: 'Buy label',
        cancelText: 'Cancel',
      }))) return;
      button.disabled = true;
      message('ordStatus', 'Buying ShipStation label…');
      try {
        if (!rate.dataset.orderShipmentId || rate.dataset.revision === '') {
          throw new Error('Persisted shipment revision missing. Re-rate before purchase.');
        }
        await api('/api/admin/shipstation', {
          method: 'POST',
          body: {
            action: 'select_shipment_rate',
            order_id: id,
            order_shipment_id: rate.dataset.orderShipmentId,
            expected_revision: Number(rate.dataset.revision),
            shipment_id: rate.dataset.shipmentId,
            rate_id: rate.value,
          },
        });
        const res = await api('/api/admin/shipstation', {
          method: 'POST',
          body: {
            action: 'buy_label',
            order_id: id,
            order_shipment_id: rate.dataset.orderShipmentId,
            expected_revision: Number(rate.dataset.revision),
            shipment_id: rate.dataset.shipmentId,
            rate_id: rate.value,
          },
        });
        message('ordStatus', res.already_purchased ? 'Existing label loaded; no second purchase.' : 'Label purchased. Order moved to packing.', 'ok');
        await refreshOrder(id);
      } catch (err) {
        message('ordStatus', err.data?.error || err.message || 'Label purchase failed. Check ShipStation before retrying.', 'err');
        button.disabled = false;
      }
    });
    wireLabelDownloads(box);
    delegate(box, 'click', '[data-shipstation-reconcile-label]', async (event, button) => {
      const id = button.dataset.shipstationReconcileLabel;
      const reason = box.querySelector(`[data-shipstation-reconcile-reason="${CSS.escape(id)}"]`)?.value.trim() || '';
      const confirmed = box.querySelector(`[data-shipstation-reconcile-confirm="${CSS.escape(id)}"]`)?.checked === true;
      if (reason.length < 8) {
        message('ordStatus', 'Enter a specific reconciliation reason (at least 8 characters).', 'err');
        return;
      }
      if (!confirmed) {
        message('ordStatus', 'Confirm reconciliation of the uncertain purchase first.', 'err');
        return;
      }
      if (!(await confirmDialog('Search recent ShipStation labels for this exact shipment? This does not buy a new label.', {
        confirmText: 'Reconcile purchase',
        cancelText: 'Cancel',
      }))) return;
      button.disabled = true;
      message('ordStatus', 'Reconciling uncertain ShipStation purchase…');
      try {
        await api('/api/admin/shipstation', {
          method: 'POST',
          body: { action: 'reconcile_label_purchase', order_id: id, confirm: true, reason },
        });
        message('ordStatus', 'Existing label reconciled; no new purchase.', 'ok');
        await refreshOrder(id);
      } catch (err) {
        message('ordStatus', err.data?.error || 'Reconciliation unresolved. Inspect ShipStation before retrying.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-shipstation-return-label]', async (event, button) => {
      const id = button.dataset.shipstationReturnLabel;
      const labelId = button.dataset.labelId;
      const reason = box.querySelector(`[data-shipstation-return-reason="${CSS.escape(id)}"]`)?.value.trim() || '';
      const confirmed = box.querySelector(`[data-shipstation-return-confirm="${CSS.escape(id)}"]`)?.checked === true;
      if (reason.length < 8) {
        message('ordStatus', 'Enter a specific return-label reason (at least 8 characters).', 'err');
        return;
      }
      if (!confirmed) {
        message('ordStatus', 'Confirm the return-label carrier charge first.', 'err');
        return;
      }
      if (!(await confirmDialog('Create a return label now? The connected carrier account may be charged.', {
        confirmText: 'Create return label',
        cancelText: 'Cancel',
      }))) return;
      button.disabled = true;
      message('ordStatus', 'Creating ShipStation return label…');
      try {
        const res = await api('/api/admin/shipstation', {
          method: 'POST',
          body: { action: 'return_label', order_id: id, label_id: labelId, confirm: true, reason },
        });
        message('ordStatus', res.already_created
          ? 'Existing return label loaded; no second provider request.'
          : 'Return label created and financial evidence recorded.', 'ok');
        await refreshOrder(id);
      } catch (err) {
        message('ordStatus', err.data?.error || 'Return-label result uncertain. Inspect ShipStation before retrying.', 'err');
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-shipstation-void-label]', async (event, button) => {
      const id = button.dataset.shipstationVoidLabel;
      const labelId = button.dataset.labelId;
      const control = button.closest('.adm-shipstation-void');
      const reason = control?.querySelector(`[data-shipstation-void-reason="${CSS.escape(id)}"]`)?.value.trim() || '';
      const confirmed = control?.querySelector(`[data-shipstation-void-confirm="${CSS.escape(id)}"]`)?.checked === true;
      if (reason.length < 8) {
        message('ordStatus', 'Enter a specific void reason (at least 8 characters).', 'err');
        return;
      }
      if (!confirmed) {
        message('ordStatus', 'Confirm the ShipStation void/refund request first.', 'err');
        return;
      }
      button.disabled = true;
      message('ordStatus', 'Voiding ShipStation label…');
      try {
        const res = await api('/api/admin/shipstation', {
          method: 'POST',
          body: { action: 'void_label', order_id: id, label_id: labelId, confirm: true, reason },
        });
        message('ordStatus', res.already_voided
          ? 'Label was already voided; no second provider request.'
          : 'Label voided. Carrier refund request recorded as pending.', 'ok');
        await refreshOrder(id);
      } catch (err) {
        message('ordStatus', err.data?.error || 'Label void failed. Check ShipStation before retrying.', 'err');
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
      message('ordStatus', 'Refunding…');
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
      message('ordStatus', 'Marking paid…');
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
