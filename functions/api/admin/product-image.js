// Admin product image upload → Cloudflare R2 through CONTENT_IMAGES.
//   POST multipart { sku, file, slot='primary'|'gallery' } → uploads, sets
//        products.image_url (primary) or appends products.gallery (gallery).
//   PATCH { sku, action:'reorder', gallery[] } → reorder the gallery array.
//   PATCH { sku, action:'set_primary', url } → promote a gallery image to primary
//          (the old primary moves into the gallery; no duplicates).
//   DELETE { sku, url } → removes the object + clears it from the product row.
// Product metadata remains in Supabase; image bytes live behind the R2 media domain.
import { requireStaff, adminClient, json } from '../../_lib/supabase.js';
import { staffCanWrite } from '../../_lib/authz.js';
import {
  CONTENT_ASSET_PUBLIC_BASE,
  contentAssetPublicUrl,
  managedContentAssetPath,
} from '../../../js/image-url.js';
import {
  canonicalizeProductMedia,
  canonicalizeProductMediaUrl,
} from '../../_lib/product-media.js';

const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = new Map([
  ['image/avif', 'avif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const publicUrl = (env, path) => contentAssetPublicUrl(
  path,
  env.CONTENT_ASSET_PUBLIC_BASE || CONTENT_ASSET_PUBLIC_BASE,
);

function managedProductImagePath(env, sku, value) {
  const base = env.CONTENT_ASSET_PUBLIC_BASE || CONTENT_ASSET_PUBLIC_BASE;
  const path = managedContentAssetPath(value, base);
  const prefix = `products/${sku}/`;
  const filename = path.startsWith(prefix) ? path.slice(prefix.length) : '';
  return /^[a-z0-9][a-z0-9._-]{0,199}\.(?:avif|jpe?g|png|webp)$/i.test(filename) ? path : '';
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
  const sb = adminClient(env);

  if (request.method === 'POST') {
    let form;
    try { form = await request.formData(); } catch { return json(400, { error: 'expected_multipart' }); }
    const sku = String(form.get('sku') || '').trim().toLowerCase();
    const slot = String(form.get('slot') || 'primary');
    const file = form.get('file');
    if (!sku) return json(400, { error: 'sku_required' });
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(sku)) return json(400, { error: 'invalid_sku' });
    if (slot !== 'primary' && slot !== 'gallery') return json(400, { error: 'invalid_slot' });
    if (!file || typeof file === 'string') return json(400, { error: 'file_required' });
    const type = String(file.type || '').toLowerCase();
    const ext = PRODUCT_IMAGE_TYPES.get(type);
    if (!ext) return json(400, { error: 'not_an_image' });
    if (Number(file.size) <= 0) return json(400, { error: 'file_empty' });
    if (Number(file.size) > MAX_PRODUCT_IMAGE_BYTES) return json(400, { error: 'file_too_large', message: 'Keep product photos under 8 MB.' });
    if (!env.CONTENT_IMAGES || typeof env.CONTENT_IMAGES.put !== 'function') {
      return json(500, { error: 'storage_not_configured' });
    }

    const path = `products/${sku}/${crypto.randomUUID()}.${ext}`;
    const bytes = await file.arrayBuffer();
    try {
      await env.CONTENT_IMAGES.put(path, bytes, {
        httpMetadata: {
          contentType: type,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      return json(502, { error: 'upload_failed' });
    }
    const url = publicUrl(env, path);
    if (!url) {
      await env.CONTENT_IMAGES.delete(path).catch(() => {});
      return json(500, { error: 'storage_not_configured' });
    }

    if (slot === 'gallery') {
      const { data: row } = await sb.from('products').select('gallery').eq('sku', sku).maybeSingle();
      const gallery = canonicalizeProductMedia(row).gallery;
      gallery.push(url);
      const { error } = await sb.from('products').update({ gallery }).eq('sku', sku);
      if (error) {
        await env.CONTENT_IMAGES.delete(path).catch(() => {});
        return json(500, { error: error.message });
      }
    } else {
      const { error } = await sb.from('products').update({ image_url: url }).eq('sku', sku);
      if (error) {
        await env.CONTENT_IMAGES.delete(path).catch(() => {});
        return json(500, { error: error.message });
      }
    }
    return json(200, { ok: true, url, slot, path });
  }

  if (request.method === 'DELETE') {
    const body = await request.json().catch(() => ({}));
    const sku = String(body.sku || '').trim().toLowerCase();
    const url = canonicalizeProductMediaUrl(body.url);
    if (!sku || !url) return json(400, { error: 'sku_and_url_required' });
    const { data: row } = await sb.from('products').select('image_url,gallery').eq('sku', sku).maybeSingle();
    const current = canonicalizeProductMedia(row);
    const patch = { gallery: current.gallery.filter((candidate) => candidate !== url) };
    if (current.image_url === url) patch.image_url = null;
    const { error } = await sb.from('products').update(patch).eq('sku', sku);
    if (error) return json(500, { error: error.message });
    const path = managedProductImagePath(env, sku, url);
    if (path) {
      if (!env.CONTENT_IMAGES || typeof env.CONTENT_IMAGES.delete !== 'function') {
        return json(500, { error: 'storage_not_configured' });
      }
      try {
        await env.CONTENT_IMAGES.delete(path);
      } catch {
        return json(502, { error: 'storage_delete_failed' });
      }
    }
    return json(200, { ok: true });
  }

  if (request.method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    const sku = String(body.sku || '').trim().toLowerCase();
    if (!sku) return json(400, { error: 'sku_required' });
    const { data: row, error: rErr } = await sb.from('products').select('image_url,gallery').eq('sku', sku).maybeSingle();
    if (rErr) return json(500, { error: rErr.message });
    if (!row) return json(404, { error: 'not_found' });
    const currentMedia = canonicalizeProductMedia(row);
    const current = currentMedia.gallery;

    if (body.action === 'add_gallery') {
      const url = canonicalizeProductMediaUrl(body.url);
      if (!url) return json(400, { error: 'url_required' });
      const gallery = currentMedia.image_url === url || current.includes(url)
        ? current
        : [...current, url];
      const { error } = await sb.from('products').update({ gallery }).eq('sku', sku);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, gallery });
    }

    if (body.action === 'reorder') {
      const next = Array.isArray(body.gallery)
        ? [...new Set(body.gallery.map(canonicalizeProductMediaUrl).filter(Boolean))]
        : [];
      const sameSet = next.length === current.length && next.every((u) => current.includes(u));
      if (!sameSet) return json(400, { error: 'gallery_mismatch' });
      const { error } = await sb.from('products').update({ gallery: next }).eq('sku', sku);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, gallery: next });
    }

    if (body.action === 'set_primary') {
      const url = canonicalizeProductMediaUrl(body.url);
      if (!url) return json(400, { error: 'url_required' });
      let gallery = current.filter((u) => u !== url);
      if (currentMedia.image_url && currentMedia.image_url !== url) gallery = [currentMedia.image_url, ...gallery];
      const { error } = await sb.from('products').update({ image_url: url, gallery }).eq('sku', sku);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, image_url: url, gallery });
    }

    return json(400, { error: 'invalid_action' });
  }

  return json(405, { error: 'method_not_allowed' });
}
