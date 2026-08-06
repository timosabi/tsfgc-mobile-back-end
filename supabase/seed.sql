insert into public.football_competitions (
  provider,
  provider_league_id,
  name,
  country_name,
  logo_url,
  current_provider_season_id
)
values
  (
    'sportmonks',
    8,
    'Premier League',
    'England',
    'https://cdn.sportmonks.com/images/soccer/leagues/8/8.png',
    25583
  ),
  (
    'sportmonks',
    271,
    'Superliga',
    'Denmark',
    'https://cdn.sportmonks.com/images/soccer/leagues/271.png',
    null
  ),
  (
    'sportmonks',
    501,
    'Premiership',
    'Scotland',
    'https://cdn.sportmonks.com/images/soccer/leagues/501.png',
    null
  )
on conflict (provider, provider_league_id)
do update set
  name = excluded.name,
  country_name = excluded.country_name,
  logo_url = excluded.logo_url,
  current_provider_season_id = excluded.current_provider_season_id,
  updated_at = now();

insert into public.football_seasons (
  competition_id,
  provider,
  provider_season_id,
  name,
  starts_at,
  ends_at,
  is_current
)
select
  c.id,
  'sportmonks',
  25583,
  '2025/2026',
  '2025-08-15',
  '2026-05-24',
  true
from public.football_competitions c
where c.provider = 'sportmonks'
  and c.provider_league_id = 8
on conflict (provider, provider_season_id)
do update set
  competition_id = excluded.competition_id,
  name = excluded.name,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  is_current = excluded.is_current,
  updated_at = now();
