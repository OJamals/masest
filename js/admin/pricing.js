// Admin pricing tab (#36 per-tab split). Per-variant tier pricing grid with inline
// row saves. Shared primitives ($, api, state, message, admSkeleton) are injected;
// esc comes from util.js and the dirty-edit helpers from edits.js.
import { esc } from '../util.js';
import { captureDirty, restoreDirty } from './edits.js';

export function createPricingTab({ $, api, state, message, admSkeleton }) {
  async function renderPricing({ refetch = true } = {}) {
    const box = $('admPricing');
    const snap = captureDirty(box);
    if (refetch) {
      box.innerHTML = admSkeleton();
      try {
        state.pricing = await api('/api/admin/variant-pricing');
        state.loaded.add('pricing');
      } catch {
        box.innerHTML = '<p class="adm-status" data-state="err">Could not load pricing. Reload to retry.</p>';
        return;
      }
    }
    const data = state.pricing || { tiers: ['retail', 'hvac', 'wholesale'], rows: [] };
    const q = $('priceSearch').value.trim().toLowerCase();
    const tiers = data.tiers || ['retail', 'hvac', 'wholesale'];
    const rows = (data.rows || []).filter((row) => JSON.stringify(row).toLowerCase().includes(q));
    const fmt = (value) => value == null ? '' : Number(value).toFixed(2);
    if (!rows.length) {
      box.innerHTML = '<p class="muted" style="padding:14px">No variants.</p>';
      return;
    }
    box.innerHTML = `<table class="adm"><thead><tr><th>Variant</th><th>VSKU</th><th>Base</th>${tiers.map((tier) => `<th>${esc(tier)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `
      <tr data-vsku="${esc(row.vsku)}">
        <td>${esc(row.product_name)} - ${esc(row.label)}${row.mode === 'quote' ? ' <span class="badge" data-s="quote">quote</span>' : ''}</td>
        <td><code>${esc(row.vsku)}</code></td>
        <td class="muted">${row.base_price == null ? '-' : fmt(row.base_price)}</td>
        ${tiers.map((tier) => `<td><input class="adm-input" data-price-tier="${esc(tier)}" type="number" step="0.01" min="0" value="${esc(row.tiers?.[tier] ?? '')}" placeholder="${row.base_price == null ? '-' : fmt(row.base_price)}"></td>`).join('')}
      </tr>
    `).join('')}</tbody></table><p id="priceRowStatus" class="adm-status" role="status"></p>`;
    restoreDirty(box, snap);
    box.querySelectorAll('[data-price-tier]').forEach((input) => {
      input.addEventListener('change', async () => {
        const row = input.closest('[data-vsku]');
        input.disabled = true;
        try {
          await api('/api/admin/variant-pricing', {
            method: 'POST',
            body: { vsku: row.dataset.vsku, tier: input.dataset.priceTier, price: input.value },
          });
          message('priceRowStatus', `${row.dataset.vsku} ${input.dataset.priceTier} saved.`, 'ok');
        } catch (err) {
          message('priceRowStatus', err.data?.error || 'Could not save the price. Retry.', 'err');
        } finally {
          input.disabled = false;
        }
      });
    });
  }

  return { renderPricing };
}
