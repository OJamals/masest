// /api/admin/inventory — bulk stock import + low-stock reorder view (#98). Staff-only.
//   GET ?view=low[&export=csv] → variants at/below their reorder_point
//   POST { csv: "vsku,stock\n…" }  → bulk-set stock (absolute), returns per-row outcome
import { adminClient, requireStaff, json, readBody } from '../../_lib/supabase.js';
import { staffCanWrite } from '../../_lib/authz.js';
import { recordAudit } from '../../_lib/audit.js';
import { parseInventoryRows } from '../../_lib/inventory.js';
import { csvResponse } from '../../_lib/reports.js';

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });

  const sb = adminClient(env);

  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    // Low-stock: tracked variants whose stock has fallen to/below their reorder point.
    const { data, error } = await sb.from('product_variants')
      .select('vsku,label,stock,reorder_point,track_stock,active,products(name)')
      .eq('track_stock', true).order('stock', { ascending: true });
    if (error) return json(500, { error: error.message });
    const low = (data || []).filter((v) => v.stock != null && Number(v.stock) <= Number(v.reorder_point ?? 10));

    if (params.get('export') === 'csv') {
      const rows = [['SKU', 'Product', 'Variant', 'Stock', 'Reorder point', 'Active']];
      for (const v of low) rows.push([v.vsku, v.products?.name || '', v.label, v.stock, v.reorder_point ?? 10, v.active === false ? 'no' : 'yes']);
      return csvResponse(rows, 'masest-low-stock');
    }
    return json(200, { low_stock: low });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    const { rows, errors } = parseInventoryRows(body.csv);
    if (!rows.length) return json(400, { error: 'no_valid_rows', errors });

    const updated = [];
    const failed = [...errors];
    for (const row of rows) {
      // Absolute set (predictable for a spreadsheet import); enabling tracking implicitly.
      const { data, error } = await sb.from('product_variants')
        .update({ stock: row.stock, track_stock: true }).eq('vsku', row.vsku).select('vsku');
      if (error) failed.push({ vsku: row.vsku, reason: 'update_failed' });
      else if (!data?.length) failed.push({ vsku: row.vsku, reason: 'not_found' });
      else updated.push(row.vsku);
    }
    await recordAudit(sb, { user, action: 'inventory.bulk_set', targetType: 'inventory', targetId: null, detail: { updated: updated.length, failed: failed.length } });
    return json(200, { updated, failed });
  }

  return json(405, { error: 'method_not_allowed' });
}
