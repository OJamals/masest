// requireCompany wrapper (#38): dedupe account-route auth and company-role lookup.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('supabase.js derives company gates from the typed commerce snapshot', () => {
  const src = read('functions/_lib/supabase.js');
  const context = read('functions/_lib/commerce-context.js');
  assert.match(src, /export async function requireCompany/);
  assert.match(src, /resolveCommerceContext/);
  assert.match(src, /error: 'unauthenticated'/, '401 when no user');
  assert.match(src, /error: 'no_company'/, '403 when no company');
  assert.match(src, /return \{ \.\.\.context, context \}/, 'returns the immutable context fields');
  assert.match(context, /select\('id,company_id,role,full_name,phone'\)/, 'resolves profile and role once');
  assert.match(context, /select\('id,name,status,price_tier,tax_exempt,stripe_customer_id'\)/, 'resolves Company commerce fields once');
});

// Every company-scoped account route uses the wrapper instead of re-deriving the company.
const ROUTES = [
  'functions/api/account/orders.js',
  'functions/api/account/order.js',
  'functions/api/account/messages.js',
  'functions/api/account/addresses.js',
  'functions/api/account/notifications.js',
  'functions/api/account/billing-portal.js',
];

for (const path of ROUTES) {
  test(`${path} uses requireCompany`, () => {
    const src = read(path);
    const primitive = path.endsWith('/order.js') ? 'requireCommerceUser' : 'requireCompany';
    assert.match(src, new RegExp(`import\\s*\\{[^}]*${primitive}[^}]*\\}\\s*from\\s*['\"][^'\"]*supabase\\.js['\"]`), `must import ${primitive}`);
    assert.match(src, new RegExp(`${primitive}\\(request, env\\)`), `must call ${primitive}`);
    assert.doesNotMatch(src, /companyForUser\(/, 'must not re-derive the company itself');
  });
}

test('functions/api/account/company.js authenticates users before creating or updating a business profile', () => {
  const src = read('functions/api/account/company.js');
  const migration = read('supabase/schema-account-company.sql');
  assert.match(src, /import\s*\{[^}]*userFromRequest[^}]*\}\s*from\s*['"][^'"]*supabase\.js['"]/, 'must authenticate the user directly because company may not exist yet');
  assert.match(src, /userFromRequest\(request, env\)/, 'must call userFromRequest');
  assert.match(src, /\.from\('profiles'\)[\s\S]{0,140}\.eq\('id', user\.id\)/, 'must scope the caller profile lookup to the authenticated user');
  assert.match(src, /\.rpc\('create_company_for_user'/, 'must create and link the business through one transaction');
  assert.match(src, /status:\s*'pending'/, 'must create new businesses pending admin verification');
  assert.match(migration, /update public\.profiles[\s\S]+where id = p_user_id[\s\S]+company_id is null/, 'transaction must link only an unlinked authenticated profile');
  assert.match(src, /\.from\('companies'\)[\s\S]{0,180}\.update\(patch\)[\s\S]{0,100}\.eq\('id', profile\.company_id\)/, 'must scope existing business updates by the caller profile company');
  assert.doesNotMatch(src, /companyForUser\(/, 'must not re-derive company via older helper');
});
