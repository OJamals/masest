-- Seed the four cooling-tower program tiers as published pricing_tier CMS entries.
-- Mirrors the hardcoded fallback cards in programs.html so the admin CMS owns them and
-- future `build-content.mjs` runs (against Supabase) keep emitting them into
-- data/content/pricing.json. Idempotent: re-applying refreshes payload in place.
-- Apply via the pooled service-role connection (same path as other schema-*.sql).

insert into public.content_entries (type, slug, title, status, locale, payload, seo)
values
  ('pricing_tier', 'essentials', 'Essentials', 'published', 'en', '{"badge":"Bronze","name":"Essentials","audience":"Single-tower contractors","price":"$350-650","price_unit":"/ mo","annual":"$4.2K-7.8K / yr","features":["WaterSafe60, Purgo, DBNPA, HCR","Quarterly visit and water test","Manual dosing"],"replaces":"Replaces common descalers and commodity cleaner programs","cta":"Quote Bronze","href":"contact?type=quote&product=Full%20Cooling%20Tower%20Program","featured":false,"sort_order":1,"active":true}'::jsonb, '{}'::jsonb),
  ('pricing_tier', 'standard', 'Standard', 'published', 'en', '{"badge":"Silver · Most chosen","name":"Standard","audience":"Mid-size, schools, commercial","price":"$900-1,800","price_unit":"/ mo","annual":"$10.8K-21.6K / yr","features":["Everything in Bronze, plus CR, Neutral, Descaler","Monthly visit and analysis","Automated Advantage controller","Annual ASHRAE 188 update"],"replaces":"Displaces Ecolab COIL-FLO","cta":"Quote Silver","href":"contact?type=quote&product=Full%20Cooling%20Tower%20Program","featured":true,"sort_order":2,"active":true}'::jsonb, '{}'::jsonb),
  ('pricing_tier', 'premium', 'Premium', 'published', 'en', '{"badge":"Gold","name":"Premium","audience":"Districts, hospitals, universities","price":"$2,200-4,500","price_unit":"/ mo","annual":"$26.4K-54K / yr","features":["Everything in Silver, plus glycol management, MultiWash, AlumiBrite","Bi-weekly service","Engineering-reviewed ASHRAE 188 WMP","Legionella assessment and full injection system"],"replaces":"Displaces Nalco / Ecolab national","cta":"Quote Gold","href":"contact?type=quote&product=Full%20Cooling%20Tower%20Program","featured":false,"sort_order":3,"active":true}'::jsonb, '{}'::jsonb),
  ('pricing_tier', 'full-lifecycle', 'Full Lifecycle', 'published', 'en', '{"badge":"Platinum","name":"Full Lifecycle","audience":"Districts, hospitals, aerospace","price":"$5,000-15,000+","price_unit":"/ mo","annual":"$60K-180K+ / yr","features":["Everything in Gold, plus DDC design and commissioning","Weekly monitoring, 24/7 response","WMP engineering review, quarterly Legionella","EHSS and CAGE procurement paperwork handled"],"replaces":"Displaces Ecolab / Nalco / Diversey contracts","cta":"Quote Platinum","href":"contact?type=quote&product=Full%20Cooling%20Tower%20Program","featured":false,"sort_order":4,"active":true}'::jsonb, '{}'::jsonb)
on conflict (type, slug, locale) do update
  set title = excluded.title,
      status = excluded.status,
      payload = excluded.payload,
      seo = excluded.seo,
      published_at = coalesce(public.content_entries.published_at, now()),
      updated_at = now();

update public.content_entries
  set published_at = coalesce(published_at, now())
  where type = 'pricing_tier' and status = 'published';
