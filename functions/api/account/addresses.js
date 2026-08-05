// /api/account/addresses - saved ship/bill addresses for the caller's company.
// GET -> list | POST { address } -> create | DELETE { id } -> remove
import { requireCompany, json, readBody } from '../../_lib/supabase.js';
import { AddressValidationError, validateGoogleAddress } from '../../_lib/address-validation.js';

const MAX = { line1: 160, line2: 160, city: 80, zip: 20 };

function cleanText(value, max) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeAddress(input) {
  const row = {
    type: input.type === 'bill' ? 'bill' : 'ship',
    line1: cleanText(input.line1, MAX.line1),
    line2: cleanText(input.line2, MAX.line2),
    city: cleanText(input.city, MAX.city),
    state: String(input.state || '').trim().toUpperCase(),
    zip: cleanText(input.zip, MAX.zip).toUpperCase(),
    country: 'US',
    is_default: input.is_default === true,
  };

  if (!row.line1 || !row.city || !row.state || !row.zip) {
    return { error: 'address_incomplete', need: ['line1', 'city', 'state', 'zip'] };
  }
  if (!/^[A-Z]{2}$/.test(row.state)) return { error: 'invalid_state' };
  if (!/^[0-9A-Z -]{3,20}$/.test(row.zip)) return { error: 'invalid_zip' };
  return { row };
}

function isMissingRpc(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /PGRST202|Could not find.*create_company_address|function.*create_company_address/i.test(text);
}

async function verifiedAddress(row, env, validateAddress) {
  const validation = await validateAddress({
    address1: row.line1,
    address2: row.line2,
    city: row.city,
    state: row.state,
    postal_code: row.zip,
    country: row.country,
  }, env);
  return {
    row: {
      ...row,
      line1: validation.address.address1,
      line2: validation.address.address2 || '',
      city: validation.address.city,
      state: validation.address.state,
      zip: validation.address.postal_code,
      country: validation.address.country,
    },
    validation: {
      corrected: validation.corrected === true,
      formatted_address: validation.formatted_address || null,
      possible_next_action: validation.possible_next_action || 'ACCEPT',
    },
  };
}

function validationError(error) {
  if (!(error instanceof AddressValidationError)) return null;
  return json(error.status, { error: error.code, ...error.details });
}

export async function handleAddresses({ request, env }, dependencies = {}) {
  const validateAddress = dependencies.validateAddress || validateGoogleAddress;
  const ctx = dependencies.requireCompany
    ? await dependencies.requireCompany(request, env)
    : await requireCompany(request, env);
  if (ctx.error) return ctx.error;
  const { companyId, sb } = ctx;

  if (request.method === 'GET') {
    const { data, error } = await sb
      .from('addresses')
      .select('id,type,line1,line2,city,state,zip,country,is_default,created_at')
      .eq('company_id', companyId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) return json(500, { error: 'server_error' });
    return json(200, { addresses: data || [] });
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    const normalized = normalizeAddress(body.address || body || {});
    if (normalized.error) return json(400, normalized);

    let verified;
    try {
      verified = await verifiedAddress(normalized.row, env, validateAddress);
    } catch (error) {
      const response = validationError(error);
      if (response) return response;
      return json(503, { error: 'address_validation_unavailable' });
    }
    const row = { company_id: companyId, ...verified.row };
    const rpc = await sb.rpc('create_company_address', {
      p_company_id: companyId,
      p_type: row.type,
      p_line1: row.line1,
      p_line2: row.line2 || null,
      p_city: row.city,
      p_state: row.state,
      p_zip: row.zip,
      p_is_default: row.is_default,
    });
    if (!rpc.error) return json(201, { ok: true, id: rpc.data, validation: verified.validation });
    if (!isMissingRpc(rpc.error)) return json(500, { error: 'server_error' });

    const { data, error } = await sb.from('addresses').insert(row).select('id').single();
    if (error) return json(500, { error: 'server_error' });

    if (row.is_default) {
      const reset = await sb.from('addresses')
        .update({ is_default: false })
        .eq('company_id', companyId)
        .eq('type', row.type)
        .neq('id', data.id);
      if (reset.error) return json(500, { error: 'server_error' });
    }

    return json(201, { ok: true, id: data.id, validation: verified.validation });
  }

  if (request.method === 'PATCH') {
    const body = await readBody(request);
    const src = body.address || body;
    const id = src.id || body.id || new URL(request.url).searchParams.get('id');
    if (!id) return json(400, { error: 'id_required' });

    // Ownership: the row must belong to the caller's company.
    const { data: existing, error: exErr } = await sb.from('addresses')
      .select('id,type').eq('id', id).eq('company_id', companyId).maybeSingle();
    if (exErr) return json(500, { error: 'server_error' });
    if (!existing) return json(404, { error: 'not_found' });

    const patch = {};
    let validation = null;
    const editsFields = ['line1', 'line2', 'city', 'state', 'zip', 'type'].some((k) => src[k] !== undefined);
    if (editsFields) {
      const normalized = normalizeAddress(src);
      if (normalized.error) return json(400, normalized);
      try {
        const verified = await verifiedAddress(normalized.row, env, validateAddress);
        Object.assign(patch, verified.row);
        validation = verified.validation;
      } catch (error) {
        const response = validationError(error);
        if (response) return response;
        return json(503, { error: 'address_validation_unavailable' });
      }
      delete patch.is_default; // default handled explicitly below
    }
    const makeDefault = src.is_default === true;
    if (makeDefault) patch.is_default = true;
    else if (src.is_default === false) patch.is_default = false;

    if (!Object.keys(patch).length) return json(400, { error: 'nothing_to_update' });

    const type = patch.type || existing.type;
    // Reset other defaults of this type FIRST, then set this row, so the row
    // staying default is never cleared (minimises any non-default window).
    if (makeDefault) {
      const reset = await sb.from('addresses')
        .update({ is_default: false })
        .eq('company_id', companyId).eq('type', type).neq('id', id);
      if (reset.error) return json(500, { error: 'server_error' });
    }
    const { error: upErr } = await sb.from('addresses')
      .update(patch).eq('id', id).eq('company_id', companyId);
    if (upErr) return json(500, { error: 'server_error' });
    return json(200, { ok: true, id, ...(validation ? { validation } : {}) });
  }

  if (request.method === 'DELETE') {
    const body = await readBody(request);
    const id = body.id || new URL(request.url).searchParams.get('id');
    if (!id) return json(400, { error: 'id_required' });
    const { error } = await sb.from('addresses').delete().eq('id', id).eq('company_id', companyId);
    if (error) return json(500, { error: 'server_error' });
    return json(200, { ok: true });
  }

  return json(405, { error: 'method_not_allowed' });
}

export function createAddressesHandler(dependencies = {}) {
  return (context) => handleAddresses(context, dependencies);
}

export async function onRequest({ request, env }) {
  const company = await requireCompany(request, env);
  if (company.error) return company.error;
  return handleAddresses({ request, env }, { requireCompany: async () => company });
}
