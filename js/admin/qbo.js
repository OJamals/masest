import { api } from "../auth.js";

const $ = (id) => document.getElementById(id);

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
    status.textContent = info.connected
      ? `Connected${info.realm_id ? ` to realm ${info.realm_id}` : ""}.`
      : "Not connected.";
    status.dataset.state = info.connected ? "ok" : "err";
    button.innerHTML = `<i class="ph ph-plugs-connected"></i> ${info.connected ? "Reconnect QuickBooks" : "Connect QuickBooks"}`;
    if (summary) {
      const sync_counts = info.sync_counts || {};
      summary.textContent = `Queue: ${sync_counts.pending || 0} pending, ${sync_counts.error || 0} error, ${sync_counts.synced || 0} synced.`;
    }
  } catch (err) {
    status.textContent = err.data?.error || "QuickBooks status unavailable.";
    status.dataset.state = "err";
    if (summary) summary.textContent = "";
  } finally {
    button.disabled = false;
  }
}

export async function connectQbo() {
  const status = $("qboStatus");
  const button = $("qboConnect");
  if (button) button.disabled = true;
  if (status) {
    status.textContent = "Opening QuickBooks...";
    status.dataset.state = "";
  }

  try {
    const out = await api("/api/admin/qbo/connect?format=json");
    window.location.assign(out.url);
  } catch (err) {
    if (status) {
      status.textContent = err.data?.error || "QuickBooks connect failed.";
      status.dataset.state = "err";
    }
    if (button) button.disabled = false;
  }
}

export async function runQboSync() {
  const status = $("qboSyncStatus");
  const button = $("qboSyncNow");
  if (button) button.disabled = true;
  if (status) {
    status.textContent = "Running QuickBooks sync...";
    status.dataset.state = "";
  }
  try {
    const out = await api("/api/admin/qbo/sync", "POST");
    if (status) {
      status.textContent = `Claimed ${out.claimed || 0}; synced ${out.synced || 0}; failed ${out.failed || 0}.`;
      status.dataset.state = out.failed ? "err" : "ok";
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
