// Unified live-pricing workspace. Product/tier, service, and program prices
// keep their domain tables, but staff edit all three through this boundary.
import { esc, delegate, rowMatchesQuery } from '../util.js?v=20260807f';

const DEFAULT_TIERS = ['retail', 'hvac', 'wholesale'];

function moneyValue(value) {
  return value == null ? '' : Number(value).toFixed(2);
}

function priceInput(value, attributes, label) {
  return `<input class="adm-input adm-price-input" type="number" min="0" step="0.01" value="${esc(moneyValue(value))}" ${attributes} aria-label="${esc(label)}">`;
}

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

    const data = state.pricing || {
      tiers: DEFAULT_TIERS,
      rows: [],
      services: [],
      programs: [],
    };
    const q = $('priceSearch').value.trim().toLowerCase();
    const tiers = data.tiers || DEFAULT_TIERS;
    const rows = (data.rows || []).filter((row) => rowMatchesQuery(row, q));
    const services = (data.services || []).filter((row) => rowMatchesQuery(row, q));
    const programs = (data.programs || []).filter((row) => rowMatchesQuery(row, q));

    if (!rows.length && !services.length && !programs.length) {
      box.innerHTML = admEmpty(
        'ph-tag',
        q ? 'No matching prices' : 'No pricing records',
        q ? 'No products, services, or programs match your search.' : 'Add catalog records before setting prices.',
      );
      return;
    }

    box.innerHTML = `
      <p class="muted" role="note">Live pricing authority. Saved changes feed checkout, product selectors, public pricing tables, services, programs, and bound comparison content without a site rebuild.</p>
      ${variantTable(rows, tiers)}
      ${serviceTable(services)}
      ${programTable(programs)}
    `;
  }

  function variantTable(rows, tiers) {
    if (!rows.length) return '';
    return `<section class="adm-price-section" aria-labelledby="variantPricingHeading">
      <div class="adm-section-head"><div><p class="adm-eyebrow">Catalog</p><h3 id="variantPricingHeading">Product and tier prices</h3></div></div>
      <div class="adm-table-wrap"><table class="adm"><thead><tr><th>Variant</th><th>VSKU</th>${tiers.map((tier) => `<th>${esc(tier)}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map((row) => `
        <tr data-price-resource="variant" data-vsku="${esc(row.vsku)}" data-capability-scope="product.write">
          <td>${esc(row.product_name)} - ${esc(row.label)}${row.mode === 'quote' ? ' <span class="badge" data-s="quote">quote</span>' : ''}</td>
          <td><code>${esc(row.vsku)}</code></td>
          ${tiers.map((tier) => `<td>${priceInput(
            row.tiers?.[tier] ?? (tier === 'retail' ? row.base_price : null),
            `data-price-tier="${esc(tier)}"`,
            `${row.vsku} ${tier} price`,
          )}</td>`).join('')}
          <td><button class="btn btn-primary btn-sm" type="button" data-price-save="variant">Save</button></td>
        </tr>
      `).join('')}</tbody></table></div>
    </section>`;
  }

  function serviceTable(services) {
    if (!services.length) return '';
    return `<section class="adm-price-section" aria-labelledby="servicePricingHeading">
      <div class="adm-section-head"><div><p class="adm-eyebrow">Services</p><h3 id="servicePricingHeading">Service and package prices</h3></div></div>
      <div class="adm-table-wrap"><table class="adm"><thead><tr><th>Service</th><th>SKU</th><th>Unit</th><th>Public price</th><th></th></tr></thead><tbody>${services.map((service) => `
        <tr data-price-resource="service" data-sku="${esc(service.sku)}" data-capability-scope="product.write">
          <td>${esc(service.name)}</td>
          <td><code>${esc(service.sku)}</code></td>
          <td>${esc(service.unit || 'quoted scope')}</td>
          <td>${priceInput(service.public_price, 'data-service-price', `${service.name} public price`)}</td>
          <td><button class="btn btn-primary btn-sm" type="button" data-price-save="service">Save</button></td>
        </tr>
      `).join('')}</tbody></table></div>
    </section>`;
  }

  function programTable(programs) {
    if (!programs.length) return '';
    return `<section class="adm-price-section" aria-labelledby="programPricingHeading">
      <div class="adm-section-head"><div><p class="adm-eyebrow">Programs</p><h3 id="programPricingHeading">Program price ranges</h3></div></div>
      <div class="adm-table-wrap"><table class="adm"><thead><tr><th>Program</th><th>Monthly display</th><th>Annual display</th><th></th></tr></thead><tbody>${programs.map((program) => `
        <tr data-price-resource="program" data-slug="${esc(program.slug)}" data-version="${esc(program.version)}" data-capability-scope="product.write">
          <td>${esc(program.title || program.slug)}</td>
          <td><input class="adm-input" value="${esc(program.price)}" data-program-price aria-label="${esc(program.title)} monthly price"></td>
          <td><input class="adm-input" value="${esc(program.annual)}" data-program-annual aria-label="${esc(program.title)} annual price"></td>
          <td><button class="btn btn-primary btn-sm" type="button" data-price-save="program">Save</button></td>
        </tr>
      `).join('')}</tbody></table></div>
    </section>`;
  }

  function pricingBody(row) {
    const resource = row.dataset.priceResource;
    if (resource === 'variant') {
      const tiers = {};
      row.querySelectorAll('[data-price-tier]').forEach((input) => {
        tiers[input.dataset.priceTier] = input.value;
      });
      return { resource, vsku: row.dataset.vsku, tiers };
    }
    if (resource === 'service') {
      return {
        resource,
        sku: row.dataset.sku,
        public_price: row.querySelector('[data-service-price]').value,
      };
    }
    return {
      resource,
      slug: row.dataset.slug,
      price: row.querySelector('[data-program-price]').value,
      annual: row.querySelector('[data-program-annual]').value,
      expected_version: Number(row.dataset.version),
    };
  }

  async function savePricing(button) {
    const row = button.closest('[data-price-resource]');
    if (!row) return;
    button.disabled = true;
    message('pricingStatus', 'Saving live pricing…');
    try {
      await api('/api/admin/variant-pricing', {
        method: 'POST',
        body: pricingBody(row),
      });
      message('pricingStatus', 'Pricing saved and live.', 'ok');
      await renderPricing();
    } catch (error) {
      message('pricingStatus', error.data?.message || error.data?.error || 'Could not save pricing. Retry.', 'err');
      button.disabled = false;
    }
  }

  function wirePricing() {
    delegate($('admPricing'), 'click', '[data-price-save]', (event, button) => {
      void savePricing(button);
    });
  }

  return { renderPricing, wirePricing };
}
