// Admin pricing tab (#36 per-tab split). Prices are displayed from the workbook-
// managed catalog seed so staff can verify tiers without creating pricing drift.
import { esc, rowMatchesQuery } from '../util.js?v=20260725a';

export function createPricingTab({ $, api, state, message, admSkeleton, admEmpty }) {
  async function renderPricing({ refetch = true } = {}) {
    const box = $('admPricing');
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
    const rows = (data.rows || []).filter((row) => rowMatchesQuery(row, q));
    const fmt = (value) => value == null ? '' : Number(value).toFixed(2);
    if (!rows.length) {
      box.innerHTML = admEmpty('ph-tag', q ? 'No matching variants' : 'No variants', q ? 'No variants match your search.' : 'Add product variants to set tier pricing.');
      return;
    }
    box.innerHTML = `<p class="muted" role="note">Verification view only. Reflect approved workbook changes in the catalog seed data, then run <code>npm run seed</code>.</p><table class="adm"><thead><tr><th>Variant</th><th>VSKU</th><th>Base</th>${tiers.map((tier) => `<th>${esc(tier)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `
      <tr data-vsku="${esc(row.vsku)}">
        <td>${esc(row.product_name)} - ${esc(row.label)}${row.mode === 'quote' ? ' <span class="badge" data-s="quote">quote</span>' : ''}</td>
        <td><code>${esc(row.vsku)}</code></td>
        <td class="muted">${row.base_price == null ? '-' : `$${fmt(row.base_price)}`}</td>
        ${tiers.map((tier) => {
          const price = row.tiers?.[tier];
          return `<td><span class="adm-managed-price">${price == null ? (row.base_price == null ? '-' : `$${fmt(row.base_price)} fallback`) : `$${fmt(price)}`}</span></td>`;
        }).join('')}
      </tr>
    `).join('')}</tbody></table>`;
  }

  function wirePricing() {}

  return { renderPricing, wirePricing };
}
