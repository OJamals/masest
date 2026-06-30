-- Restore the after-photo on the 6 before/after proof cards lost in the proof_card
-- CMS migration (#5 QA). Adds image_after fields so proofCard() renders the .case-ba
-- two-figure pair, matching the hardcoded fallback. Idempotent (jsonb ||).

update public.content_entries set payload = payload || '{"image_after":"img/proof/cases/drone-after.webp?v=20260617b","image_after_alt":"Building exterior after VertKleen drone wash, scale and algae cleared","image_after_w":1200,"image_after_h":1029}'::jsonb, updated_at = now()
  where type = 'proof_card' and slug = 'uf-shands-drone-wash' and locale = 'en';
update public.content_entries set payload = payload || '{"image_after":"img/proof/cases/hood-after.webp?v=20260617b","image_after_alt":"Hood filters degreased clean with VertKleen CR","image_after_w":520,"image_after_h":650}'::jsonb, updated_at = now()
  where type = 'proof_card' and slug = 'neatfreaks-hood-degrease' and locale = 'en';
update public.content_entries set payload = payload || '{"image_after":"img/proof/cases/airboat-after.webp?v=20260617b","image_after_alt":"Same airboat aluminum restored bright with VertKleen AlumiBrite and Torque","image_after_w":817,"image_after_h":857}'::jsonb, updated_at = now()
  where type = 'proof_card' and slug = 'airboat-alumibrite' and locale = 'en';
update public.content_entries set payload = payload || '{"image_after":"img/proof/cases/farm-rust-after.webp?v=20260617b","image_after_alt":"Same diamond-plate cleared of rust with VertKleen HCR, no pitting","image_after_w":740,"image_after_h":967}'::jsonb, updated_at = now()
  where type = 'proof_card' and slug = 'brevard-farm-hvac' and locale = 'en';
update public.content_entries set payload = payload || '{"image_after":"img/proof/cases/grout-after.webp?v=20260617b","image_after_alt":"Tile and grout cleaned with VertKleen CR and LAM3","image_after_w":850,"image_after_h":882}'::jsonb, updated_at = now()
  where type = 'proof_card' and slug = 'property-grout-moss' and locale = 'en';
update public.content_entries set payload = payload || '{"image_after":"img/proof/cases/kitchen-after.webp?v=20260617b","image_after_alt":"Commercial kitchen cooking line cleaned with VertKleen CRHD","image_after_w":1200,"image_after_h":900}'::jsonb, updated_at = now()
  where type = 'proof_card' and slug = 'commercial-kitchen-crhd' and locale = 'en';
