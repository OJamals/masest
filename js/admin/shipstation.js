import { api } from '../auth.js?v=20260807a';
import { esc } from '../util.js?v=20260807a';

const $ = (id) => document.getElementById(id);

export async function renderShipStationStatus() {
  const status = $('shipstationStatus');
  const detail = $('shipstationConfigDetail');
  const carriers = $('shipstationCarriers');
  const webhook = $('shipstationWebhookStatus');
  if (!status || !detail || !carriers || !webhook) return;
  status.textContent = 'Checking ShipStation…';
  status.dataset.state = '';
  try {
    const info = await api('/api/admin/shipstation');
    if (!info.config?.ready) {
      status.textContent = 'Configuration incomplete';
      status.dataset.state = 'err';
      detail.textContent = 'Add server-side API key and warehouse ID. Secret values are never returned to browser.';
    } else if (!info.connected) {
      status.textContent = 'Not connected';
      status.dataset.state = 'err';
      detail.textContent = 'Runtime config exists, but provider connection did not verify.';
    } else if (!info.warehouse_match) {
      status.textContent = 'Warehouse not available';
      status.dataset.state = 'err';
      detail.textContent = `Configured warehouse ${info.config.warehouse_id} was not returned by ShipStation. Create/select a ship-from warehouse, then update SHIPSTATION_WAREHOUSE_ID.`;
    } else {
      status.textContent = 'Connected';
      status.dataset.state = 'ok';
      const warehouse = (info.warehouses || []).find((item) => item.warehouse_id === info.config.warehouse_id);
      detail.textContent = warehouse
        ? `Warehouse: ${warehouse.name} (${warehouse.warehouse_id})`
        : `Configured warehouse: ${info.config.warehouse_id}`;
    }
    carriers.innerHTML = (info.carriers || []).length
      ? `<b>${(info.carriers || []).length} connected carrier(s)</b><span>${(info.carriers || []).map((item) => esc(item.name)).join(' · ')}</span>`
      : '<b>0 connected carriers</b><span>Connect carrier accounts in ShipStation API.</span>';
    webhook.textContent = info.webhook?.ready
      ? info.webhook.authentication === 'verified'
        ? 'Tracking webhook registered; custom token configured. Incoming requests also require ShipEngine RSA verification.'
        : 'Tracking webhook registered; provider masks custom headers. Incoming requests still require custom token + ShipEngine RSA verification.'
      : info.config?.webhook_token === 'missing'
        ? 'Tracking webhook token missing from server configuration.'
        : 'Tracking webhook not registered or authentication header differs.';
    webhook.dataset.state = info.webhook?.ready ? 'ok' : 'err';
  } catch (err) {
    status.textContent = err.data?.error || 'Status check failed';
    status.dataset.state = 'err';
    detail.textContent = 'Refresh after fixing Cloudflare runtime configuration.';
    carriers.innerHTML = '<b>Unavailable</b>';
    webhook.textContent = 'Tracking webhook verification unavailable.';
    webhook.dataset.state = 'err';
  }
}

export function wireShipStationStatus() {
  $('shipstationRefresh')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await renderShipStationStatus(); }
    finally { button.disabled = false; }
  });
  $('shipstationConfigureWebhook')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api('/api/admin/shipstation', {
        method: 'POST',
        body: { action: 'configure_tracking_webhook' },
      });
      await renderShipStationStatus();
    } catch (error) {
      const webhook = $('shipstationWebhookStatus');
      webhook.textContent = error.data?.error || 'Tracking webhook configuration failed.';
      webhook.dataset.state = 'err';
    } finally {
      button.disabled = false;
    }
  });
}
