import { qboConfigEnv } from './qbo-config.js';
import { intuitTidFromHeaders, intuitTidSuffix } from './intuit.js';

const OAUTH_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function qboOptions(options = {}) {
  return typeof options === 'function' ? { fetchImpl: options } : { ...(options || {}) };
}

function recordIntuitTid(options, response, operation) {
  const intuitTid = intuitTidFromHeaders(response?.headers);
  if (!intuitTid) return '';
  const entry = { operation, intuit_tid: intuitTid };
  if (Array.isArray(options?.intuitTids)) options.intuitTids.push(entry);
  if (typeof options?.onIntuitTid === 'function') options.onIntuitTid(entry);
  return intuitTid;
}

function lastIntuitTid(intuitTids, operation) {
  for (let i = intuitTids.length - 1; i >= 0; i--) {
    if (intuitTids[i]?.operation === operation && intuitTids[i]?.intuit_tid) return intuitTids[i].intuit_tid;
  }
  return '';
}

function withIntuitTidResult(result, intuitTids, entity) {
  if (!intuitTids.length) return result;
  const out = {
    ...result,
    intuitTid: lastIntuitTid(intuitTids, `create:${entity}`) || lastIntuitTid(intuitTids, `query:${entity}`),
    intuitTids: intuitTids.slice(),
  };
  if (entity === 'Invoice') {
    out.paymentIntuitTid = lastIntuitTid(intuitTids, 'create:Payment') || lastIntuitTid(intuitTids, 'query:Payment');
  }
  return out;
}

export function qboBaseUrl(env = {}) {
  const qboEnv = qboConfigEnv(env);
  return String(qboEnv.QBO_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function basicAuth(clientId, clientSecret) {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

export function needsRefresh(tokenRow, nowMs = Date.now()) {
  if (!tokenRow?.access_token || !tokenRow?.access_expires_at) return true;
  const expiresAt = Date.parse(tokenRow.access_expires_at);
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - nowMs <= TOKEN_REFRESH_SKEW_MS;
}

export function backoffMs(attempts) {
  return Math.min((2 ** Math.max(0, Number(attempts) || 0)) * 60_000, BACKOFF_CAP_MS);
}

export function nextSyncState(attempts, nowMs = Date.now()) {
  const next = (Number(attempts) || 0) + 1;
  if (next >= MAX_ATTEMPTS) {
    return { qbo_sync_status: 'error', qbo_attempts: next, qbo_next_attempt_at: null };
  }
  return {
    qbo_sync_status: 'pending',
    qbo_attempts: next,
    qbo_next_attempt_at: new Date(nowMs + backoffMs(next)).toISOString(),
  };
}

export function docNumber(orderId) {
  return String(orderId || '').replaceAll('-', '').slice(0, 21);
}

function lineFor(item, itemRefs, taxExempt = false) {
  const itemRef = itemRefs?.[item.sku];
  if (!itemRef) throw new Error(`qbo_item_ref_missing:${item.sku}`);
  return {
    DetailType: 'SalesItemLineDetail',
    Amount: Number(item.line_total || 0),
    Description: item.name || item.sku,
    SalesItemLineDetail: {
      ItemRef: { value: itemRef },
      Qty: Number(item.qty || 0),
      UnitPrice: Number(item.unit_price || 0),
      // #27: tax-exempt buyer → force non-taxable. Only added when exempt so
      // non-exempt invoices keep their existing (QBO-default) tax behavior.
      ...(taxExempt ? { TaxCodeRef: { value: 'NON' } } : {}),
    },
  };
}

export function qboItemsWithShipping(items, order) {
  const shipping = Number(order?.shipping || 0);
  if (!Number.isFinite(shipping) || shipping <= 0) return items;
  return [...(items || []), {
    sku: 'MASEST-SHIPPING',
    name: 'Shipping',
    qty: 1,
    unit_price: shipping,
    line_total: shipping,
  }];
}

function documentLines({ order, items, itemRefs, taxExempt = false }) {
  const lines = (items || []).map((item) => lineFor(item, itemRefs, taxExempt));
  const total = Number(order?.total);
  if (!Number.isFinite(total)) return lines;
  const tax = Number(order?.tax || 0);
  const merchandiseTotal = lines.reduce((sum, line) => sum + Number(line.Amount || 0), 0);
  const discount = Math.round(Math.max(0, merchandiseTotal + tax - total) * 100) / 100;
  if (!discount) return lines;
  return [...lines, {
    DetailType: 'DiscountLineDetail',
    Amount: discount,
    Description: 'Order discount',
    DiscountLineDetail: { PercentBased: false },
  }];
}

function billEmailFor(order) {
  const email = String(order?.customer_email || '').trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { Address: email } : null;
}

function cleanText(value, max = 100) {
  return String(value || '').trim().slice(0, max);
}

export function qboCustomerPayload({ key, displayName, email, phone, billingAddress, stripeCustomerId } = {}) {
  const name = cleanText(displayName || key || 'MASEST Customer');
  const validEmail = billEmailFor({ customer_email: email });
  const phoneValue = cleanText(phone, 30);
  const address = billingAddress || {};
  const billAddr = {
    ...(cleanText(address.line1) ? { Line1: cleanText(address.line1) } : {}),
    ...(cleanText(address.line2) ? { Line2: cleanText(address.line2) } : {}),
    ...(cleanText(address.city) ? { City: cleanText(address.city) } : {}),
    ...(cleanText(address.state, 20) ? { CountrySubDivisionCode: cleanText(address.state, 20) } : {}),
    ...(cleanText(address.zip, 30) ? { PostalCode: cleanText(address.zip, 30) } : {}),
    ...(cleanText(address.country, 3) ? { Country: cleanText(address.country, 3) } : {}),
  };
  const companyId = String(key || '').startsWith('company:') ? String(key).slice(8) : '';
  const notes = [
    companyId ? `MASEST company ${companyId}` : '',
    stripeCustomerId ? `Stripe customer ${cleanText(stripeCustomerId, 80)}` : '',
  ].filter(Boolean).join('; ');
  return {
    DisplayName: name,
    ...(companyId ? { CompanyName: name } : {}),
    ...(validEmail ? { PrimaryEmailAddr: validEmail } : {}),
    ...(phoneValue ? { PrimaryPhone: { FreeFormNumber: phoneValue } } : {}),
    ...(Object.keys(billAddr).length ? { BillAddr: billAddr } : {}),
    ...(notes ? { Notes: notes } : {}),
  };
}

function baseDocumentPayload({ order, items, customerRef, itemRefs, taxExempt = false }) {
  const billEmail = billEmailFor(order);
  const privateNote = [
    order.qbo_private_note || `MASEST order ${order.id}`,
    order.purchase_order_number ? `Customer PO ${cleanText(order.purchase_order_number, 64)}` : '',
  ].filter(Boolean).join('; ');
  return {
    CustomerRef: { value: customerRef },
    DocNumber: docNumber(order.id),
    PrivateNote: privateNote,
    Line: documentLines({ order, items, itemRefs, taxExempt }),
    TxnTaxDetail: { TotalTax: Number(order.tax || 0) },
    ...(billEmail ? { BillEmail: billEmail } : {}),
  };
}

// QBO item type for a synced line. Tangible goods must NOT be 'Service' (#41) —
// that produces wrong COGS/inventory. Default tangible → 'NonInventory' (same
// account refs as Service, no asset-account/QtyOnHand requirements); explicit
// service lines (type:'service' or product mode 'quote') stay 'Service'.
export function qboItemType(item = {}) {
  if (item.type === 'service' || item.mode === 'quote') return 'Service';
  return 'NonInventory';
}

export function buildInvoicePayload(input) {
  return {
    ...baseDocumentPayload(input),
    Balance: Number(input.order?.total || 0),
    AllowOnlinePayment: true,
    AllowOnlineCreditCardPayment: true,
    AllowOnlineACHPayment: true,
  };
}

export function buildInvoicePaymentPayload({ order, customerRef, invoiceId }) {
  const total = Number(order?.total || 0);
  return {
    CustomerRef: { value: customerRef },
    TotalAmt: total,
    PaymentRefNum: docNumber(order?.stripe_payment_intent || order?.id),
    PrivateNote: order?.qbo_payment_note || `Stripe payment for MASEST order ${order?.id}`,
    Line: [
      {
        Amount: total,
        LinkedTxn: [
          {
            TxnId: invoiceId,
            TxnType: 'Invoice',
          },
        ],
      },
    ],
  };
}

// #22 — reversing CreditMemo for a refund. A full refund reverses the exact invoice
// lines; a partial refund can't be mapped to specific lines, so it posts one line for
// the refunded dollar amount against the first item's ref (the credit-memo TOTAL is
// what reconciles against AR — line attribution on partials is approximate and the
// owner can recategorize in QBO).
// ponytail: single-line partial credit memo; only full refunds reverse exact lines.
export function buildCreditMemoPayload({ order, items = [], customerRef, itemRefs, taxExempt = false, amount, fullyRefunded = false }) {
  let lines;
  if (fullyRefunded) {
    lines = documentLines({ order, items, itemRefs, taxExempt });
  } else {
    const refundAmount = Number(amount || 0);
    const first = items[0];
    const ref = first ? itemRefs?.[first.sku] : null;
    if (!ref) throw new Error('qbo_credit_memo_item_ref_missing');
    lines = [{
      DetailType: 'SalesItemLineDetail',
      Amount: refundAmount,
      Description: `Partial refund for order ${order.id}`,
      SalesItemLineDetail: {
        ItemRef: { value: ref },
        Qty: 1,
        UnitPrice: refundAmount,
        ...(taxExempt ? { TaxCodeRef: { value: 'NON' } } : {}),
      },
    }];
  }
  const billEmail = billEmailFor(order);
  return {
    CustomerRef: { value: customerRef },
    PrivateNote: `MASEST refund for order ${order.id}`,
    Line: lines,
    // Only a full reversal carries the original tax; a partial dollar refund is posted untaxed.
    ...(fullyRefunded ? { TxnTaxDetail: { TotalTax: Number(order.tax || 0) } } : {}),
    ...(billEmail ? { BillEmail: billEmail } : {}),
  };
}

const GENERIC_CUSTOMER_NAME = 'Online Sales (MASEST)';

// ADR (#41): paid orders post an Invoice + a Payment, NOT a SalesReceipt. SalesReceipt
// would be the textbook doc for an immediately-paid sale, but Invoice+Payment keeps a
// single, uniform document model across NET and card orders and an explicit AR→payment
// trail for reconciliation. Switching to SalesReceipt is an accounting-policy change for
// the owner to make once QBO is connected; until then this function never emits one.
export function documentPlanFor(order, companyNames = {}) {
  const companyId = order?.company_id || null;
  if (order?.payment_method === 'net') {
    return {
      docType: 'invoice',
      entity: 'Invoice',
      customer: companyId
        ? { key: `company:${companyId}`, displayName: companyNames[companyId] || `Company ${companyId}` }
        : { key: 'generic', displayName: GENERIC_CUSTOMER_NAME },
    };
  }

  if (companyId) {
    return {
      docType: 'invoice_payment',
      entity: 'Invoice',
      customer: { key: `company:${companyId}`, displayName: companyNames[companyId] || `Company ${companyId}` },
    };
  }

  return {
    docType: 'invoice_payment',
    entity: 'Invoice',
    customer: { key: 'generic', displayName: GENERIC_CUSTOMER_NAME },
  };
}

export function subscriptionOrderForQbo(row = {}) {
  return {
    id: row.stripe_invoice_id,
    company_id: row.company_id || null,
    customer_email: row.customer_email || null,
    payment_method: 'stripe',
    stripe_payment_intent: row.stripe_payment_intent || row.stripe_invoice_id,
    subtotal: Number(row.subtotal || 0),
    tax: Number(row.tax || 0),
    total: Number(row.total || 0),
    currency: row.currency || 'usd',
    qbo_private_note: `Stripe subscription invoice ${row.stripe_invoice_id} (${row.stripe_subscription_id || 'subscription'})`,
    qbo_payment_note: `Stripe payment for subscription invoice ${row.stripe_invoice_id}`,
  };
}

export function subscriptionItemsForQbo(row = {}) {
  const tier = cleanText(row.tier || 'business', 50);
  const amount = Number(row.subtotal || 0);
  return [{
    sku: `program:${tier.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: cleanText(row.description || `VertKleen ${tier} program`),
    type: 'service',
    qty: 1,
    unit_price: amount,
    line_total: amount,
  }];
}

export async function syncSubscriptionInvoice(sb, env, accessToken, realmId, row, companyNames = {}, options = {}) {
  return syncOrder(
    sb,
    env,
    accessToken,
    realmId,
    subscriptionOrderForQbo(row),
    subscriptionItemsForQbo(row),
    companyNames,
    options,
  );
}

export async function syncOrder(sb, env, accessToken, realmId, order, items = [], companyNames = {}, options = {}) {
  const intuitTids = Array.isArray(options.intuitTids) ? options.intuitTids : [];
  const fetchImpl = options.fetchImpl || fetch;
  const qboContext = { ...options, fetchImpl, intuitTids };
  const plan = documentPlanFor(order, companyNames);
  const customerRef = await findOrCreateCustomer(sb, env, accessToken, realmId, plan.customer, qboContext);
  const itemRefs = {};

  for (const item of items || []) {
    if (!itemRefs[item.sku]) {
      itemRefs[item.sku] = await findOrCreateItem(sb, env, accessToken, realmId, {
        sku: item.sku,
        name: item.name || item.sku,
        type: item.type,
        mode: item.mode,
      }, qboContext);
    }
  }

  // documentPlanFor only ever yields 'invoice' / 'invoice_payment' (see ADR note there),
  // so every document is an Invoice (a Payment is added below for paid orders).
  const payloadInput = { order, items, customerRef, itemRefs, taxExempt: Boolean(options.taxExempt) };
  const payload = buildInvoicePayload(payloadInput);
  let docId = null;
  if (plan.entity === 'Invoice') {
    docId = await findTransactionByField(env, accessToken, realmId, 'Invoice', 'DocNumber', payload.DocNumber, qboContext);
  }
  if (!docId) {
    const created = await qboCreate(env, accessToken, realmId, plan.entity, payload, qboContext);
    docId = created?.[plan.entity]?.Id;
  }
  if (!docId) throw new Error(`qbo_${plan.entity.toLowerCase()}_id_missing`);

  if (plan.docType === 'invoice_payment') {
    const paymentPayload = buildInvoicePaymentPayload({ order, customerRef, invoiceId: docId });
    let paymentId = await findTransactionByField(env, accessToken, realmId, 'Payment', 'PaymentRefNum', paymentPayload.PaymentRefNum, qboContext);
    if (!paymentId) {
      const payment = await qboCreate(env, accessToken, realmId, 'Payment', paymentPayload, qboContext);
      paymentId = payment?.Payment?.Id;
    }
    if (!paymentId) throw new Error('qbo_payment_id_missing');
    return withIntuitTidResult({ docId, docType: plan.docType, paymentId }, intuitTids, 'Invoice');
  }

  return withIntuitTidResult({ docId, docType: plan.docType }, intuitTids, 'Invoice');
}

// #22 — post a reversing CreditMemo for one refund. Idempotent on the refund id
// (DocNumber): a retried sync reuses the existing CreditMemo instead of double-crediting.
export async function syncRefund(sb, env, accessToken, realmId, refund, order, items = [], companyNames = {}, options = {}) {
  const intuitTids = Array.isArray(options.intuitTids) ? options.intuitTids : [];
  const fetchImpl = options.fetchImpl || fetch;
  const qboContext = { ...options, fetchImpl, intuitTids };
  const plan = documentPlanFor(order, companyNames);
  const customerRef = await findOrCreateCustomer(sb, env, accessToken, realmId, plan.customer, qboContext);
  const itemRefs = {};
  for (const item of items || []) {
    if (!itemRefs[item.sku]) {
      itemRefs[item.sku] = await findOrCreateItem(sb, env, accessToken, realmId, {
        sku: item.sku,
        name: item.name || item.sku,
        type: item.type,
        mode: item.mode,
      }, qboContext);
    }
  }
  const docNum = docNumber(refund.id);
  const payload = {
    ...buildCreditMemoPayload({
      order, items, customerRef, itemRefs,
      taxExempt: Boolean(options.taxExempt),
      amount: refund.amount,
      fullyRefunded: refund.fully_refunded,
    }),
    DocNumber: docNum,
  };
  let docId = await findTransactionByField(env, accessToken, realmId, 'CreditMemo', 'DocNumber', docNum, qboContext);
  if (!docId) {
    const created = await qboCreate(env, accessToken, realmId, 'CreditMemo', payload, qboContext);
    docId = created?.CreditMemo?.Id;
  }
  if (!docId) throw new Error('qbo_credit_memo_id_missing');
  return withIntuitTidResult({ creditMemoId: docId }, intuitTids, 'CreditMemo');
}

function qboHeaders(accessToken) {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
    'content-type': 'application/json',
  };
}

function qboString(value) {
  return String(value || '').replaceAll("'", "\\'");
}

async function qboQuery(env, accessToken, realmId, query, options = {}) {
  const opts = qboOptions(options);
  const fetchImpl = opts.fetchImpl || fetch;
  const url = `${qboBaseUrl(env)}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`;
  const response = await fetchImpl(url, { headers: qboHeaders(accessToken) });
  const intuitTid = recordIntuitTid(opts, response, opts.operation || 'query');
  if (!response.ok) throw new Error(`qbo_query_failed:${response.status}${intuitTidSuffix(intuitTid)}`);
  return response.json();
}

async function findTransactionByField(env, accessToken, realmId, entity, field, value, options = {}) {
  if (!value) return null;
  const safeValue = qboString(value);
  const found = await qboQuery(
    env,
    accessToken,
    realmId,
    `select Id from ${entity} where ${field} = '${safeValue}' maxresults 1`,
    { ...qboOptions(options), operation: `query:${entity}` },
  );
  return found.QueryResponse?.[entity]?.[0]?.Id || null;
}

async function qboCreate(env, accessToken, realmId, entity, body, options = {}) {
  const opts = qboOptions(options);
  const fetchImpl = opts.fetchImpl || fetch;
  const url = `${qboBaseUrl(env)}/v3/company/${realmId}/${entity.toLowerCase()}?minorversion=70`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: qboHeaders(accessToken),
    body: JSON.stringify(body),
  });
  const intuitTid = recordIntuitTid({ ...opts, operation: `create:${entity}` }, response, `create:${entity}`);
  if (!response.ok) throw new Error(`qbo_create_${entity.toLowerCase()}_failed:${response.status}${intuitTidSuffix(intuitTid)}`);
  return response.json();
}

async function resolveIncomeAccountRef(env, accessToken, realmId, options = {}) {
  const opts = qboOptions(options);
  const qboEnv = qboConfigEnv(env);
  if (qboEnv.QBO_INCOME_ACCOUNT_ID) return qboEnv.QBO_INCOME_ACCOUNT_ID;
  const found = await qboQuery(env, accessToken, realmId, "select Id from Account where AccountType = 'Income' maxresults 1", { ...opts, operation: 'query:Account' });
  const accountId = found.QueryResponse?.Account?.[0]?.Id;
  if (!accountId) throw new Error('qbo_income_account_not_configured');
  return accountId;
}

export async function findOrCreateCustomer(sb, env, accessToken, realmId, input, options = {}) {
  const { key, displayName } = input || {};
  const { data: cached, error } = await sb
    .from('qbo_customers')
    .select('key,qbo_customer_id')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(error.message || 'qbo_customer_cache_read_failed');
  if (cached?.qbo_customer_id) return cached.qbo_customer_id;

  const opts = qboOptions(options);
  const payload = qboCustomerPayload(input);
  const safeName = qboString(payload.DisplayName);
  const found = await qboQuery(env, accessToken, realmId, `select Id from Customer where DisplayName = '${safeName}' maxresults 1`, { ...opts, operation: 'query:Customer' });
  let customerId = found.QueryResponse?.Customer?.[0]?.Id;
  if (!customerId) {
    const created = await qboCreate(env, accessToken, realmId, 'Customer', payload, opts);
    customerId = created.Customer?.Id;
  }
  if (!customerId) throw new Error('qbo_customer_id_missing');
  await sb.from('qbo_customers').insert({ key, qbo_customer_id: customerId });
  return customerId;
}

export async function findOrCreateItem(sb, env, accessToken, realmId, item, options = {}) {
  const { sku, name } = item;
  const { data: cached, error } = await sb
    .from('qbo_items')
    .select('sku,qbo_item_id')
    .eq('sku', sku)
    .maybeSingle();
  if (error) throw new Error(error.message || 'qbo_item_cache_read_failed');
  if (cached?.qbo_item_id) return cached.qbo_item_id;

  const opts = qboOptions(options);
  const safeSku = qboString(sku);
  const found = await qboQuery(env, accessToken, realmId, `select Id from Item where Sku = '${safeSku}' maxresults 1`, { ...opts, operation: 'query:Item' });
  let itemId = found.QueryResponse?.Item?.[0]?.Id;
  if (!itemId) {
    const incomeAccountId = await resolveIncomeAccountRef(env, accessToken, realmId, opts);
    const created = await qboCreate(env, accessToken, realmId, 'Item', {
      Name: name || sku,
      Sku: sku,
      Type: qboItemType(item),
      IncomeAccountRef: { value: incomeAccountId },
    }, opts);
    itemId = created.Item?.Id;
  }
  if (!itemId) throw new Error(`qbo_item_id_missing:${sku}`);
  await sb.from('qbo_items').insert({ sku, qbo_item_id: itemId });
  return itemId;
}

export async function getAccessToken(sb, env = {}, options = {}) {
  const qboEnv = qboConfigEnv(env);
  const now = options.now || new Date();
  const fetchImpl = options.fetchImpl || fetch;
  const { data: tokenRow, error } = await sb
    .from('qbo_tokens')
    .select('realm_id,refresh_token,access_token,access_expires_at')
    .eq('id', 1)
    .maybeSingle();

  if (error) throw new Error(error.message || 'qbo_token_read_failed');
  if (!tokenRow?.refresh_token && !tokenRow?.access_token) throw new Error('qbo_not_connected');

  if (!needsRefresh(tokenRow, now.getTime())) {
    return { accessToken: tokenRow.access_token, realmId: tokenRow.realm_id || qboEnv.QBO_REALM_ID || '' };
  }

  if (!tokenRow.refresh_token) throw new Error('qbo_refresh_token_missing');
  if (!qboEnv.QBO_CLIENT_ID || !qboEnv.QBO_CLIENT_SECRET) throw new Error('qbo_oauth_not_configured');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenRow.refresh_token,
  });
  const response = await fetchImpl(OAUTH_URL, {
    method: 'POST',
    headers: {
      authorization: basicAuth(qboEnv.QBO_CLIENT_ID, qboEnv.QBO_CLIENT_SECRET),
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });
  const intuitTid = recordIntuitTid(options, response, 'oauth:refresh');
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`qbo_token_refresh_failed:${response.status}${intuitTidSuffix(intuitTid)}:${detail.slice(0, 200)}`);
  }

  const refreshed = await response.json();
  const accessToken = refreshed.access_token;
  if (!accessToken) throw new Error('qbo_token_refresh_missing_access_token');

  const realmId = tokenRow.realm_id || qboEnv.QBO_REALM_ID || '';
  const payload = {
    realm_id: realmId,
    access_token: accessToken,
    refresh_token: refreshed.refresh_token || tokenRow.refresh_token,
    access_expires_at: new Date(now.getTime() + Number(refreshed.expires_in || 3600) * 1000).toISOString(),
    updated_at: now.toISOString(),
    ...(intuitTid ? { last_intuit_tid: intuitTid } : {}),
  };
  const { data: saved, error: saveError } = await sb
    .from('qbo_tokens')
    .update(payload)
    .eq('id', 1)
    .select('id')
    .maybeSingle();
  if (saveError || !saved) throw new Error('qbo_token_persist_failed');

  return { accessToken, realmId };
}
