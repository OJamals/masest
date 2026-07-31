// Seed/refresh the MASEST catalog from data/catalog.seed.json.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const catalog = JSON.parse(await readFile(new URL('../data/catalog.seed.json', import.meta.url), 'utf8'));
const now = new Date().toISOString();

const products = catalog.products.map((p) => ({
  sku: p.slug,
  name: p.name,
  group_key: p.group_key,
  hmis: p.hmis,
  mode: p.mode,
  hazmat: p.hazmat,
  taxable: p.taxable,
  currency: 'usd',
  active: p.active,
  sort: p.sort,
  updated_at: now,
}));

const variants = catalog.product_variants.map((v) => ({
  vsku: v.sku,
  product_sku: v.product_slug,
  label: v.label,
  gallons: v.size_gal,
  currency: 'usd',
  active: v.active,
  sort: v.sort,
}));

const services = [...catalog.services, ...catalog.service_packages].map((s) => ({
  sku: s.sku,
  name: s.name,
  category: s.category,
  unit: s.unit,
  mode: s.mode,
  active: s.active,
  updated_at: now,
}));

const sb = createClient(url, key, { auth: { persistSession: false } });

const chunk = (items, size = 100) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function deleteStaleRows(table, keyColumn, keepValues) {
  const keep = new Set(keepValues.map((value) => String(value)));
  const { data, error } = await sb.from(table).select(keyColumn).limit(10000);
  if (error) {
    throw new Error(`${table} cleanup read failed: ${error.message}`);
  }
  const stale = (data || [])
    .map((row) => row[keyColumn])
    .filter((value) => value != null && !keep.has(String(value)));
  for (const group of chunk(stale)) {
    const { error: delError } = await sb.from(table).delete().in(keyColumn, group);
    if (delError) throw new Error(`${table} cleanup delete failed: ${delError.message}`);
  }
  return stale.length;
}

for (const [table, rows, onConflict] of [
  ['products', products, 'sku'],
  ['product_variants', variants, 'vsku'],
  ['services', services, 'sku'],
]) {
  const { error } = await sb.from(table).upsert(rows, { onConflict });
  if (error) {
    console.error(`Seed failed for ${table}:`, error.message);
    process.exit(1);
  }
}

let cleaned;
try {
  const currentProducts = products.map((row) => row.sku);
  const currentVariants = variants.map((row) => row.vsku);
  const currentServices = services.map((row) => row.sku);
  cleaned = {
    product_variants: await deleteStaleRows('product_variants', 'vsku', currentVariants),
    services: await deleteStaleRows('services', 'sku', currentServices),
    products: await deleteStaleRows('products', 'sku', currentProducts),
  };
} catch (error) {
  console.error('Seed cleanup failed:', error.message);
  process.exit(1);
}

const active = variants.filter((variant) => variant.active).length;
console.log(`Seeded ${products.length} products, ${variants.length} variants (${active} active), and ${services.length} services/packages without changing CMS prices.`);
console.log(`Cleaned stale rows: ${cleaned.product_variants} variants, ${cleaned.products} products, ${cleaned.services} services.`);
