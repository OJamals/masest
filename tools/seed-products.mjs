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
  price: null,
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
  price: v.retail_price,
  currency: v.currency,
  active: v.active,
  sort: v.sort,
}));

const services = [...catalog.services, ...catalog.service_packages].map((s) => ({
  sku: s.sku,
  name: s.name,
  category: s.category,
  unit: s.unit,
  public_price: s.public_price,
  mode: s.mode,
  active: s.active,
  updated_at: now,
}));

const sb = createClient(url, key, { auth: { persistSession: false } });

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

const buyable = variants.filter((v) => v.active && v.price != null).length;
console.log(`Seeded ${products.length} products, ${variants.length} variants (${buyable} buyable), and ${services.length} services/packages.`);
