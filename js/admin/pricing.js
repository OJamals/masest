// Unified live-pricing workspace. Product/tier, service, and program prices
// keep their domain tables, but staff edit all three through this boundary.
import { esc, delegate, rowMatchesQuery } from '../util.js?v=20260902d';

const DEFAULT_TIERS = ['retail', 'hvac', 'wholesale'];
const PRICE_SCOPES = new Set(['products', 'services', 'programs']);

export function filterPricingData(data = {}, query = '', scope = 'products') {
  const activeScope = PRICE_SCOPES.has(scope) ? scope : 'products';
  const q = String(query).trim().toLowerCase();
  return {
    tiers: data.tiers || DEFAULT_TIERS,
    rows: activeScope === 'products'
      ? (data.rows || []).filter((row) => rowMatchesQuery(row, q))
      : [],
    services: activeScope === 'services'
      ? (data.services || []).filter((row) => rowMatchesQuery(row, q))
      : [],
    programs: activeScope === 'programs'
      ? (data.programs || []).filter((row) => rowMatchesQuery(row, q))
      : [],
  };
}

function moneyValue(value) {
  return value == null ? '' : Number(value).toFixed(2);
}

function priceInput(value, attributes, label) {
  return `<input class="adm-input adm-price-input" name="price" type="number" min="0" step="0.01" value="${esc(moneyValue(value))}" ${attributes} aria-label="${esc(label)}">`;
}

export function createPricingTab({ $, api, state, message, admSkeleton, admEmpty }) {
  let pricingScope = 'products';

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

    const source = state.pricing || {
      tiers: DEFAULT_TIERS,
      rows: [],
      services: [],
      programs: [],
    };
    const q = $('priceSearch').value.trim().toLowerCase();
    const { tiers, rows, services, programs } = filterPricingData(source, q, pricingScope);

    if (!rows.length && !services.length && !programs.length) {
      const label = { products: 'product', services: 'service', programs: 'program' }[pricingScope];
      box.innerHTML = admEmpty(
        'ph-tag',
        q ? `No matching ${label} prices` : `No ${label} pricing records`,
        q ? `No ${label} names or identifiers match your search.` : `Add ${label} records before setting prices.`,
      );
      return;
    }

    box.innerHTML = `
      ${variantTable(rows, tiers)}
      ${serviceTable(services)}
      ${programTable(programs)}
    `;
  }

  function variantTable(rows, tiers) {
    if (!rows.length) return '';
    return `<section class="adm-price-section" aria-labelledby="variantPricingHeading">
      <div class="adm-section-head"><div><p class="adm-eyebrow">Catalog</p><h3 id="variantPricingHeading">Product and tier prices</h3></div></div>
      <div class="adm-table-wrap"><table class="adm"><thead><tr><th>Variant</th><th>VSKU</th><th>Minimum checkout</th>${tiers.map((tier) => `<th>${esc(tier)}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map((row) => `
        <tr data-price-resource="variant" data-vsku="${esc(row.vsku)}" data-capability-scope="product.write">
          <td>${esc(row.product_name)} - ${esc(row.label)} <span class="badge">${esc(row.market || 'industrial')}</span>${row.requires_quote ? ' <span class="badge" data-s="quote">quote only</span>' : ''}${row.activation_blocker ? ' <span class="badge" data-s="pending">awaiting parcel profile</span>' : ''}</td>
          <td><code>${esc(row.vsku)}</code></td>
          <td>${row.minimum_checkout_price == null ? '—' : esc(`$${Number(row.minimum_checkout_price).toFixed(2)}`)}</td>
          ${tiers.map((tier) => row.requires_quote
            ? '<td>—</td>'
            : `<td>${priceInput(
                row.tiers?.[tier] ?? (tier === 'retail' ? row.base_price : null),
                `data-price-tier="${esc(tier)}"${row.minimum_checkout_price == null ? '' : ` min="${esc(row.minimum_checkout_price)}"`}`,
                `${row.vsku} ${tier} price`,
              )}</td>`).join('')}
          <td>${row.requires_quote ? '' : `<button class="btn btn-primary btn-sm" type="button" data-price-save="variant" aria-label="Save prices for ${esc(row.product_name)} ${esc(row.label)}">Save</button>`}</td>
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
          <td><button class="btn btn-primary btn-sm" type="button" data-price-save="service" aria-label="Save price for ${esc(service.name)}">Save</button></td>
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
          <td><input class="adm-input" name="program_monthly_price" autocomplete="off" value="${esc(program.price)}" data-program-price aria-label="${esc(program.title)} monthly price"></td>
          <td><input class="adm-input" name="program_annual_price" autocomplete="off" value="${esc(program.annual)}" data-program-annual aria-label="${esc(program.title)} annual price"></td>
          <td><button class="btn btn-primary btn-sm" type="button" data-price-save="program" aria-label="Save display prices for ${esc(program.title || program.slug)}">Save</button></td>
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
    button.textContent = 'Saving…';
    message('pricingStatus', 'Saving live pricing…');
    try {
      const body = pricingBody(row);
      const response = await api('/api/admin/variant-pricing', {
        method: 'POST',
        body,
      });
      if (body.resource === 'variant') {
        const record = state.pricing?.rows?.find((item) => item.vsku === body.vsku);
        if (record) record.tiers = Object.fromEntries(Object.entries(body.tiers).map(([tier, value]) => [tier, value === '' ? null : Number(value)]));
      } else if (body.resource === 'service') {
        const record = state.pricing?.services?.find((item) => item.sku === body.sku);
        if (record) record.public_price = body.public_price === '' ? null : Number(body.public_price);
      } else {
        const record = state.pricing?.programs?.find((item) => item.slug === body.slug);
        if (record) Object.assign(record, { price: body.price, annual: body.annual, version: response.version });
        row.dataset.version = response.version;
      }
      message('pricingStatus', 'Pricing saved and live.', 'ok');
      button.textContent = 'Saved';
      button.disabled = false;
    } catch (error) {
      message('pricingStatus', error.data?.message || error.data?.error || 'Could not save pricing. Retry.', 'err');
      button.textContent = 'Retry save';
      button.disabled = false;
    }
  }

  function wirePricing() {
    delegate($('priceScopes'), 'click', '[data-price-scope]', (event, button) => {
      pricingScope = PRICE_SCOPES.has(button.dataset.priceScope) ? button.dataset.priceScope : 'products';
      $('priceScopes').querySelectorAll('[data-price-scope]').forEach((option) => {
        const active = option.dataset.priceScope === pricingScope;
        option.classList.toggle('is-active', active);
        option.setAttribute('aria-pressed', String(active));
      });
      const search = $('priceSearch');
      search.placeholder = {
        products: 'Search product name or VSKU…',
        services: 'Search service name or SKU…',
        programs: 'Search program name…',
      }[pricingScope];
      void renderPricing({ refetch: false });
    });
    delegate($('admPricing'), 'click', '[data-price-save]', (event, button) => {
      void savePricing(button);
    });
    delegate($('admPricing'), 'input', '[data-price-resource] input', (event, input) => {
      const button = input.closest('[data-price-resource]')?.querySelector('[data-price-save]');
      if (button && !button.disabled) button.textContent = 'Save';
    });
  }

  return { renderPricing, wirePricing };
}
