// Seed/refresh the products table from data/products.seed.json.
// Modes are PROVISIONAL (from SKU_COMMERCE_WORKSHEET.md) until SDS §14 confirmed.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const COLS = ['sku', 'name', 'group_key', 'hmis', 'mode', 'hazmat', 'taxable', 'price', 'sort'];
const rows = JSON.parse(await readFile(new URL('../data/products.seed.json', import.meta.url)));
const clean = rows.map((r) => Object.fromEntries(COLS.map((c) => [c, r[c] ?? null])));

const sb = createClient(url, key, { auth: { persistSession: false } });
const { error } = await sb
  .from('products')
  .upsert(clean.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'sku' });

if (error) {
  console.error('Seed failed:', error.message);
  process.exit(1);
}
const buy = clean.filter((r) => r.mode === 'buy').length;
console.log(`Seeded ${clean.length} products (${buy} buy, ${clean.length - buy} quote). Prices null — owner supplies.`);
