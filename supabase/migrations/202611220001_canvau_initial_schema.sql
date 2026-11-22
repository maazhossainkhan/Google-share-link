-- Canvau initial schema.
-- Apply ONLY to the new Canvau Supabase project, never to google-trim-shadow.

create extension if not exists pgcrypto;

create table if not exists public.canvau_users (
  telegram_id bigint primary key,
  username text,
  first_name text,
  last_name text,
  access_status text not null default 'pending'
    check (access_status in ('pending', 'approved', 'rejected', 'blocked')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by bigint,
  updated_at timestamptz not null default now()
);

create table if not exists public.canvau_access_requests (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null references public.canvau_users(telegram_id) on delete cascade,
  message text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by bigint
);

create table if not exists public.canvau_links (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null references public.canvau_users(telegram_id) on delete cascade,
  original_url text not null,
  google_share_url text not null,
  created_at timestamptz not null default now(),
  constraint canvau_original_url_length check (char_length(original_url) <= 8192),
  constraint canvau_google_url_length check (char_length(google_share_url) <= 2048),
  constraint canvau_google_share_url_format check (google_share_url ~ '^https://(share\\.google|www\\.google\\.com/share\\.google)/')
);

create index if not exists canvau_users_status_idx on public.canvau_users(access_status);
create index if not exists canvau_requests_status_created_idx on public.canvau_access_requests(status, created_at desc);
create index if not exists canvau_links_user_created_idx on public.canvau_links(telegram_id, created_at desc);

-- All reads/writes go through authenticated Edge Functions using the service role.
-- No public client-side policies are created.
alter table public.canvau_users enable row level security;
alter table public.canvau_access_requests enable row level security;
alter table public.canvau_links enable row level security;

revoke all on public.canvau_users from anon, authenticated;
revoke all on public.canvau_access_requests from anon, authenticated;
revoke all on public.canvau_links from anon, authenticated;
