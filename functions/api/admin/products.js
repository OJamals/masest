// /api/admin/products - staff catalog, stock, media, and variant management.
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';

const BASE_COLUMNS = [
  'sku',
  'name',
  'group_key',
  'hmis',
  'mode',
  'hazmat',
  'taxable',
  'price',
  'currency',
  'stock',
  'track_stock',
  'stripe_price_id',
  'active',
  'sort',
];
const MEDIA_COLUMNS = ['image_url', 'photo_alt'];
const VARIANT_SELECT = 'product_variants(id,vsku,product_sku,label,gallons,price,currency,stripe_price_id,stock,track_stock,active,sort)';
const PRODUCT_WRITABLE = [
  'name',
  'mode',
  'price',
  'currency',
  'hazmat',
  'taxable',
  'active',
  'sort',
  'group_key',
  'hmis',
  'stripe_price_id',
  'stock',
  'track_stock',
  'image_url',
  'photo_alt',
];
const VARIANT_WRITABLE = [
  'product_sku',
  'label',
  'gallons',
  'price',
  'currency',
  'stripe_price_id',
  'stock',
  'track_stock',
  'active',
  'sort',
];

function missingMediaColumn(error) {
  return /image_url|photo_alt|schema cache|column/i.test(error?.message || '');
}

async function selectProducts(sb) {
  const withMedia = [...BASE_COLUMNS, ...MEDIA_COLUMNS, VARIANT_SELECT].join(',');
  const base = [...BASE_COLUMNS, VARIANT_SELECT].join(',');
  const query = (columns) => sb.from('products').select(columns).order('sort', { ascending: true });

  let { data, error } = await query(withMedia);
  if (error && missingMediaColumn(error)) {
    ({ data, error } = await query(base));
    if (!error) {
      return {
        products: (data || []).map((product) => ({ ...product, image_url: null, photo_alt: null })),
        mediaReady: false,
      };
    }
  }
  if (error) throw error;
  return { products: data || [], mediaReady: true };
}

function nullableString(value) {
  if (value == null) return value;
  return String(value).trim() || null;
}

export function normalizeProduct(input) {
  const p = input?.product || input || {};
  const sku = String(p.sku || '').trim().toLowerCase();
  if (!sku) return { error: 'sku_required' };

  const row = { sku };
  for (const key of PRODUCT_WRITABLE) {
    if (p[key] !== undefined) row[key] = p[key];
  }

  if (row.mode && !['buy', 'quote'].includes(row.mode)) return { error: 'invalid_mode' };

  if (row.price != null && row.price !== '') {
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) return { error: 'invalid_price' };
    row.price = price;
  } else if (row.price === '') {
    row.price = null;
  }

  if (row.stock !== undefined && row.stock !== null && row.stock !== '') {
    const stock = Number(row.stock);
    if (!Number.isInteger(stock) || stock < 0) return { error: 'invalid_stock' };
    row.stock = stock;
  } else if (row.stock === '') {
    row.stock = null;
  }

  for (const key of ['image_url', 'photo_alt']) row[key] = nullableString(row[key]);
  return { row };
}

export function normalizeVariant(input) {
  const v = input?.variant || input || {};
  const vsku = String(v.vsku || '').trim();
  if (!vsku) return { error: 'vsku_required' };

  const row = { vsku };
  for (const key of VARIANT_WRITABLE) {
    if (v[key] !== undefined) row[key] = v[key];
  }

  if (row.product_sku !== undefined) row.product_sku = String(row.product_sku).trim().toLowerCase();
  if (!row.product_sku) return { error: 'product_sku_required' };
  if (row.label !== undefined) row.label = String(row.label).trim();
  if (!row.label) return { error: 'label_required' };

  if (row.gallons !== undefined && row.gallons !== '') {
    const gallons = Number(row.gallons);
    if (!Number.isFinite(gallons) || gallons < 0) return { error: 'invalid_gallons' };
    row.gallons = gallons;
  } else {
    row.gallons = 0;
  }

  if (row.price !== undefined && row.price !== '') {
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) return { error: 'invalid_price' };
    row.price = price;
  } else if (row.price === '') {
    row.price = null;
  }

  if (row.stock !== undefined && row.stock !== null && row.stock !== '') {
    const stock = Number(row.stock);
    if (!Number.isInteger(stock) || stock < 0) return { error: 'invalid_stock' };
    row.stock = stock;
  } else if (row.stock === '') {
    row.stock = null;
  }

  row.currency = String(row.currency || 'usd').toLowerCase();
  row.track_stock = row.track_stock === true || row.stock != null;
  if (row.active === undefined) row.active = true;
  return { row };
}

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    try {
      const { products, mediaReady } = await selectProducts(sb);
      return json(200, { products, media_ready: mediaReady });
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    if (body.variant) {
      const normalized = normalizeVariant(body);
      if (normalized.error) return json(400, { error: normalized.error });
      const { error } = await sb.from('product_variants').upsert(normalized.row, { onConflict: 'vsku' });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, vsku: normalized.row.vsku });
    }

    const normalized = normalizeProduct(body);
    if (normalized.error) return json(400, { error: normalized.error });

    let { error } = await sb.from('products').upsert(normalized.row, { onConflict: 'sku' });
    if (error && missingMediaColumn(error)) {
      const fallback = { ...normalized.row };
      delete fallback.image_url;
      delete fallback.photo_alt;
      ({ error } = await sb.from('products').upsert(fallback, { onConflict: 'sku' }));
      if (!error) {
        return json(200, {
          ok: true,
          sku: fallback.sku,
          media_ready: false,
          warning: 'Apply site/supabase/schema-phase5.sql to enable product photos.',
        });
      }
    }
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, sku: normalized.row.sku, media_ready: true });
  }

  if (request.method === 'DELETE') {
    const body = await readBody(request);
    if (body.vsku) {
      const vsku = String(body.vsku).trim();
      const query = sb.from('product_variants');
      const { error } = body.hard
        ? await query.delete().eq('vsku', vsku)
        : await query.update({ active: false }).eq('vsku', vsku);
      if (error) return json(body.hard ? 409 : 500, { error: error.message });
      return json(200, { ok: true, deactivated: body.hard ? undefined : vsku, deleted: body.hard ? vsku : undefined });
    }

    const sku = String(body.sku || new URL(request.url).searchParams.get('sku') || '').trim().toLowerCase();
    if (!sku) return json(400, { error: 'sku_required' });
    if (body.hard) {
      const { error } = await sb.from('products').delete().eq('sku', sku);
      if (error) {
        return json(409, {
          error: 'delete_blocked',
          detail: error.message,
          hint: 'Referenced by orders - deactivate instead.',
        });
      }
      return json(200, { ok: true, deleted: sku });
    }

    const { error } = await sb.from('products').update({ active: false }).eq('sku', sku);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, deactivated: sku });
  }

  return json(405, { error: 'method_not_allowed' });
}
