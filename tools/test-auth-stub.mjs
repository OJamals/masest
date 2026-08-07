/* Shared auth.js stub for browser tests that need the authenticated shells
 * (admin console, customer dashboard) to boot and render real rows.
 *
 * Returned as module source and served in place of /js/auth.js, so it must
 * export every binding admin.js and dashboard.js import from it — a missing
 * export breaks the module link and the panels silently never render.
 */

const account = {
  email: 'buyer@acmehvac.test',
  profile: { full_name: 'Avery Buyer' },
  company: { id: 'co-1', name: 'Acme HVAC and Water Systems', status: 'approved', net_terms_days: 30, tax_exempt: true },
  can_checkout: true,
  can_use_net_terms: true,
  credit: { net_outstanding: 1840, credit_available: 4160 },
  staff: { role: 'owner' },
  can_admin: true,
};

const orders = [
  { id: 'ord-1001', order_number: 'MAS-2640', created_at: '2026-06-22T14:00:00Z', status: 'net_open', payment_method: 'net', subtotal: 1700, tax: 140, total: 1840, currency: 'usd', customer_email: account.email, company_id: 'co-1', companies: { name: 'Acme HVAC and Water Systems' }, order_items: [{ sku: 'VK-HCR-5', product_sku: 'hcr', name: 'VertKleen HCR', qty: 2, unit_price: 850, line_total: 1700 }] },
  { id: 'ord-1002', order_number: 'MAS-2641', created_at: '2026-06-24T10:00:00Z', status: 'paid', payment_method: 'stripe', subtotal: 920, tax: 74, total: 994, currency: 'usd', customer_email: account.email, company_id: 'co-1', companies: { name: 'Acme HVAC and Water Systems' }, order_items: [{ sku: 'VK-PRG-1', product_sku: 'purgo', name: 'VertKleen Purgo', qty: 1, unit_price: 920, line_total: 920 }] },
];

const quotes = [
  { id: 'q-1', created_at: '2026-06-25T09:00:00Z', name: 'Dana Ruiz', email: 'dana@acmehvac.test', company: 'Acme HVAC', phone: '555-0100', product: 'VertKleen HCR — 55 gal', industry: 'HVAC', location: 'Tampa, FL', message: 'Need pricing and lead time for a scheduled descaling turnaround.', status: 'new', priority: 'urgent', lead_score: 88, pipeline_stage: 'new', next_step: 'Send formal quote', due_at: '2026-06-27T09:00:00Z' },
  { id: 'q-2', created_at: '2026-06-24T09:00:00Z', name: 'Chris Patel', email: 'chris@northline.test', company: 'Northline Facilities', product: 'VertKleen CR — 275 gal', industry: 'Data center', location: 'Reno, NV', message: 'Quarterly loop cleaning quote.', status: 'contacted', priority: 'high', lead_score: 71, pipeline_stage: 'qualified' },
];

const companies = [
  { id: 'co-1', name: 'Acme HVAC and Water Systems', status: 'approved', net_terms_days: 30, credit_limit: 10000, tax_exempt: true, price_tier: 'hvac', created_at: '2026-05-01T00:00:00Z', profiles: [{ id: 'u-1', full_name: 'Avery Buyer', phone: '555-0100', role: 'owner' }] },
  { id: 'co-2', name: 'Northline Facilities', status: 'pending', net_terms_days: 0, credit_limit: 0, tax_exempt: false, price_tier: 'standard', created_at: '2026-06-10T00:00:00Z', profiles: [] },
];

const stats = {
  revenue: 411820,
  orders: { total: 214, byStatus: { paid: 61, fulfilled: 118, net_open: 22 } },
  companies: { pending: 1, approved: 87, suspended: 2 },
  messages: { unread: 2 },
  setup_followups: { companies: 2, open_steps: [{ key: 'tax_exempt', label: 'Tax exemption certificate missing', count: 2 }] },
  quotes_due: { overdue: 3 },
  crm_tasks: { overdue: 2 },
  quotes: { new: 4, urgent: 1 },
  catalog: { buy: 15, quote: 5 },
  inventory: { low_stock: 3 },
  traffic: { views_7d: 3184 },
  commerce: { revenue_7d: 28450, revenue_30d: 96380, revenue_total: 411820, average_order_value: 1924, orders_7d: 17, fulfillment_queue: 23, net_orders_open: 22, net_exposure: 48210 },
  crm: { unread_messages: 2, quotes_new: 4, quotes_urgent: 1, quotes_overdue: 3, setup_followups: 2, tasks_overdue: 2 },
  accounts: { pending: 1, approved: 87, suspended: 2 },
  catalog_health: { buy: 15, quote: 5, low_stock: 3, inactive: 1 },
  content: { drafts: 4, scheduled: 2, schedule_overdue: 1 },
  automation: { attention: 3, available: true },
  analytics: { views_7d: 3184, quote_submits_7d: 41, quote_conversion_rate: 0.0129 },
  request_queue: [
    { id: 1, label: 'Account approvals', value: 1, href: '#companies', priority: 'high' },
    { id: 2, label: 'New quote requests', value: 4, href: '#quotes', priority: 'urgent' },
  ],
  staff_context: { role: 'owner', email: 'staff@example.test', can_write: true, capabilities: ['admin.write', 'order.write', 'product.write', 'company.credit', 'integration.configure'] },
};

const messages = [
  { id: 'm-1', sender_role: 'buyer', body: 'Can you confirm lead time?', created_at: '2026-06-24T12:10:00Z' },
  { id: 'm-2', sender_role: 'staff', body: 'Two drums can ship Friday.', created_at: '2026-06-24T13:15:00Z' },
];

const reviews = [
  { id: 'rv-1', kind: 'product', sku: 'hcr', rating: 5, title: 'Cut our descaling window in half', body: 'Chiller loop cleared in one pass.', author_name: 'Dana Ruiz', status: 'pending', verified_purchase: true, created_at: '2026-06-20T00:00:00Z' },
];

export function authStubModule() {
  const fixtures = { account, orders, quotes, companies, stats, messages, reviews };
  return `
const fixtures = ${JSON.stringify(fixtures)};
const okSession = { access_token: "stub-token", user: { id: "u-1", email: fixtures.account.email } };
export const supabase = { auth: {
  async getSession() { return { data: { session: okSession }, error: null }; },
  async signOut() {}, async signInWithPassword() { return { data: { session: okSession }, error: null }; },
  async refreshSession() { return { data: { session: okSession }, error: null }; },
  onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
} };
export async function me() { return fixtures.account; }
export async function logout() {}
export async function login() { return { session: okSession }; }
export async function signup() { return { session: okSession }; }
export async function resetPasswordForEmail() { return {}; }
export async function updatePassword() { return {}; }
export async function orders() { return fixtures.orders; }
export async function catalog() { return []; }
export async function getToken() { return "stub-token"; }
export async function apiBlob() { return new Blob([""], { type: "application/pdf" }); }
export async function api(path) {
  const p = new URL(path, window.location.origin).pathname;
  if (p.startsWith("/api/admin/stats")) return fixtures.stats;
  if (p.startsWith("/api/admin/search")) return { q: "", groups: [], total: 0 };
  if (p.startsWith("/api/admin/automation")) return { jobs: [
    { job: "content_publish", label: "Scheduled content publish", expectedMinutes: 5, state: "ok", last_run_at: new Date(Date.now() - 120000).toISOString(), processed: 1, error_code: null },
    { job: "integration_effects", label: "Provider effect queue", expectedMinutes: 5, state: "ok", last_run_at: new Date(Date.now() - 90000).toISOString(), processed: 12, error_code: null },
    { job: "quote_sweep", label: "Quote follow-up sweep", expectedMinutes: 60, state: "stale", last_run_at: new Date(Date.now() - 18000000).toISOString(), processed: 0, error_code: null },
    { job: "crm_task_digest", label: "CRM follow-up digest", expectedMinutes: 1440, state: "never", last_run_at: null, processed: 0, error_code: null },
    { job: "review_reminders", label: "Review reminder sweep", expectedMinutes: 1440, state: "failing", last_run_at: new Date(Date.now() - 3600000).toISOString(), processed: 0, error_code: "load_failed" },
  ], attention: 3 };
  if (p.startsWith("/api/admin/orders")) return { orders: fixtures.orders, total: fixtures.orders.length, has_more: false };
  if (p.startsWith("/api/admin/quotes")) return { quotes: fixtures.quotes, total: fixtures.quotes.length, has_more: false, new_count: 1 };
  if (p.startsWith("/api/admin/companies")) return { companies: fixtures.companies, total: fixtures.companies.length, has_more: false };
  if (p.startsWith("/api/admin/users")) return { users: [{ id: "u-1", email: fixtures.account.email, full_name: "Avery Buyer", is_staff: false, company_id: "co-1", created_at: "2026-05-01T00:00:00Z" }], total: 1, has_more: false };
  if (p.startsWith("/api/admin/document-requests")) return { requests: [], total: 0, has_more: false };
  if (p.startsWith("/api/admin/products")) return { products: [{ sku: "hcr", name: "VertKleen HCR", mode: "buy", active: true, sort: 1, image_url: "", photo_alt: "", product_variants: [{ vsku: "VK-HCR-5", sku: "VK-HCR-5", label: "5 gal pail", gallons: 5, price: 850, currency: "usd", active: true, stock: 12 }] }] };
  if (p.startsWith("/api/admin/variant-pricing")) return { variants: [], services: [], programs: [] };
  if (p.startsWith("/api/admin/inventory")) return { low_stock: [{ vsku: "VK-HCR-5", name: "VertKleen HCR", stock: 2 }] };
  if (p.startsWith("/api/admin/coupons")) return { coupons: [] };
  if (p.startsWith("/api/admin/reviews")) return { reviews: fixtures.reviews, total: 1, has_more: false };
  if (p.startsWith("/api/admin/messages")) return { threads: [], messages: fixtures.messages };
  if (p.startsWith("/api/admin/message-settings")) return { notify_support_requests: true, notify_messages: false };
  if (p.startsWith("/api/admin/newsletters")) return { campaigns: [], drafts: [], settings: {}, recipients: [], total: 0, has_more: false };
  if (p.startsWith("/api/admin/recipients")) return { recipients: [], total: 0, has_more: false };
  if (p.startsWith("/api/admin/offers")) return { offers: [] };
  if (p.startsWith("/api/admin/content")) return { entries: [], types: [], total: 0, has_more: false };
  if (p.startsWith("/api/admin/traffic")) return { totals: {}, funnel: [], campaigns: [], days: [], recent: [] };
  if (p.startsWith("/api/admin/reports")) return { revenue: 0, tax: 0, orders: 0, paid_orders: 0, average_order_value: 0 };
  if (p.startsWith("/api/admin/crm")) return { tasks: [], contacts: [], notes: [], pipeline: [], total: 0, has_more: false };
  if (p.startsWith("/api/admin/integrations") || p.startsWith("/api/admin/integration-effects")) return { providers: [], dead_letters: [], counts: {} };
  if (p.startsWith("/api/admin/shipstation")) return { configured: false, carriers: [] };
  if (p.startsWith("/api/admin/stripe")) return { configured: false, payouts: [] };
  if (p.startsWith("/api/admin/qbo") || p.startsWith("/api/qbo")) return { connected: false };
  if (p === "/api/account/me") return fixtures.account;
  if (p.startsWith("/api/account/orders")) return { orders: fixtures.orders, total: fixtures.orders.length, has_more: false };
  if (p.startsWith("/api/account/quotes")) return { quotes: fixtures.quotes, total: fixtures.quotes.length, has_more: false };
  if (p.startsWith("/api/account/messages")) return { messages: fixtures.messages };
  if (p.startsWith("/api/account/notifications")) return { notifications: [{ id: "n-1", type: "order", title: "Order awaiting NET payment", body: "Invoice is posted.", read: false, created_at: "2026-06-23T18:10:00Z" }], unread: 1, total: 1, has_more: false };
  if (p.startsWith("/api/account/addresses")) return { addresses: [{ id: "addr-1", type: "ship", line1: "1200 Cooling Tower Way", city: "Tampa", state: "FL", zip: "33602", is_default: true }] };
  if (p.startsWith("/api/account/company")) return { company: fixtures.account.company };
  if (p.startsWith("/api/account/invoices")) return { invoices: [] };
  if (p.startsWith("/api/account/team")) return { members: [], invites: [] };
  if (p.startsWith("/api/account/notification-prefs")) return { notify_orders: true, notify_messages: true, notify_offers: false };
  if (p.startsWith("/api/account/billing-portal")) return { url: "about:blank" };
  return {};
}
`;
}
