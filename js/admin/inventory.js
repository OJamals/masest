// Admin inventory card (#98, #36 per-tab split): bulk stock import + low-stock
// reorder list. Lives inside the Products tab; shared primitives ($, api,
// message, admSkeleton, admEmpty, downloadCsv) are injected. esc comes from util.
import { esc } from '../util.js?v=20260807i';

export function createInventoryCard({ $, api, message, admSkeleton, admEmpty, downloadCsv }) {
  let inventoryWired = false;

  async function renderLowStock() {
    const box = $('invLow');
    if (!box) return;
    box.innerHTML = admSkeleton();
    try {
      const r = await api('/api/admin/inventory?view=low');
      const low = r.low_stock || [];
      box.innerHTML = low.length
        ? `<div class="adm-table-wrap"><table class="adm"><thead><tr><th>SKU</th><th>Product</th><th>Variant</th><th class="num">Stock</th><th class="num">Reorder</th></tr></thead><tbody>${low.map((v) =>
            `<tr><td>${esc(v.vsku)}</td><td>${esc(v.products?.name || '')}</td><td>${esc(v.label)}</td><td class="num">${esc(v.stock)}</td><td class="num">${esc(v.reorder_point ?? 10)}</td></tr>`).join('')}</tbody></table></div>`
        : admEmpty('ph-package', 'No low-stock variants', 'Variants at or below their reorder point appear here.');
    } catch { box.innerHTML = '<p class="adm-status" data-state="err">Could not load low stock.</p>'; }
  }

  function wireInventory() {
    renderLowStock();
    if (inventoryWired || !$('invApply')) return;
    inventoryWired = true;
    $('invApply').addEventListener('click', async () => {
      const csv = $('invCsv').value.trim();
      if (!csv) { message('invStatus', 'Paste vsku,stock rows first.', 'err'); return; }
      message('invStatus', 'Applying…');
      try {
        const r = await api('/api/admin/inventory', { method: 'POST', body: { csv } });
        message('invStatus', `Updated ${r.updated.length}${r.failed.length ? `, ${r.failed.length} failed` : ''}.`, r.failed.length ? 'err' : 'ok');
        if (r.updated.length) { $('invCsv').value = ''; renderLowStock(); }
      } catch (err) { message('invStatus', err.data?.error || 'Could not apply stock. Retry.', 'err'); }
    });
    $('invReorderCsv').addEventListener('click', () =>
      downloadCsv('/api/admin/inventory?view=low&export=csv', 'masest-low-stock.csv', 'invStatus'));
  }

  return { renderLowStock, wireInventory };
}
