// Admin products tab (#36 per-tab split). Catalog product + variant CRUD, inline
// image/gallery upload, and the add-product / add-variant forms. Shared primitives
// ($, api, state, message, admSkeleton, admEmpty) are injected; esc/safeUrl/
// confirmDialog, getToken, and the dirty-edit helpers come from their own modules.
import { esc, safeUrl, confirmDialog, delegate, rowMatchesQuery } from '../util.js?v=20260730a';
import { captureDirty, restoreDirty } from './edits.js?v=20260730a';
import { PRODUCTS } from '../main/catalog-data.js?v=20260730a';
import { openImageLibraryPicker } from './image-library-picker.js?v=20260730a';

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
    const q = $('prodSearch').value.trim().toLowerCase();
    const products = state.products.filter((product) => rowMatchesQuery(product, q));
    if (!products.length) {
      box.innerHTML = admEmpty('ph-cube', 'No products', 'Add catalog products to manage them here.');
      return;
    }
    box.innerHTML = `<div class="product-admin-list">${products.map((p) => `
    <article class="product-admin-card" data-product="${esc(p.sku)}" data-capability-scope="product.write">
      <div class="product-admin-head">
        <div class="product-admin-media">
          ${productMedia(p)}
        </div>
        <div class="product-admin-title">
          <span class="product-admin-sku">${esc(p.sku)}</span>
          <h3>${esc(p.name || p.sku)}</h3>
        </div>
        <div class="product-admin-actions">
          <label class="product-active-toggle"><input type="checkbox" ${p.active !== false ? 'checked' : ''} data-field="active"> Active</label>
          <button class="btn btn-primary btn-sm" data-save-product="${esc(p.sku)}" type="button">Save</button>
          <button class="btn btn-ghost btn-sm" data-remove-product="${esc(p.sku)}" type="button">Remove</button>
        </div>
      </div>
      <div class="product-admin-fields">
        <label>Name <input class="adm-input" value="${esc(p.name)}" data-field="name"></label>
        <label>Mode <select class="adm-select" data-field="mode"><option value="buy" ${p.mode === 'buy' ? 'selected' : ''}>Buy</option><option value="quote" ${p.mode === 'quote' ? 'selected' : ''}>Quote</option></select></label>
        <label>Price <output class="adm-managed-price" aria-label="Workbook-managed product price">${p.price == null ? 'Workbook managed' : esc(`USD ${Number(p.price).toFixed(2)}`)}</output></label>
        <label>Stock <input class="adm-input" type="number" min="0" step="1" value="${esc(p.stock ?? '')}" data-field="stock"></label>
        <label>HMIS <input class="adm-input" value="${esc(p.hmis || '')}" data-field="hmis" placeholder="H-F-R e.g. 2-0-1"></label>
        <label>Group key <input class="adm-input" value="${esc(p.group_key || '')}" data-field="group_key" placeholder="groups related SKUs"></label>
        <label>Sort <input class="adm-input" type="number" step="1" value="${esc(p.sort ?? '')}" data-field="sort"></label>
        <label class="product-flag-toggle"><input type="checkbox" ${p.hazmat ? 'checked' : ''} data-field="hazmat"> Hazmat</label>
        <label class="product-flag-toggle"><input type="checkbox" ${p.taxable !== false ? 'checked' : ''} data-field="taxable"> Taxable</label>
        <label class="wide">Photo URL <input class="adm-input" value="${esc(p.image_url || '')}" data-field="image_url"></label>
        <label class="wide">Photo alt <input class="adm-input" value="${esc(p.photo_alt || '')}" data-field="photo_alt"></label>
      </div>
      <div class="product-admin-variants">
        <div class="product-admin-subhead">
          <h4>Variants</h4>
          <span>${esc((p.product_variants || []).length)} configured</span>
        </div>
        ${variantRows(p)}
      </div>
    </article>
  `).join('')}</div>`;
    restoreDirty(box, snap);
  }

  // Row + media actions delegated once on the stable #admProducts container (#36).
  function wireProducts() {
    const box = $('admProducts');
    if (!box) return;
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
        const product = (state.products || []).find((candidate) => candidate.sku === sku);
        const gallery = [...new Set([...(product?.gallery || []), details.url])];
        await api('/api/admin/product-image', {
          method: 'PATCH',
          body: { sku, action: 'reorder', gallery },
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

  function productMedia(product) {
    const primary = product.image_url
      ? `<img class="product-photo" src="${esc(safeUrl(product.image_url))}" alt="${esc(product.photo_alt || product.name || '')}" width="1200" height="1200">`
      : '<span class="product-photo product-photo-empty">No photo</span>';
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
      ${primary}
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
      <label>Label <input class="adm-input" value="${esc(v.label || '')}" data-vfield="label" aria-label="Variant label"></label>
      <label>Gallons <input class="adm-input" type="number" min="0" step="0.01" value="${esc(v.gallons ?? '')}" data-vfield="gallons" aria-label="Gallons"></label>
      <label>Price <output class="adm-managed-price" aria-label="Workbook-managed variant price">${v.price == null ? 'Workbook managed' : esc(`USD ${Number(v.price).toFixed(2)}`)}</output></label>
      <label>Stock <input class="adm-input" type="number" min="0" step="1" value="${esc(v.stock ?? '')}" data-vfield="stock" aria-label="Variant stock"></label>
      <label>Ship lb <input class="adm-input" type="number" min="0.001" step="0.001" value="${esc(v.shipping_weight_lb ?? '')}" data-vfield="shipping_weight_lb" aria-label="Shipping weight pounds"></label>
      <label>Length in <input class="adm-input" type="number" min="0.01" step="0.01" value="${esc(v.shipping_length_in ?? '')}" data-vfield="shipping_length_in" aria-label="Package length inches"></label>
      <label>Width in <input class="adm-input" type="number" min="0.01" step="0.01" value="${esc(v.shipping_width_in ?? '')}" data-vfield="shipping_width_in" aria-label="Package width inches"></label>
      <label>Height in <input class="adm-input" type="number" min="0.01" step="0.01" value="${esc(v.shipping_height_in ?? '')}" data-vfield="shipping_height_in" aria-label="Package height inches"></label>
      <label class="variant-active"><input type="checkbox" ${v.active !== false ? 'checked' : ''} data-vfield="active"> Active</label>
      <button class="btn btn-primary btn-sm" data-save-variant="${esc(v.vsku)}" type="button">Save</button>
      <button class="btn btn-ghost btn-sm" data-remove-variant="${esc(v.vsku)}" type="button">Remove</button>
      <input type="hidden" value="${esc(v.product_sku || product.sku)}" data-vfield="product_sku">
      <input type="hidden" value="${esc(v.vsku)}" data-vfield="vsku">
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
