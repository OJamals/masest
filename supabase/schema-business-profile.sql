-- MASEST — Business verification profile (decouple user signup from business approval).
-- Run in the Supabase SQL editor (or `supabase db push`). Idempotent: every column is
-- `add column if not exists`, safe to re-run.
--
-- Context: user accounts are now active immediately on signup (no admin approval to
-- register). The admin approval gate moves entirely onto the BUSINESS: a registered user
-- submits a detailed business profile (below) for staff verification. Once approved, the
-- business unlocks NET terms, programs, QuickBooks invoicing, and wholesale pricing.
--
-- These columns capture the verification dossier collected by the dashboard business
-- registration form (js/business.js) and surfaced to staff in the admin company detail
-- drawer for approve/reject decisions.

alter table public.companies add column if not exists legal_name          text;   -- registered legal entity name
alter table public.companies add column if not exists dba                 text;   -- "doing business as" / trade name
alter table public.companies add column if not exists entity_type         text;   -- llc | c_corp | s_corp | partnership | sole_prop | nonprofit | government | other
alter table public.companies add column if not exists tax_id              text;   -- EIN / federal tax id
alter table public.companies add column if not exists business_phone      text;
alter table public.companies add column if not exists business_email      text;
alter table public.companies add column if not exists website             text;
alter table public.companies add column if not exists industry            text;   -- hvac | facilities | marine | food_bev | manufacturing | municipal | distributor | other
alter table public.companies add column if not exists est_annual_volume   text;   -- self-reported spend band, e.g. "under_10k" / "10k_50k" / ...
alter table public.companies add column if not exists requested_net_terms int;    -- 0 | 15 | 30 | 45 | 60 (request only; staff sets the real net_terms_days on approval)
alter table public.companies add column if not exists contact_name        text;   -- authorized account contact
alter table public.companies add column if not exists contact_title       text;
alter table public.companies add column if not exists submitted_at        timestamptz;  -- when the business was submitted for verification

-- Staff verification decisions write back here (admin company detail / approve action).
alter table public.companies add column if not exists verified_at         timestamptz;
alter table public.companies add column if not exists verified_by         uuid;         -- staff profile id that approved
alter table public.companies add column if not exists rejection_reason     text;        -- shown to the business when status = 'rejected'

-- service_role already holds table grants from schema.sql (grant all ... to service_role);
-- new columns inherit those. No additional grants required.
