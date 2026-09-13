alter table public.fixtures
  add column if not exists home_short_code text,
  add column if not exists away_short_code text;
