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
  const factsAndBuy = product.match(
    /<div class="product-hero-facts"[^>]*>[\s\S]*?<\/div>\s*(?:<!--[\s\S]*?-->\s*)?<div class="product-hero-buy">/,
  )?.[0] || '';
  assert.match(factsAndBuy, /<a class="product-hero-proof" href="#product-result-hcr"[^>]*>[\s\S]*See brewery cleaning results<\/a>/);
  assert.match(product, /<h2 id="product-result-hcr">A proven pair for brewery buildup\.<\/h2>/);
  assert.match(factsAndBuy, /<div class="product-hero-buy">/);
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
  // Locate the block that actually declares .checkout-return rather than
  // assuming it lives in the last 640px block — normalizing the breakpoints
  // added more 640px blocks after it and the positional guess stopped holding.
  const blockStart = css.lastIndexOf('@media (max-width: 640px)', css.indexOf('.checkout-return {', css.indexOf('.checkout-return:hover')));
  assert.ok(blockStart > -1, '.checkout-return mobile rule should sit in a 640px block');
  const mobile = css.slice(blockStart);
  assert.match(mobile, /\.checkout-return\s*\{[\s\S]*display:\s*inline-flex/);
  assert.match(mobile, /\.checkout-secure\s*\{[^}]*font-size:/);
});

test('homepage makes industrial cleaning and the two buyer routes explicit', () => {
  assert.match(home, /Purpose-built industrial cleaning chemistry/);
  assert.match(home, /href="contact\?type=distributor">Become a distributor/);
  assert.match(home, /href="products">Go to products/);
});
