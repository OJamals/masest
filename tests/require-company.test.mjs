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
  'functions/api/account/company.js',
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
