// requireCompany wrapper (#38): dedupe the userFromRequest→401→companyForUser→403 boilerplate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('supabase.js defines requireCompany returning user/companyId/sb or an error response', () => {
  const src = read('functions/_lib/supabase.js');
  assert.match(src, /export async function requireCompany/);
  assert.match(src, /requireCompany[\s\S]{0,400}unauthenticated/, '401 when no user');
  assert.match(src, /requireCompany[\s\S]{0,400}companyForUser/, 'resolves the company');
  assert.match(src, /requireCompany[\s\S]{0,400}no_company/, '403 when no company');
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
    assert.match(src, /import\s*\{[^}]*requireCompany[^}]*\}\s*from\s*['"][^'"]*supabase\.js['"]/, 'must import requireCompany');
    assert.match(src, /requireCompany\(request, env\)/, 'must call requireCompany');
    assert.doesNotMatch(src, /companyForUser\(/, 'must not re-derive the company itself');
  });
}

test('functions/api/account/company.js authenticates users before creating or updating a business profile', () => {
  const src = read('functions/api/account/company.js');
  assert.match(src, /import\s*\{[^}]*userFromRequest[^}]*\}\s*from\s*['"][^'"]*supabase\.js['"]/, 'must authenticate the user directly because company may not exist yet');
  assert.match(src, /userFromRequest\(request, env\)/, 'must call userFromRequest');
  assert.match(src, /\.from\('profiles'\)[\s\S]{0,140}\.eq\('id', user\.id\)/, 'must scope the caller profile lookup to the authenticated user');
  assert.match(src, /\.from\('companies'\)[\s\S]{0,260}\.insert\(\{[\s\S]{0,180}status: 'pending'/, 'must create new businesses pending approval');
  assert.match(src, /\.from\('profiles'\)[\s\S]{0,180}\.update\(\{ company_id: company\.id, role: 'admin' \}\)[\s\S]{0,100}\.eq\('id', user\.id\)/, 'must link only the authenticated profile to the new business');
  assert.match(src, /\.from\('companies'\)[\s\S]{0,180}\.update\(patch\)[\s\S]{0,100}\.eq\('id', profile\.company_id\)/, 'must scope existing business updates by the caller profile company');
  assert.doesNotMatch(src, /companyForUser\(/, 'must not re-derive company via legacy helper');
});
