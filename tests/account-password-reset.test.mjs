import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = path => existsSync(new URL(`../${path}`, import.meta.url));

test("account login supports Supabase password recovery", () => {
  const account = read("account.html");
  const auth = read("js/auth.js");
  const accountNav = read("js/account-nav.js");
  const commerceUi = read("js/main/commerce-ui.js");
  assert.equal(exists("supabase/templates/reset-password.html"), true);
  const email = read("supabase/templates/reset-password.html");

  assert.match(account, /id="forgotPasswordBtn"/);
  assert.match(account, /isLocalPreview/);
  assert.match(account, /isLocalPreview \? "" : window\.MASEST_TURNSTILE_SITEKEY/);
  assert.match(account, /id="resetPasswordForm"/);
  assert.match(account, /id="newPassword"/);
  assert.match(account, /id="resetPasswordBtn"/);
  assert.match(account, /resetPasswordForEmail/);
  assert.match(account, /updatePassword/);
  assert.match(account, /password-reset-link/);

  assert.match(auth, /export async function resetPasswordForEmail/);
  assert.match(auth, /sb\.auth\.resetPasswordForEmail\(email, \{\s*redirectTo/s);
  assert.match(auth, /export async function updatePassword/);
  assert.match(auth, /sb\.auth\.updateUser\(\{\s*password/s);
  assert.match(auth, /PASSWORD_RECOVERY/);
  assert.match(commerceUi, /isLocalStaticCommerceSuppressed/);
  assert.match(commerceUi, /accountPath/);
  assert.match(accountNav, /href="\$\{root\}account\.html"/);

  assert.match(email, /<h1>Reset your password<\/h1>/);
  assert.match(email, /\{\{ \.ConfirmationURL \}\}/);
  assert.match(email, /If you didn't request this/);
});

test("Supabase auth emails use the canonical apex account URL in production", () => {
  const auth = read("js/auth.js");

  assert.match(auth, /PRODUCTION_AUTH_HOSTS = new Set\(\['masest\.co', 'www\.masest\.co'\]\)/);
  assert.match(auth, /CANONICAL_AUTH_ORIGIN = 'https:\/\/masest\.co'/);
  assert.match(auth, /return `\$\{CANONICAL_AUTH_ORIGIN\}\/account\$\{search\}`/);
  assert.match(auth, /emailRedirectTo: accountRedirectUrl\(\)/);
  assert.match(auth, /const redirectTo = accountRedirectUrl\('\?mode=reset-password'\)/);
  assert.doesNotMatch(auth, /emailRedirectTo: `\$\{window\.location\.origin\}\/account\.html`/);
});
