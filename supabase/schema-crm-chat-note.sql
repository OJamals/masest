-- CRM slice 10: let Crisp chat messages log into the CRM timeline as notes.
-- Extends crm_notes.kind to allow 'chat' (the webhook bridge inserts these).
-- Idempotent: drop the existing kind CHECK + add one that includes 'chat'.
-- Constraint name verified against prod: crm_notes_kind_check (inline column default).

do $$ begin
  alter table public.crm_notes drop constraint if exists crm_notes_kind_check;
  alter table public.crm_notes add constraint crm_notes_kind_chk
    check (kind in ('note','call','email','meeting','chat'));
exception when duplicate_object then null; end $$;
