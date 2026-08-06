# SportMonks Real Data Plan

## Free API Reality

SportMonks has a free football API plan, but it does not include Premier League.

Free leagues:

- Danish Superliga: `271`
- Scottish Premiership: `501`

Premier League is league id `8` and needs a paid plan or 14-day trial.

## First Real-Data Test

Use the free token first with one free league.

Environment:

```bash
SPORTMONKS_USE_MOCK=false
SPORTMONKS_TOKEN=your_token_here
```

Then create/approve a friends group subscribed to:

- `providerLeagueId: 501` for Scottish Premiership, or
- `providerLeagueId: 271` for Danish Superliga

## Low-Call Import Strategy

On admin approval of a friends group:

1. Resolve the current season for the selected league.
2. Import the season schedule from:

```text
GET /v3/football/schedules/seasons/{seasonId}
```

This should be preferred over repeatedly paging `/fixtures`, because it gives the full season schedule in fewer calls.

Implemented backend status:

- If `providerSeasonId` is provided, `hydrateLeagueSeason(providerLeagueId, providerSeasonId)` now uses `GET /v3/football/schedules/seasons/{seasonId}`.
- Verified with Scottish Premiership `501`, season `25598`: one schedule call returned 228 fixtures.
- If `providerSeasonId` is omitted, backend still falls back to upcoming fixture hydration for the next 45 days.

Use includes needed by our transformer/scoring:

```text
participants;scores;state;round;events
```

## Finished Results And Red Cards

Refresh finished fixtures near matchdays with:

```text
GET /v3/football/fixtures/between/{startDate}/{endDate}
```

Parameters:

```text
include=participants;scores;state;round;events
filters=fixtureLeagues:501
per_page=50
page=1
```

Notes:

- Date range max is 100 days.
- `per_page` max is 50.
- Must paginate until no more results.
- Red cards are detected from event type ids `20` and `21`.

## Live Later

For live match data:

```text
GET /v3/football/livescores/inplay
```

Parameters:

```text
include=participants;scores;state;round;events;periods
filters=fixtureLeagues:501,271
```

For polling updates:

```text
GET /v3/football/livescores/latest
```

SportMonks recommends polling every 5-8 seconds if rate limits allow.

Important: `/livescores/latest` only reports changes to core fixture fields, not every event. For chatbot/red-card push logic, use it as a signal, then fetch richer inplay/fixture data when needed.

Implemented live chat foundation:

- Goal/red-card events can be processed into `match_events` and group-specific `live_feed_events`.
- Messages are stored as history, not ephemeral chat only.
- Mock LLM generator is used for now.
- Submitted users are named when their prediction is affected.
- Groups with no submitted predictions still get generic match event messages without player names.
- Duplicate event protection uses `friends_group_id + event_key`.

## API Call Budget

Calls must be group/subscription based, not user based.

Expected behavior:

- Friend group creation: `0` SportMonks calls while request is pending.
- Admin approval with `providerSeasonId`: `1` SportMonks call to import the season schedule.
- Admin approval without `providerSeasonId`: fallback upcoming hydration, usually `1` call per 50 upcoming fixtures.
- User fixture browsing: `0` SportMonks calls; read from local DB.
- User predictions/submissions/scoring/history: `0` SportMonks calls; local DB only.
- Finished result refresh: one `/fixtures/between/{start}/{end}` pagination run per subscribed league set, not per user.
- Live match refresh later: one `/livescores/inplay` or `/livescores/latest` poll per interval for all active subscribed league ids, not per viewer/user.

If 100 users watch the same live match, SportMonks should still be called once per polling interval. The backend should fan out cached DB/live-feed updates to users.

## Cron Refresh Strategy

Implemented backend cron behavior:

- `0 3 * * *`: daily active subscription schedule refresh.
  - Reads active friends group subscriptions from DB.
  - Dedupes by `providerLeagueId + providerSeasonId`.
  - Hydrates each unique subscribed league/season once.
  - Catches postponed, cancelled, and rescheduled fixtures by upserting same `sm_fixture_id`.
- `0 */2 * * *`: recent finished refresh.
  - Reads active subscription league ids from DB.
  - Dedupes league ids.
  - Calls finished fixture refresh for the subscribed leagues.
  - Recalculates scores after refresh.

Important:

- Cron is disabled unless `CRON_ENABLED=true`.
- Cron calls are not per user.
- Normal fixture/prediction/leaderboard reads stay DB-only.

## Current Backend Fit

The current backend is close to ready for first real-data smoke:

- Auth via `api_token` is supported.
- League filters use `fixtureLeagues:<ids>`.
- Includes already match our transformer: `participants`, `scores`, `state`, `round`, `events`.
- Score mapping uses `description === "CURRENT"`.
- Red-card mapping uses event ids `20` and `21`.

Recommended future improvement:

- Change approval hydration to prefer `schedules/seasons/{seasonId}` for full-season import.
- Keep date-range refresh for recent finished fixtures.
- Keep live endpoints only for live match/chatbot phase.
