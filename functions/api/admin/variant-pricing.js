// Unified CMS pricing workspace.
// Existing commerce/content tables remain canonical; this route is their one
// staff-facing write boundary.
import { requireStaff, adminClient, json, readBody } from '../../_lib/supabase.js';
import { staffCan, staffCanWrite } from '../../_lib/authz.js';
import { createContentRepository } from '../../_lib/content.js';
import { normalizePricingUpdate } from '../../_lib/pricing.js';

const TIERS = ['retail', 'hvac', 'wholesale'];

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);

  if (request.method === 'GET') {
    const { data: variants, error } = await sb
      .from('product_variants')
      .select('vsku,product_sku,label,price,currency,active,sort,products(name,mode)')
      .order('product_sku', { ascending: true })
      .order('sort', { ascending: true });
    if (error) return json(500, { error: error.message });
    const [cellsResult, servicesResult, programsResult] = await Promise.all([
      sb.from('price_tiers').select('vsku,tier,price'),
      sb
        .from('services')
        .select('sku,name,category,unit,public_price,mode,active')
        .order('sku', { ascending: true }),
      sb
        .from('content_entries')
        .select('slug,title,payload,status,version')
        .eq('type', 'pricing_tier')
        .eq('status', 'published'),
    ]);
    const readError = cellsResult.error || servicesResult.error || programsResult.error;
    if (readError) return json(500, { error: readError.message });

    const byVsku = {};
    for (const c of cellsResult.data || []) { (byVsku[c.vsku] ||= {})[c.tier] = Number(c.price); }
    const rows = (variants || []).map((v) => ({
      vsku: v.vsku,
      product_sku: v.product_sku,
      product_name: v.products?.name || v.product_sku,
      mode: v.products?.mode || 'quote',
      label: v.label,
      base_price: v.price == null ? null : Number(v.price),
      currency: v.currency || 'usd',
      active: v.active,
      tiers: TIERS.reduce((o, t) => { o[t] = byVsku[v.vsku]?.[t] ?? null; return o; }, {}),
    }));
    const services = (servicesResult.data || []).map((service) => ({
      ...service,
      public_price: service.public_price == null ? null : Number(service.public_price),
    }));
    const programs = (programsResult.data || []).map((program) => ({
      slug: program.slug,
      title: program.title,
      status: program.status,
      version: Number(program.version || 0),
      price: program.payload?.price || '',
      annual: program.payload?.annual || '',
    }));
    return json(200, { tiers: TIERS, rows, services, programs });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    if (!staffCan(role, 'product.write')) {
      return json(403, { error: 'forbidden', message: 'Editing pricing requires owner access.' });
    }

    let update;
    try {
      update = normalizePricingUpdate(await readBody(request));
    } catch (error) {
      return json(400, { error: error.message || 'invalid_pricing_update' });
    }

    if (update.resource === 'variant') {
      const { error } = await sb.rpc('set_variant_pricing', {
        p_vsku: update.vsku,
        p_tiers: update.tiers,
      });
      if (error?.code === 'P0002') return json(404, { error: 'variant_not_found' });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true, resource: update.resource, vsku: update.vsku });
    }

    if (update.resource === 'service') {
      const { data, error } = await sb
        .from('services')
        .update({ public_price: update.public_price })
        .eq('sku', update.sku)
        .select('sku')
        .maybeSingle();
      if (error) return json(500, { error: error.message });
      if (!data) return json(404, { error: 'service_not_found' });
      return json(200, { ok: true, resource: update.resource, sku: update.sku });
    }

    const repository = createContentRepository(sb);
    const current = await repository.get({ type: 'pricing_tier', slug: update.slug });
    if (!current) return json(404, { error: 'program_not_found' });
    const saved = await repository.saveEntry(
      {
        ...current,
        payload: {
          ...(current.payload || {}),
          price: update.price,
          annual: update.annual,
        },
      },
      user.id,
      'Pricing updated from unified Pricing workspace',
      { expectedVersion: update.expected_version ?? current.version },
    );
    if (!saved.ok) return json(409, saved);
    return json(200, {
      ok: true,
      resource: update.resource,
      slug: update.slug,
      version: Number(saved.entry.version || 0),
    });
  }

  return json(405, { error: 'method_not_allowed' });
}
