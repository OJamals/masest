import { api } from "../auth.js";

const $ = (id) => document.getElementById(id);

export async function renderQboStatus() {
  const status = $("qboStatus");
  const button = $("qboConnect");
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
