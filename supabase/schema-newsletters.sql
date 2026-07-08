-- Newsletter platform: drafts/queue, imported recipients, settings. Apply via the
-- pooled service-role connection. Idempotent. Service-role only (RLS off).
create extension if not exists pgcrypto;

create table if not exists public.newsletters (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  body_md text not null default '',
  source text not null default 'compose',        -- 'compose' | 'blog_post'
  blog_slug text,
  status text not null default 'draft',           -- draft|scheduled|sending|sent|canceled
  audience jsonb not null default '{"populations":[],"recipient_tags":[]}'::jsonb,
  schedule jsonb not null default '{}'::jsonb,     -- {mode, send_at, interval_days, next_run_at}
  recipient_count int not null default 0,
  sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists newsletters_status_idx on public.newsletters (status);
create index if not exists newsletters_due_idx on public.newsletters ((schedule->>'next_run_at')) where status = 'scheduled';

-- Imported / manually-added recipients (users + website leads are resolved live at send).
create table if not exists public.newsletter_recipients (
  email text primary key,
  name text,
  source text not null default 'manual',           -- 'import' | 'manual'
  tags text[] not null default '{}',
  subscribed boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists newsletter_recipients_sub_idx on public.newsletter_recipients (subscribed);

-- Singleton settings row (auto-send latest blog toggle).
create table if not exists public.newsletter_settings (
  id int primary key default 1,
  auto_send_latest_blog boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.newsletter_settings (id) values (1) on conflict (id) do nothing;

grant select, insert, update, delete on public.newsletters to service_role;
grant select, insert, update, delete on public.newsletter_recipients to service_role;
grant select, insert, update on public.newsletter_settings to service_role;
