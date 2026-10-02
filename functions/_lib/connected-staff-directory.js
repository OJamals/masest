import { isStaffEmail, platformStaffRole, staffCanWrite } from './authz.js';
import { createClient } from '@supabase/supabase-js';

// One request-wide budget covers both profile and auth reads, including bodies.
// This client is directory-only: shared commerce/auth clients retain their policy.
export function createConnectedStaffDirectory(env, { fetchImpl = fetch, timeoutMs = 5000, signal: callerSignal } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('Invalid directory timeout');
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(callerSignal ? [callerSignal] : [])]);
  const boundedFetch = async (input, init = {}) => {
    const combined = AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]);
    try { combined.throwIfAborted(); return await fetchImpl(input, { ...init, signal: combined }); }
    catch (error) { if (combined.aborted) throw new DOMException('Staff directory request aborted', 'AbortError'); throw error; }
  };
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch },
  });
  return connectedStaffDirectory(sb, env, signal);
}

// Read-only identity adapter. No CRM rows or credentials are stored in Supabase.
export function connectedStaffDirectory(sb, env, signal) {
  const profiles = () => {
    const query = sb.from('profiles').select('id,full_name,is_staff,staff_role');
    // SDK retry sleeps must not extend the directory budget.
    return signal ? query.abortSignal(signal).retry(false) : query;
  };
  async function member(profile) {
    const { data, error } = await sb.auth.admin.getUserById(profile.id);
    if (error) throw new Error('staff_directory_unavailable');
    const user = data?.user;
    if (!user || user.id !== profile.id || user.deleted_at || (user.banned_until && Date.parse(user.banned_until) > Date.now())) return null;
    const role = isStaffEmail(user.email, env) ? 'owner' : platformStaffRole(profile);
    if (!staffCanWrite(role)) return null;
    return { staff_id: profile.id, display_name: String(profile.full_name || 'Staff member').slice(0, 200), role };
  }
  return {
    async eligible(id) {
      const { data, error } = await profiles().eq('id', id).maybeSingle();
      if (error) throw new Error('staff_directory_unavailable');
      return Boolean(data && await member(data));
    },
    async list({ limit, cursor }) {
      let query = profiles().eq('is_staff', true).order('id').limit(limit + 1);
      if (cursor) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error || !Array.isArray(data)) throw new Error('staff_directory_unavailable');
      const rows = data.slice(0, limit);
      const items = (await Promise.all(rows.map(member))).filter(Boolean);
      return { items, next_cursor: data.length > limit ? rows.at(-1).id : null };
    },
  };
}
