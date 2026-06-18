// Admin product image upload → Supabase Storage bucket 'product-images'.
//   POST multipart { sku, file, slot='primary'|'gallery' } → uploads, sets
//        products.image_url (primary) or appends products.gallery (gallery).
//   DELETE { sku, url } → removes the object + clears it from the product row.
// Writes use the service-role key (server-only); reads are public via the bucket.
import { requireStaff, adminClient, json } from '../../_lib/supabase.js';

const BUCKET = 'product-images';
const publicUrl = (env, path) => `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);

  if (request.method === 'POST') {
    let form;
    try { form = await request.formData(); } catch { return json(400, { error: 'expected_multipart' }); }
    const sku = String(form.get('sku') || '').trim().toLowerCase();
    const slot = String(form.get('slot') || 'primary');
    const file = form.get('file');
    if (!sku) return json(400, { error: 'sku_required' });
    if (!file || typeof file === 'string') return json(400, { error: 'file_required' });
    const type = file.type || '';
    if (!type.startsWith('image/')) return json(400, { error: 'not_an_image' });

    const ext = (String(file.name || 'img').split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${sku}/${crypto.randomUUID()}.${ext}`;
    const up = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        'content-type': type,
        'x-upsert': 'true',
      },
      body: await file.arrayBuffer(),
    });
    if (!up.ok) return json(502, { error: 'upload_failed', detail: await up.text().catch(() => '') });
    const url = publicUrl(env, path);

    if (slot === 'gallery') {
      const { data: row } = await sb.from('products').select('gallery').eq('sku', sku).maybeSingle();
      const gallery = Array.isArray(row?.gallery) ? row.gallery : [];
      gallery.push(url);
      const { error } = await sb.from('products').update({ gallery }).eq('sku', sku);
      if (error) return json(500, { error: error.message });
    } else {
      const { error } = await sb.from('products').update({ image_url: url }).eq('sku', sku);
      if (error) return json(500, { error: error.message });
    }
    return json(200, { ok: true, url, slot, path });
  }

  if (request.method === 'DELETE') {
    const body = await request.json().catch(() => ({}));
    const sku = String(body.sku || '').trim().toLowerCase();
    const url = String(body.url || '');
    if (!sku || !url) return json(400, { error: 'sku_and_url_required' });

    const marker = `/object/public/${BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx !== -1) {
      const path = url.slice(idx + marker.length);
      await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
      }).catch(() => {});
    }
    const { data: row } = await sb.from('products').select('image_url,gallery').eq('sku', sku).maybeSingle();
    const patch = { gallery: Array.isArray(row?.gallery) ? row.gallery.filter((u) => u !== url) : [] };
    if (row?.image_url === url) patch.image_url = null;
    const { error } = await sb.from('products').update(patch).eq('sku', sku);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(405, { error: 'method_not_allowed' });
}
