import { api } from "../auth.js";
import { esc, money, confirmDialog } from "../util.js?v=20260710d";

const $ = (id) => document.getElementById(id);

function failedOrderName(order) {
  return order.companies?.name || order.id;
}

function failedRefundName(refund) {
  return `Refund ${refund.id}`;
}

function failedSubscriptionName(invoice) {
  return invoice.companies?.name || invoice.tier || invoice.stripe_invoice_id || invoice.id;
}

function qboErrorLabel(error) {
  return {
    qbo_oauth_not_configured: "OAuth not configured",
    qbo_not_connected: "Connect QuickBooks first",
    qbo_config_missing: "Cloudflare config missing",
  }[error] || error || "Unknown QuickBooks error";
}

function renderFailedOrders(orders = [], refunds = [], subscriptions = []) {
  const root = $("qboFailedOrders");
  if (!root) return;
  if (!orders.length && !refunds.length && !subscriptions.length) {
    root.innerHTML = "";
    return;
  }
  const rows = [
    ...orders.map((order) => ({
      kind: "order",
      id: order.id,
      label: failedOrderName(order),
      total: money(order.total, order.currency || "USD"),
      attempts: order.qbo_attempts || 0,
      error: qboErrorLabel(order.qbo_error),
    })),
    ...refunds.map((refund) => ({
      kind: "refund",
      id: refund.id,
      label: failedRefundName(refund),
      total: money(refund.amount, "USD"),
      attempts: refund.qbo_attempts || 0,
      error: qboErrorLabel(refund.qbo_error),
    })),
    ...subscriptions.map((invoice) => ({
      kind: "subscription",
      id: invoice.id,
      label: failedSubscriptionName(invoice),
      total: money(invoice.total, invoice.currency || "USD"),
      attempts: invoice.qbo_attempts || 0,
      error: qboErrorLabel(invoice.qbo_error),
    })),
  ];
  root.innerHTML = `
    <h3>Sync follow-up</h3>
    <p class="muted adm-qbo-help">Resolve the readiness issue, then retry affected orders, refunds, or program invoices from here.</p>
    <div class="adm-table-wrap">
      <table class="adm">
        <thead><tr><th>Type</th><th>Record</th><th>Amount</th><th>Attempts</th><th>Error</th><th></th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${esc(row.kind)}</td>
              <td>${esc(row.label)}</td>
              <td>${row.total}</td>
              <td>${esc(row.attempts)}</td>
              <td>${esc(row.error)}</td>
              <td><button class="btn btn-ghost btn-sm" type="button" data-qbo-retry="${esc(row.id)}" data-qbo-retry-kind="${esc(row.kind)}" data-capability="admin.write">Retry</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>`;
}

function qboConfigDetail(config = {}, info = {}) {
  const missing = config.missing || [];
  if (config.ready === false) {
    if (config.source === "QBO_CONNECT_KEY" && missing.length) {
      return "QBO_CONNECT_KEY is present but incomplete. Update the Cloudflare production secret with the required QuickBooks fields. Secret values are never shown here.";
    }
    return "QuickBooks credentials are not configured in Cloudflare production. Add QBO_CONNECT_KEY or the equivalent individual variables. Secret values are never shown here.";
  }
  if (config.source === "QBO_CONNECT_KEY" || config.imported) {
    return "QBO_CONNECT_KEY is loaded. Connect QuickBooks, then run sync when needed.";
  }
  return info.connected
    ? "OAuth is connected. Manual sync is available for reconciliation follow-up."
    : "QuickBooks runtime config is ready. Connect QuickBooks to activate sync.";
}

function qboQueueText(counts = {}) {
  return `${counts.pending || 0} pending, ${counts.error || 0} errored, ${counts.synced || 0} synced`;
}

export async function renderQboStatus() {
  const status = $("qboStatus");
  const button = $("qboConnect");
  const syncButton = $("qboSyncNow");
  const detail = $("qboConfigDetail");
  const summary = $("qboSyncSummary");
  if (!status || !button) return;
  let allowConnect = false;
  let allowSync = false;
  status.textContent = "Checking QuickBooks...";
  status.dataset.state = "";
  button.disabled = true;
  if (syncButton) syncButton.disabled = true;
  if (detail) detail.textContent = "Checking Cloudflare runtime configuration.";
  try {
    const info = await api("/api/admin/qbo/status");
    const qboConfig = info.qbo_config || {};
    const configReady = qboConfig.ready !== false;
    allowConnect = configReady;
    allowSync = configReady && info.connected === true;
    if (!configReady) {
      status.textContent = "QuickBooks setup needed.";
      status.dataset.state = "warn";
    } else {
      status.textContent = info.connected ? `Connected${info.realm_id ? ` (${info.realm_id})` : ""}.` : "Ready to connect.";
      status.dataset.state = info.connected ? "ok" : ""; // ready-to-connect is a neutral state, not an error
    }
    if (detail) detail.textContent = qboConfigDetail(qboConfig, info);
    button.innerHTML = info.connected ? '<i class="ph ph-plugs-connected"></i> Reconnect QuickBooks' : '<i class="ph ph-plugs-connected"></i> Connect QuickBooks';
    button.disabled = !configReady;
    if (syncButton) syncButton.disabled = !allowSync;
    const disconnectBtn = $("qboDisconnect");
    if (disconnectBtn) disconnectBtn.hidden = !info.connected;
    if (summary) {
      const counts = info.sync_counts || {};
      const refundCounts = info.refund_sync_counts || {};
      const subscriptionCounts = info.subscription_sync_counts || {};
      const businessCounts = info.business_sync_counts || {};
      summary.textContent = `Businesses: ${businessCounts.linked || 0}/${businessCounts.eligible || 0} linked · Orders: ${qboQueueText(counts)} · Programs: ${qboQueueText(subscriptionCounts)} · Refunds: ${qboQueueText(refundCounts)}`;
    }
    renderFailedOrders(info.qbo_failed_orders || [], info.qbo_failed_refunds || [], info.qbo_failed_subscriptions || []);
  } catch (err) {
    status.textContent = err.data?.error || "QuickBooks status unavailable.";
    status.dataset.state = "err";
    // A transient status failure used to dead-end the card (Connect stayed
    // disabled with nothing to click) — offer the retry right here.
    if (detail) detail.innerHTML = 'Check the Cloudflare production environment. <button class="btn btn-ghost btn-sm" type="button" data-qbo-status-retry>Retry status check</button>';
  } finally {
    button.disabled = !allowConnect;
    if (syncButton) syncButton.disabled = !allowSync;
  }
}

export async function connectQbo() {
  const status = $("qboStatus");
  const button = $("qboConnect");
  try {
    if (button) button.disabled = true;
    if (status) {
      status.textContent = "Opening QuickBooks...";
      status.dataset.state = "";
    }
    const { url } = await api("/api/admin/qbo/connect?format=json");
    window.location.href = url;
  } catch (err) {
    if (status) {
      status.textContent = err.data?.error || "QuickBooks connect failed.";
      status.dataset.state = "err";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

export async function disconnectQbo() {
  if (!(await confirmDialog("Disconnect QuickBooks? This revokes the token at Intuit; you'll need to reconnect to resume syncing.", { confirmText: 'Disconnect', danger: true }))) return;
  const status = $("qboStatus");
  const button = $("qboDisconnect");
  try {
    if (button) button.disabled = true;
    await api("/api/admin/qbo/disconnect", { method: "POST" });
    await renderQboStatus();
  } catch (err) {
    if (status) {
      status.textContent = err.data?.error || "QuickBooks disconnect failed.";
      status.dataset.state = "err";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

export async function runQboSync() {
  const status = $("qboSyncStatus");
  const button = $("qboSyncNow");
  try {
    if (button) button.disabled = true;
    if (status) {
      status.textContent = "Running QuickBooks sync...";
      status.dataset.state = "";
    }
    const result = await api("/api/admin/qbo/sync", { method: "POST" });
    if (status) {
      status.textContent = `Sync complete: ${result.synced || 0} synced, ${result.failed || 0} failed.`;
      status.dataset.state = result.ok ? "ok" : "err";
    }
    await renderQboStatus();
  } catch (err) {
    if (status) {
      status.textContent = err.data?.error || "QuickBooks sync failed.";
      status.dataset.state = "err";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

export async function retryQboOrder(orderId, kind = "order") {
  const status = $("qboSyncStatus");
  if (status) {
    status.textContent = "Requeueing QuickBooks sync...";
    status.dataset.state = "";
  }
  try {
    await api("/api/admin/qbo/retry", { method: "POST", body: { id: orderId, kind } });
    if (status) {
      status.textContent = kind === "refund"
        ? "Refund credit memo requeued for QuickBooks sync."
        : kind === "subscription"
          ? "Program invoice requeued for QuickBooks sync."
          : "Order requeued for QuickBooks sync.";
      status.dataset.state = "ok";
    }
    await renderQboStatus();
  } catch (err) {
    if (status) {
      status.textContent = err.data?.error || "QuickBooks retry failed.";
      status.dataset.state = "err";
    }
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-qbo-status-retry]")) { renderQboStatus(); return; }
  const button = event.target.closest("[data-qbo-retry]");
  if (!button) return;
  // Disable while in flight — a double-click would requeue the same order twice.
  button.disabled = true;
  retryQboOrder(button.dataset.qboRetry, button.dataset.qboRetryKind || "order").finally(() => { button.disabled = false; });
});
