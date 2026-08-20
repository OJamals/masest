// POST /api/admin/company-credits — finance/owner Company account-credit adjustment.
// The append-only ledger is the audit authority; request_id makes exact retries safe.
import { adminClient, json, requireStaff } from '../../_lib/supabase.js';
import { recordAudit } from '../../_lib/audit.js';
import { staffCan } from '../../_lib/authz.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../../_lib/request-body.js';
import {
  adjustCompanyStoreCredit,
  normalizeStoreCreditAdjustment,
  normalizeStoreCreditIntentId,
} from '../../_lib/store-credit.js';

const NO_STORE = { 'cache-control': 'no-store' };
const BODY_LIMIT = 8 * 1024;

async function handleAuthorizedCompanyCredits({ request, env, user }, dependencies) {
  if (request.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' }, NO_STORE);
  }

  let body;
  try {
    body = await readBoundedJson(request, BODY_LIMIT);
  } catch (error) {
    return json(error instanceof RequestBodyTooLargeError ? 413 : 400, {
      error: error instanceof RequestBodyTooLargeError ? 'request_too_large' : 'bad_request',
    }, NO_STORE);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { error: 'bad_request' }, NO_STORE);
  }

  const companyId = normalizeStoreCreditIntentId(body.company_id);
  const requestId = normalizeStoreCreditIntentId(body.request_id);
  const adjustment = normalizeStoreCreditAdjustment(body.amount);
  const reason = String(body.reason || '').trim();
  if (!companyId || !requestId || adjustment.error
    || reason.length < 8 || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason)) {
    return json(400, { error: adjustment.error || 'invalid_store_credit_adjustment' }, NO_STORE);
  }

  const sb = dependencies.adminClient(env);
  try {
    const storeCredit = await dependencies.adjustCompanyStoreCredit(sb, {
      companyId,
      amountMinor: adjustment.value,
      reason,
      requestId,
      actorUserId: user.id,
      currency: 'usd',
    });
    if (!storeCredit.replay) {
      await dependencies.recordAudit(sb, {
        user,
        action: 'company.store_credit_adjust',
        targetType: 'company',
        targetId: companyId,
        detail: {
          amount_minor: adjustment.value,
          currency: 'usd',
          reason,
          request_id: requestId,
          replay: Boolean(storeCredit.replay),
        },
      });
    }
    return json(200, { ok: true, store_credit: storeCredit }, NO_STORE);
  } catch (error) {
    if (['store_credit_insufficient', 'store_credit_request_identity_collision'].includes(error?.code)) {
      return json(409, { error: error.code }, NO_STORE);
    }
    return json(503, { error: 'store_credit_adjustment_failed', retryable: true }, NO_STORE);
  }
}

export function createCompanyCreditsHandler(dependencies = {}) {
  const requireStaffImpl = dependencies.requireStaff || requireStaff;
  const authorizedDependencies = {
    adminClient: dependencies.adminClient || adminClient,
    adjustCompanyStoreCredit: dependencies.adjustCompanyStoreCredit || adjustCompanyStoreCredit,
    recordAudit: dependencies.recordAudit || recordAudit,
  };

  return async function companyCreditsHandler({ request, env }) {
    const { user, staff, role } = await requireStaffImpl(request, env);
    if (!user) return json(401, { error: 'unauthenticated' }, NO_STORE);
    if (!staff) return json(403, { error: 'forbidden' }, NO_STORE);
    if (!staffCan(role, 'company.credit')) return json(403, { error: 'forbidden' }, NO_STORE);
    return handleAuthorizedCompanyCredits({ request, env, user }, authorizedDependencies);
  };
}

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' }, NO_STORE);
  if (!staff) return json(403, { error: 'forbidden' }, NO_STORE);
  if (!staffCan(role, 'company.credit')) return json(403, { error: 'forbidden' }, NO_STORE);
  return handleAuthorizedCompanyCredits({ request, env, user }, {
    adminClient,
    adjustCompanyStoreCredit,
    recordAudit,
  });
}
