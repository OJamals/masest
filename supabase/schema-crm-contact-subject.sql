-- CRM slice 7: make a contact a first-class CRM subject so notes/tasks/timeline
-- attach to a crm_contacts row (subject_type 'contact'), not just company/quote.
-- Idempotent: drop the existing 2-value subject_type CHECK + add a 3-value one.
-- Constraint names verified against prod: crm_notes_subject_type_check /
-- crm_tasks_subject_type_check (the inline column-check default names).

do $$ begin
  alter table public.crm_notes drop constraint if exists crm_notes_subject_type_check;
  alter table public.crm_notes add constraint crm_notes_subject_type_chk
    check (subject_type in ('company','quote','contact'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.crm_tasks drop constraint if exists crm_tasks_subject_type_check;
  alter table public.crm_tasks add constraint crm_tasks_subject_type_chk
    check (subject_type in ('company','quote','contact'));
exception when duplicate_object then null; end $$;
