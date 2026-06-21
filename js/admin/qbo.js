import { api } from "../auth.js";

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function money(value, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value || 0));
}

function failedOrderName(order) {
  return order.companies?.name || order.id;
}

function renderFailedOrders(orders = []) {
  const root = $("qboFailedOrders");
  if (!root) return;
  if (!orders.length) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML = `
    <h3>Failed syncs</h3>
    <div class="adm-table-wrap">
      <table class="adm">
        <thead><tr><th>Order</th><th>Total</th><th>Attempts</th><th>Error</th><th></th></tr></thead>
        <tbody>
          ${orders.map((order) => `
            <tr>
              <td>${escapeHtml(failedOrderName(order))}</td>
              <td>${money(order.total, order.currency || "USD")}</td>
              <td>${escapeHtml(order.qbo_attempts || 0)}</td>
              <td>${escapeHtml(order.qbo_error || "Unknown QuickBooks error")}</td>
              <td><button class="btn btn-ghost btn-sm" type="button" data-qbo-retry="${escapeHtml(order.id)}">Retry</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>`;
}

export async function renderQboStatus() {
  const status = $("qboStatus");
  const button = $("qboConnect");
  const summary = $("qboSyncSummary");
  if (!status || !button) return;
  status.textContent = "Checking QuickBooks...";
  status.dataset.state = "";
  button.disabled = true;
  try {
    const info = await api("/api/admin/qbo/status");
    status.textContent = info.connected ? `Connected${info.realm_id ? ` (${info.realm_id})` : ""}.` : "Not connected.";
    status.dataset.state = info.connected ? "ok" : "err";
    button.innerHTML = info.connected ? '<i class="ph ph-plugs-connected"></i> Reconnect QuickBooks' : '<i class="ph ph-plugs-connected"></i> Connect QuickBooks';
    if (summary) {
      const counts = info.sync_counts || {};
      summary.textContent = `Queue: ${counts.pending || 0} pending, ${counts.error || 0} error, ${counts.synced || 0} synced.`;
    }
    renderFailedOrders(info.qbo_failed_orders || []);
  } catch (err) {
    status.textContent = err.data?.error || "QuickBooks status unavailable.";
    status.dataset.state = "err";
  } finally {
    button.disabled = false;
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

export async function retryQboOrder(orderId) {
  const status = $("qboSyncStatus");
  if (status) {
    status.textContent = "Requeueing QuickBooks sync...";
    status.dataset.state = "";
  }
  try {
    await api("/api/admin/qbo/retry", { method: "POST", body: { id: orderId } });
    if (status) {
      status.textContent = "Order requeued for QuickBooks sync.";
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
  const button = event.target.closest("[data-qbo-retry]");
  if (!button) return;
  retryQboOrder(button.dataset.qboRetry);
});
