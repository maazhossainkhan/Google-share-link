-- Canvau initial schema.
-- Apply ONLY to the dedicated Canvau Supabase project, never to google-trim-shadow.

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
  short_code varchar(12) not null unique
    check (short_code ~ '^[A-Za-z0-9_-]{5,12}$'),
  google_share_url text,
  google_share_status text not null default 'not_started'
    check (google_share_status in ('not_started', 'pending', 'captured', 'unavailable')),
  is_active boolean not null default true,
  click_count bigint not null default 0 check (click_count >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canvau_original_url_length check (char_length(original_url) between 8 and 8192),
  constraint canvau_google_url_length check (google_share_url is null or char_length(google_share_url) <= 2048),
  constraint canvau_google_share_url_format check (
    google_share_url is null or google_share_url ~ '^https://(share[.]google|search[.]app)/[^[:space:]]+$'
  ),
  constraint canvau_google_capture_consistency check (
    google_share_status <> 'captured' or google_share_url is not null
  )
);

create index if not exists canvau_users_status_idx on public.canvau_users(access_status);
create index if not exists canvau_requests_status_created_idx on public.canvau_access_requests(status, created_at desc);
create index if not exists canvau_links_user_created_idx on public.canvau_links(telegram_id, created_at desc);
create index if not exists canvau_links_active_expiry_idx on public.canvau_links(short_code, is_active, expires_at);

-- All reads/writes go through server-side Edge Functions using the service role.
-- No public client-side policies or table grants are created.
alter table public.canvau_users enable row level security;
alter table public.canvau_access_requests enable row level security;
alter table public.canvau_links enable row level security;

revoke all on public.canvau_users from anon, authenticated;
revoke all on public.canvau_access_requests from anon, authenticated;
revoke all on public.canvau_links from anon, authenticated;
