-- Improves owner-based access-request updates and reviews.
create index if not exists canvau_access_requests_telegram_id_idx
  on public.canvau_access_requests(telegram_id);
