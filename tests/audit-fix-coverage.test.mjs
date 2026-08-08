import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const cart = read('cart.html');
const checkout = read('checkout.html');
const checkoutSource = read('js/checkout.js');
const commerceSource = read('js/main/commerce-ui.js');
const css = read('css/style.css');
const home = read('index.html');
const product = read('products/hcr.html');

test('checkout keeps an invalid non-empty field in its error state until valid', async () => {
  const { fieldNeedsError } = await import('../js/checkout.js');

  assert.equal(fieldNeedsError({ value: 'bad@', checkValidity: () => false }), true);
  assert.equal(fieldNeedsError({ value: 'buyer@example.com', checkValidity: () => true }), false);
  assert.match(
    checkoutSource,
    /form\.addEventListener\('input',[\s\S]*?syncFieldError\(event\.target\)[\s\S]*?form\.addEventListener\('focusout',[\s\S]*?syncFieldError\(event\.target\)/,
  );
});

test('cart registers the actual action row, not its non-overlapping padded card, as a chat obstruction', () => {
  assert.doesNotMatch(
    cart,
    /class="cart-path cart-path-primary"[^>]*data-customer-chat-obstruction/,
  );
  assert.match(
    cart,
    /class="cart-actions"[^>]*data-customer-chat-obstruction/,
  );
});

test('product detail purchase proof and primary buy action stay decision-adjacent', () => {
  assert.match(product, /<a class="product-hero-proof" href="#records"[^>]*>[\s\S]*See 3 field results<\/a>/);
  assert.match(product, /id="records"/);
  assert.match(
    commerceSource,
    /variant === "button" \? "btn btn-primary btn-sm" : "shop-card-add"/,
  );
});

test('checkout keeps address rationale and mobile escape/trust cues', () => {
  assert.match(
    checkout,
    /Carriers price each shipment from the full delivery address, so rates appear once these are complete\./,
  );
  assert.match(checkout, /class="checkout-secure"[^>]*>[\s\S]*Secure checkout/);
  assert.match(checkout, /class="checkout-return"[^>]*>Return to cart<\/a>/);
  const mobile = css.slice(css.lastIndexOf('@media (max-width: 640px)'));
  assert.match(mobile, /\.checkout-return\s*\{[\s\S]*display:\s*inline-flex/);
  assert.match(mobile, /\.checkout-secure\s*\{[^}]*font-size:/);
});

test('homepage keeps the audited hyphenated headline phrase unbroken', () => {
  assert.match(home, /<span class="no-break">harsh-chemical<\/span>/);
  assert.match(css, /\.no-break\s*\{\s*white-space:\s*nowrap;?\s*\}/);
});
