/* MASEST commerce - PUBLIC client config. Fill these in.
 * Only public/publishable values belong here - they ship to the browser.
 * NEVER put secret keys here (Stripe secret, Klaviyo private, Supabase service-role).
 * Those live only in server environment variables, read server-side by functions. */
window.MASEST_SUPABASE_URL = 'https://mvfxzvkzcqmnwcoblvfc.supabase.co';
window.MASEST_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12Znh6dmt6Y3Ftbndjb2JsdmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NTk5NDMsImV4cCI6MjA5NzIzNTk0M30.JJOxgY8uZPpwKHGc6bMvWKazLDqxUoihFGNNf_2HlBc';        // Supabase anon key (RLS-protected, public-safe)
window.MASEST_STRIPE_PK = 'pk_test_51TjBFdHfKF76gAoJLvVOMtE9BLgIyAaFvvyuRl4sAxXpfljwdJQqq4PBlE09kxQAYQUgfkdDlHsXY7MAxZN1FkmM00oTFFf6V6';            // Stripe publishable key pk_live_... (public)
window.MASEST_CRISP_ID = 'bc6be1cf-f005-40b6-ad3e-24fe68ee9b2a';             // Crisp Website ID (public)
window.MASEST_KLAVIYO_COMPANY = 'Ww6Ryz';      // Klaviyo public company/site ID (public)
window.MASEST_TURNSTILE_SITEKEY = '0x4AAAAAADmaD_pRgYim8QF5';   // Cloudflare Turnstile sitekey (public). Allowed domains now include masest-commerce.pages.dev. Its matching SECRET must be set in Supabase Auth → CAPTCHA, else signup/sign-in return captcha_failed.
