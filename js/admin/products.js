// Admin products tab (#36 per-tab split). Catalog product + variant CRUD, inline
// image/gallery upload, and the add-product / add-variant forms. Shared primitives
// ($, api, state, message, admSkeleton, admEmpty) are injected; esc/safeUrl/
// confirmDialog, getToken, and the dirty-edit helpers come from their own modules.
import { esc, safeUrl, confirmDialog, delegate, moneyDisplay, rowMatchesQuery } from '../util.js?v=20260913c';
import { captureDirty, restoreDirty } from './edits.js?v=20260913c';
import { PRODUCTS } from '../main/catalog-data.js?v=20260913c';
import { openImageLibraryPicker } from './image-library-picker.js?v=20260913c';

export function withCatalogMediaFallback(product = {}) {
  const catalog = PRODUCTS[product.sku === 'cr-hd' ? 'crhd' : product.sku];
  const imageUrl = product.image_url || catalog?.image || null;
  const name = catalog?.name || product.name || product.sku || 'Product';
  return {
    ...product,
    image_url: imageUrl,
    photo_alt: product.photo_alt || (imageUrl ? `${name} product image` : null),
    gallery: Array.isArray(product.gallery) ? product.gallery : [],
  };
}

export function createProductsTab({ $, api, state, message, admSkeleton, admEmpty }) {
  const normalizeProductQuery = (value) => {
    const query = String(value || '').trim();
    return query.length <= 100 && !/[\u0000-\u001F\u007F]/.test(query) ? query : '';
  };
  const initialProductQuery = typeof location === 'undefined'
    ? ''
    : normalizeProductQuery(new URLSearchParams(location.search).get('product_q'));
  if ($('prodSearch') && !$('prodSearch').value && initialProductQuery) {
    $('prodSearch').value = initialProductQuery;
  }

  function syncProductQueryUrl(query) {
    if (typeof location === 'undefined' || typeof history === 'undefined') return;
    const params = new URLSearchParams(location.search);
    if (query) params.set('product_q', query);
    else params.delete('product_q');
    const search = params.toString();
    const next = `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (next !== current) history.replaceState(null, '', next);
  }

  async function renderProducts({ refetch = true } = {}) {
    const box = $('admProducts');
    const snap = captureDirty(box);
    if (refetch) {
      box.innerHTML = admSkeleton();
      try {
        const response = await api('/api/admin/products');
        state.products = (response.products || []).map(withCatalogMediaFallback);
        state.loaded.add('products');
        if (response.media_ready === false) {
          message('prodStatus', 'Apply site/supabase/schema-phase5.sql to enable product photos.', 'err');
        }
      } catch {
        box.innerHTML = '<p class="adm-status" data-state="err">Could not load products. Reload to retry.</p>';
        return;
      }
    }
    state.products = (state.products || []).map(withCatalogMediaFallback);
    const productQuery = normalizeProductQuery($('prodSearch').value);
    syncProductQueryUrl(productQuery);
    const q = productQuery.toLowerCase();
    const products = state.products.filter((product) => rowMatchesQuery(product, q));
    if (!products.length) {
      box.innerHTML = admEmpty('ph-cube', 'No products', 'Add catalog products to manage them here.');
      return;
    }
    box.innerHTML = `<div class="product-admin-list">${products.map((p) => `
    <article class="product-admin-card" data-product="${esc(p.sku)}" data-capability-scope="product.write">
      <div class="product-admin-row">
        ${productThumb(p)}
        <div class="product-admin-id">
          <span class="product-admin-sku">${esc(p.sku)}</span>
          <h3>${esc(p.name || p.sku)}</h3>
        </div>
        <span class="product-admin-price">${p.price == null ? 'Pricing workspace' : esc(moneyDisplay(p.price, p.currency || 'usd'))}</span>
        <div class="product-admin-actions">
          <label class="product-active-toggle"><input type="checkbox" name="product_active" ${p.active !== false ? 'checked' : ''} data-field="active"> Active</label>
          <button class="btn btn-primary btn-sm" data-save-product="${esc(p.sku)}" type="button" disabled title="Edit a field to enable">Save</button>
          <button class="btn btn-ghost btn-sm" data-remove-product="${esc(p.sku)}" type="button">Remove</button>
        </div>
      </div>
      <details class="product-admin-editor"${q && products.length === 1 ? ' open' : ''}>
        <summary>Edit product details</summary>
        <div class="product-admin-media">
          ${productMediaExtra(p)}
        </div>
        <div class="product-admin-fields">
        <label>Name <input class="adm-input" name="product_name" autocomplete="off" value="${esc(p.name)}" data-field="name"></label>
        <label>Mode <select class="adm-select" name="product_mode" data-field="mode"><option value="buy" ${p.mode === 'buy' ? 'selected' : ''}>Buy</option><option value="quote" ${p.mode === 'quote' ? 'selected' : ''}>Quote</option></select></label>
        <label>Price <output class="adm-managed-price" aria-label="Pricing-workspace-managed product price">${p.price == null ? 'Pricing workspace' : esc(moneyDisplay(p.price, p.currency || 'usd'))}</output></label>
        <label>Stock <input class="adm-input" name="product_stock" type="number" min="0" step="1" value="${esc(p.stock ?? '')}" data-field="stock"></label>
        <label>HMIS <input class="adm-input" name="product_hmis" autocomplete="off" value="${esc(p.hmis || '')}" data-field="hmis" placeholder="H-F-R e.g. 2-0-1…"></label>
        <label>Group key <input class="adm-input" name="product_group_key" autocomplete="off" value="${esc(p.group_key || '')}" data-field="group_key" placeholder="Groups related SKUs…"></label>
        <label>Sort <input class="adm-input" name="product_sort" type="number" step="1" value="${esc(p.sort ?? '')}" data-field="sort"></label>
        <label class="product-flag-toggle"><input type="checkbox" name="product_hazmat" ${p.hazmat ? 'checked' : ''} data-field="hazmat"> Hazmat</label>
        <label class="product-flag-toggle"><input type="checkbox" name="product_taxable" ${p.taxable !== false ? 'checked' : ''} data-field="taxable"> Taxable</label>
        <label class="wide">Photo URL <input class="adm-input" name="product_image_url" type="url" autocomplete="url" spellcheck="false" value="${esc(p.image_url || '')}" data-field="image_url"></label>
        <label class="wide">Photo alt <input class="adm-input" name="product_photo_alt" autocomplete="off" value="${esc(p.photo_alt || '')}" data-field="photo_alt"></label>
        </div>
        <div class="product-admin-variants">
          <div class="product-admin-subhead">
            <h4>Variants</h4>
            <span>${esc((p.product_variants || []).length)} configured</span>
          </div>
          ${variantRows(p)}
        </div>
      </details>
    </article>
  `).join('')}</div>`;
    restoreDirty(box, snap);
    syncEditedFromDirty(box);
  }

  /* SQ-18: Save rendered as a filled primary button on every row at once, so the
     eye met fifteen equal calls to action with no way to tell which row was
     actually dirty. Each Save is now disabled until its own scope is edited.

     This cannot ride on `data-dirty`: markDirty() in admin.js deliberately skips
     checkboxes — and the Active toggle is one — while captureDirty() reads
     `.value`, which is meaningless for a checkbox. So edit state is tracked
     separately, per scope, and `data-dirty` keeps its restore-after-rebuild job. */
  function saveScopeOf(el) {
    return el.closest?.('[data-variant]') || el.closest?.('[data-product]') || null;
  }

  function syncSaveButton(scope) {
    if (!scope) return;
    const isVariant = scope.matches('[data-variant]');
    const button = isVariant
      ? scope.querySelector('[data-save-variant]')
      : [...scope.querySelectorAll('[data-save-product]')].find((b) => saveScopeOf(b) === scope);
    if (!button) return;
    const edited = scope.dataset.edited === '1';
    button.disabled = !edited;
    button.title = edited ? '' : 'Edit a field to enable';
  }

  function markScopeEdited(target) {
    const scope = saveScopeOf(target);
    if (!scope) return;
    scope.dataset.edited = '1';
    syncSaveButton(scope);
  }

  /* Nothing clears edit state explicitly after a save: the list rebuilds, every
     Save renders disabled again, and restoreDirty() re-marks only the controls
     whose value still differs from the server's. A saved row therefore matches
     and stays disabled, while a failed save keeps its edits and stays saveable. */

  // A rebuild re-renders every Save disabled; restoreDirty() then puts the user's
  // unsaved edits back. Re-derive edit state from those so their rows stay saveable.
  function syncEditedFromDirty(box) {
    box?.querySelectorAll?.('[data-dirty="1"]').forEach((el) => markScopeEdited(el));
  }

  // Row + media actions delegated once on the stable #admProducts container (#36).
  function wireProducts() {
    const box = $('admProducts');
    if (!box) return;
    delegate(box, 'input', '[data-field], [data-vfield]', (event, el) => markScopeEdited(el));
    delegate(box, 'change', '[data-field], [data-vfield]', (event, el) => markScopeEdited(el));
    delegate(box, 'click', '[data-save-product]', (event, button) => saveProductRow(button.dataset.saveProduct));
    delegate(box, 'click', '[data-remove-product]', (event, button) => removeProduct(button.dataset.removeProduct));
    delegate(box, 'click', '[data-save-variant]', (event, button) => saveVariantRow(button.dataset.saveVariant));
    delegate(box, 'click', '[data-remove-variant]', (event, button) => removeVariant(button.dataset.removeVariant));
    delegate(box, 'click', '[data-product-asset]', (event, button) => {
      void chooseProductAsset(
        button.closest('[data-product]').dataset.product,
        button.dataset.productAsset,
        button,
      );
    });
    delegate(box, 'click', '[data-gact]', async (event, btn) => {
      const sku = btn.closest('[data-product]')?.dataset.product;
      if (!sku) return;
      const prod = (state.products || []).find((x) => x.sku === sku);
      const gallery = Array.isArray(prod?.gallery) ? [...prod.gallery] : [];
      const act = btn.dataset.gact;
      btn.disabled = true;
      try {
        if (act === 'del') {
          await api('/api/admin/product-image', { method: 'DELETE', body: { sku, url: btn.dataset.gurl } });
        } else if (act === 'primary') {
          await api('/api/admin/product-image', { method: 'PATCH', body: { sku, action: 'set_primary', url: btn.dataset.gurl } });
        } else if (act === 'up' || act === 'down') {
          const i = Number(btn.dataset.gidx); const j = act === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= gallery.length) { btn.disabled = false; return; }
          [gallery[i], gallery[j]] = [gallery[j], gallery[i]];
          await api('/api/admin/product-image', { method: 'PATCH', body: { sku, action: 'reorder', gallery } });
        }
        message('prodStatus', 'Gallery updated.', 'ok');
        await renderProducts();
      } catch (err) { message('prodStatus', err.data?.error || 'Could not update the gallery. Retry.', 'err'); btn.disabled = false; }
    });
  }

  async function chooseProductAsset(sku, slot, trigger) {
    const details = await openImageLibraryPicker({
      api,
      trigger,
      usage: slot === 'gallery' ? 'product-gallery' : 'product-primary',
      autoOpenLibrary: true,
    });
    if (!details) return;
    message('prodStatus', 'Linking CMS image…');
    try {
      if (slot === 'gallery') {
        await api('/api/admin/product-image', {
          method: 'PATCH',
          body: { sku, action: 'add_gallery', url: details.url },
        });
      } else {
        const row = document.querySelector(`[data-product="${CSS.escape(sku)}"]`);
        row.querySelector('[data-field="image_url"]').value = details.url;
        row.querySelector('[data-field="photo_alt"]').value = details.alt;
        await api('/api/admin/products', { method: 'POST', body: { product: rowProduct(sku) } });
      }
      message('prodStatus', `${sku} CMS image linked.`, 'ok');
      await renderProducts();
    } catch (error) {
      message('prodStatus', error.data?.message || error.data?.error || 'Could not link the CMS image.', 'err');
    }
  }

  // SQ-18: the collapsed row shows only the thumbnail (verified 54px, renders fine —
  // this does not touch that). The CMS picker buttons + gallery grid used to stack
  // vertically under it, which was most of the 222px row height; they now live in
  // productMediaExtra(), rendered inside the details editor instead of the row.
  function productThumb(product) {
    return product.image_url
      ? `<img class="product-photo" src="${esc(safeUrl(product.image_url))}" alt="${esc(product.photo_alt || product.name || '')}" width="1200" height="1200" loading="lazy" decoding="async">`
      : '<span class="product-photo product-photo-empty">No photo</span>';
  }

  function productMediaExtra(product) {
    const gallery = Array.isArray(product.gallery) && product.gallery.length
      ? `<div class="product-gallery">${product.gallery.map((url, index) => `
        <span class="product-gallery-item">
          <img src="${esc(safeUrl(url))}" alt="" width="1200" height="1200" loading="lazy">
          <span class="product-gallery-actions">
            <button type="button" class="gbtn" data-gact="primary" data-gurl="${esc(url)}" title="Make primary" aria-label="Make primary photo">★</button>
            <button type="button" class="gbtn" data-gact="up" data-gidx="${index}" title="Move up" aria-label="Move photo up">↑</button>
            <button type="button" class="gbtn" data-gact="down" data-gidx="${index}" title="Move down" aria-label="Move photo down">↓</button>
            <button type="button" class="gbtn" data-gact="del" data-gurl="${esc(url)}" title="Remove" aria-label="Remove photo">×</button>
          </span>
        </span>`).join('')}</div>`
      : '';
    return `
      ${gallery}
      <button class="btn btn-secondary btn-sm product-cms-image" type="button" data-product-asset="primary">Choose primary</button>
      <button class="btn btn-ghost btn-sm product-cms-image" type="button" data-product-asset="gallery">Add gallery image</button>
    `;
  }

  function variantRows(product) {
    const variants = (product.product_variants || []).slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    if (!variants.length) return '<span class="muted">No variants</span>';
    return `<div class="variant-stack">${variants.map((v) => `
    <div class="variant-row" data-variant="${esc(v.vsku)}">
      <p class="variant-meta"><span class="badge">${esc(v.market || 'industrial')}</span> <span class="badge">${esc(v.package_kind || 'unit')}</span>${v.activation_blocker ? ' <span class="badge" data-s="pending">awaiting parcel profile</span>' : ''}</p>
      <label>Label <input class="adm-input" name="variant_label" autocomplete="off" value="${esc(v.label || '')}" data-vfield="label" aria-label="Variant label"></label>
      <label>Gallons <input class="adm-input" name="variant_gallons" type="number" min="0" step="0.01" value="${esc(v.gallons ?? '')}" data-vfield="gallons" aria-label="Gallons"></label>
      <label>Price <output class="adm-managed-price" aria-label="Pricing-workspace-managed variant price">${v.price == null ? 'Pricing workspace' : esc(moneyDisplay(v.price, v.currency || product.currency || 'usd'))}</output></label>
      <label>Stock <input class="adm-input" name="variant_stock" type="number" min="0" step="1" value="${esc(v.stock ?? '')}" data-vfield="stock" aria-label="Variant stock"></label>
      <label>Ship lb <input class="adm-input" name="variant_shipping_weight_lb" type="number" min="0.001" step="0.001" value="${esc(v.shipping_weight_lb ?? '')}" data-vfield="shipping_weight_lb" aria-label="Shipping weight pounds"></label>
      <label>Length in <input class="adm-input" name="variant_shipping_length_in" type="number" min="0.01" step="0.01" value="${esc(v.shipping_length_in ?? '')}" data-vfield="shipping_length_in" aria-label="Package length inches"></label>
      <label>Width in <input class="adm-input" name="variant_shipping_width_in" type="number" min="0.01" step="0.01" value="${esc(v.shipping_width_in ?? '')}" data-vfield="shipping_width_in" aria-label="Package width inches"></label>
      <label>Height in <input class="adm-input" name="variant_shipping_height_in" type="number" min="0.01" step="0.01" value="${esc(v.shipping_height_in ?? '')}" data-vfield="shipping_height_in" aria-label="Package height inches"></label>
      <label class="variant-active"><input type="checkbox" name="variant_active" ${v.active !== false ? 'checked' : ''} ${v.requires_quote ? 'disabled' : ''} data-vfield="active"> ${v.requires_quote ? 'Quote only' : 'Active'}</label>
      <button class="btn btn-primary btn-sm" data-save-variant="${esc(v.vsku)}" type="button" disabled title="Edit a field to enable">Save</button>
      <button class="btn btn-ghost btn-sm" data-remove-variant="${esc(v.vsku)}" type="button">Remove</button>
      <input type="hidden" name="variant_product_sku" value="${esc(v.product_sku || product.sku)}" data-vfield="product_sku">
      <input type="hidden" name="variant_sku" value="${esc(v.vsku)}" data-vfield="vsku">
    </div>
  `).join('')}</div>`;
  }

  function rowProduct(sku) {
    const row = document.querySelector(`[data-product="${CSS.escape(sku)}"]`);
    const product = { sku };
    row.querySelectorAll('[data-field]').forEach((field) => {
      const key = field.dataset.field;
      product[key] = field.type === 'checkbox' ? field.checked : field.value;
    });
    product.track_stock = product.stock !== '';
    return product;
  }

  async function saveProductRow(sku) {
    message('prodStatus', 'Saving…');
    try {
      const response = await api('/api/admin/products', { method: 'POST', body: { product: rowProduct(sku) } });
      message('prodStatus', response.warning || 'Saved.', response.warning ? 'err' : 'ok');
      await renderProducts();
    } catch (err) {
      message('prodStatus', err.data?.error || 'Could not save the product. Retry.', 'err');
    }
  }

  async function removeProduct(sku) {
    if (!(await confirmDialog(`Deactivate ${sku}? Existing order history stays intact.`, { confirmText: 'Deactivate', danger: true }))) return;
    try {
      await api('/api/admin/products', { method: 'DELETE', body: { sku } });
      message('prodStatus', 'Product deactivated.', 'ok');
      await renderProducts();
    } catch (err) {
      message('prodStatus', err.data?.hint || err.data?.error || 'Could not deactivate the product. Retry.', 'err');
    }
  }

  function rowVariant(vsku) {
    const row = document.querySelector(`[data-variant="${CSS.escape(vsku)}"]`);
    const variant = { vsku };
    row.querySelectorAll('[data-vfield]').forEach((field) => {
      const key = field.dataset.vfield;
      variant[key] = field.type === 'checkbox' ? field.checked : field.value;
    });
    variant.track_stock = variant.stock !== '';
    return variant;
  }

  async function saveVariantRow(vsku) {
    message('prodStatus', 'Saving variant…');
    try {
      await api('/api/admin/products', { method: 'POST', body: { variant: rowVariant(vsku) } });
      message('prodStatus', 'Variant saved.', 'ok');
      await renderProducts();
    } catch (err) {
      message('prodStatus', err.data?.error || 'Could not save the variant. Retry.', 'err');
    }
  }

  async function removeVariant(vsku) {
    if (!(await confirmDialog(`Remove ${vsku}? Existing order history stays intact.`, { confirmText: 'Remove', danger: true }))) return;
    try {
      await api('/api/admin/products', { method: 'DELETE', body: { vsku, hard: true } });
      message('prodStatus', 'Variant removed.', 'ok');
      await renderProducts();
    } catch (err) {
      message('prodStatus', err.data?.error || 'Could not remove the variant. Retry.', 'err');
    }
  }

  function wireProductForm() {
    $('prodForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const product = {
        sku: $('npSku').value.trim(),
        name: $('npName').value.trim() || undefined,
        mode: $('npMode').value,
        stock: $('npStock').value,
        track_stock: $('npStock').value !== '',
        image_url: $('npImageUrl').value.trim(),
        photo_alt: $('npPhotoAlt').value.trim(),
        active: true,
      };
      message('prodCreateStatus', 'Saving…');
      try {
        const response = await api('/api/admin/products', { method: 'POST', body: { product } });
        message('prodCreateStatus', response.warning || 'Product saved.', response.warning ? 'err' : 'ok');
        event.target.reset();
        await renderProducts();
      } catch (err) {
        message('prodCreateStatus', err.data?.error || 'Could not add the product. Check the fields and retry.', 'err');
      }
    });
  }

  function wireVariantForm() {
    $('variantForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const variant = {
        product_sku: $('nvProductSku').value.trim(),
        vsku: $('nvSku').value.trim(),
        label: $('nvLabel').value.trim(),
        gallons: $('nvGallons').value,
        stock: $('nvStock').value,
        shipping_weight_lb: $('nvShipWeight').value,
        shipping_length_in: $('nvShipLength').value,
        shipping_width_in: $('nvShipWidth').value,
        shipping_height_in: $('nvShipHeight').value,
        track_stock: $('nvStock').value !== '',
        active: true,
      };
      message('variantCreateStatus', 'Saving…');
      try {
        await api('/api/admin/products', { method: 'POST', body: { variant } });
        message('variantCreateStatus', 'Variant saved.', 'ok');
        event.target.reset();
        await renderProducts();
      } catch (err) {
        message('variantCreateStatus', err.data?.error || 'Could not add the variant. Check the fields and retry.', 'err');
      }
    });
  }

  return { renderProducts, wireProductForm, wireVariantForm, wireProducts };
}
