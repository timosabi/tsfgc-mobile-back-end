# Fixtures Game Backend

Express + Supabase backend for no-money football prediction game.

Users create a `friendsGroup`, subscribe it to one real football competition, predict fixture scores and red-card outcomes, then compare points across the season.

## Current Shape

- Custom group = `friendsGroup`
- Real football competition = SportMonks league/season
- One `friendsGroup` has one active subscription for now
- Schema allows future move toward more real competitions per group
- SportsMonks API should be called rarely:
  - on friends group creation, hydrate the selected season into DB
  - during live matches, refresh live score/event data
  - not on normal fixture/prediction reads

## Stack

- Node.js
- Express
- TypeScript, ESM
- Supabase Auth
- Supabase Postgres
- SportMonks football API
- Cookie auth

## Important Files

- [src/index.ts](/Users/georgestan/www/gfs-consulting/projects/fixtures-game-backend/src/index.ts): app entry + route mounts
- [supabase/migrations/20260505150000_initial_schema.sql](/Users/georgestan/www/gfs-consulting/projects/fixtures-game-backend/supabase/migrations/20260505150000_initial_schema.sql): fresh DB schema
- [src/integrations/sportmonks](/Users/georgestan/www/gfs-consulting/projects/fixtures-game-backend/src/integrations/sportmonks): SportMonks client, transform, hydration, live refresh
- [docs/bruno/fixtures-game-api](/Users/georgestan/www/gfs-consulting/projects/fixtures-game-backend/docs/bruno/fixtures-game-api): Bruno workspace, collection, and local environment

## Setup

```bash
npm install
cp .env.example .env
npm run build
npm run dev
```

Default API:

```text
http://localhost:3001
```

Health check:

```bash
curl http://localhost:3001/health
```

## Environment

Minimum local env:

```bash
PORT=3001
CORS_ORIGIN=http://localhost:8080

LOVABLE_SUPABASE_URL=http://127.0.0.1:54321
LOVABLE_SUPABASE_PUBLISHABLE_KEY=<local anon key>
LOVABLE_SUPABASE_SERVICE_ROLE_KEY=<local service role key>

SPORTMONKS_API_URL=https://api.sportmonks.com/v3/football
SPORTMONKS_TOKEN=
SPORTMONKS_PROVIDER_LEAGUE_IDS=271,501
SPORTMONKS_USE_MOCK=true
CRON_ENABLED=false
ADMIN_EMAILS=test@example.com
```

Legacy env names still accepted in some places:

```bash
SPORTMONKS_API_TOKEN=<token>
```

## SportMonks Mock Mode

Use mock mode until real SportMonks key exists:

```bash
SPORTMONKS_USE_MOCK=true
SPORTMONKS_TOKEN=
SPORTMONKS_API_TOKEN=
```

Mock mode does not call network. It returns deterministic Premier League fixtures:

- `Matchweek 1`: finished fixtures for history/leaderboard smoke
- `Matchweek 2`: scheduled fixtures for prediction smoke
- admin `hydrate finished` flips `Matchweek 2` mock fixtures to finished so scoring can be tested
- admin `live refresh` returns one mock live fixture

Recommended local smoke:

1. `npm run db:reset`
2. `npm run dev`
3. Bruno sign up/sign in
4. create friends group with `providerLeagueId=501` or `providerLeagueId=271`
5. join second user by invite link
6. read current or specific matchweek overview
7. save and submit a matchweek prediction slip
8. internal job runs `Hydrate finished`
9. internal job runs `Calculate all finished scores`
10. read overview and leaderboard

## Local Supabase

Best next step for prod-readiness: run local Supabase and reset DB from migration.

Requirements:

- Docker running
- Supabase CLI installed

Commands:

```bash
npm run supabase:start
npm run db:reset
```

After `supabase start`, copy local keys into `.env`:

```bash
LOVABLE_SUPABASE_URL=http://127.0.0.1:54321
LOVABLE_SUPABASE_PUBLISHABLE_KEY=<anon key from supabase start>
LOVABLE_SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase start>
```

Then:

```bash
npm run dev
```

Generate exact Supabase types after local DB is live:

```bash
npm run db:types
```

Note: current type file is intentionally light. Real generated types should replace it before prod.

## Bruno

Open this folder in Bruno:

- [docs/bruno/fixtures-game-api](/Users/georgestan/www/gfs-consulting/projects/fixtures-game-backend/docs/bruno/fixtures-game-api)

Select the `local` environment. The same environment file also exists inside the collection so teammates can open only:

- [docs/bruno/fixtures-game-api/collections/fixtures-game-backend](/Users/georgestan/www/gfs-consulting/projects/fixtures-game-backend/docs/bruno/fixtures-game-api/collections/fixtures-game-backend)

Flow:

1. Run `Auth / Sign up` or `Auth / Sign in`
2. Bruno stores Supabase cookies automatically
3. Run `Groups And Invites / Create friends group with subscription`
4. The create-group response script saves `friendsGroupId` and `inviteToken`
5. Read matchweek overview or fixtures for the group
6. Save and submit the matchweek prediction slip before fixture kickoff
7. Use backend/internal live, scoring, and hydration endpoints only for admin/local maintenance testing

Collection contains the FE-safe API requests plus backend/internal job requests for scoring, live refresh, and SportMonks hydration.

`POST /auth/sign-up` creates a `profiles` row automatically. If the signed-up email is listed in `ADMIN_EMAILS`, that profile is created with `is_admin=true`.

## DB Model

Core tables:

- `friends_groups`: custom friend group
- `friends_group_users`: membership
- `friends_group_join_requests`: join approval flow
- `football_competitions`: real SportMonks league metadata
- `football_seasons`: real SportMonks season metadata
- `friends_group_subscriptions`: group -> real competition/season
- `fixtures`: cached SportMonks fixtures
- `predictions`: score predictions
- `red_card_predictions`: red-card predictions
- `user_submissions`: weekly/group submission state
- `weekly_scores`: scoring totals
- `match_events`: match events
- `live_feed_events`: future AI/live push feed
- `notification_subscriptions`: future push subscriptions
- `profiles`: user profile/preferences/admin flag

Naming rule:

- Use `friendsGroupId` in API payloads/routes
- Use `friends_group_id` in DB
- User submissions are scoped by `friendsGroupId` + `matchweek`
- Use `providerLeagueId` / `provider_league_id` only for SportMonks real league
- Use `sm_league_id` only on cached fixtures

## SportMonks Notes

- Auth uses `api_token`.
- Local development can use `SPORTMONKS_USE_MOCK=true`.
- Fixture paging uses max `per_page=50`.
- Real league filtering uses `filters=fixtureLeagues:<ids>`.
- Admin approval/subscription hydration uses fixtures with `participants;scores;state;round;events`.
- Live refresh uses `/livescores/inplay` with same league filter.
- Current score comes from score rows where `description === "CURRENT"`.
- Red cards use SportMonks event type IDs `20` and `21`.
- Fixture date/time stays aligned to raw SportMonks `starting_at`.

## Main Routes

### Auth

```text
GET    /auth/me
POST   /auth/sign-up
POST   /auth/sign-in
POST   /auth/sign-out
GET    /auth/callback
DELETE /auth/me
```

### Friends Groups

Mounted at `/friends-groups`.

```text
POST   /
GET    /check-slug/:slug
GET    /competitions                        # FE competition dropdown; self-syncs missing current seasons
```

`GET /check-slug/:slug` returns `{ "data": { "available": boolean } }` for create-form validation. Use it as a debounced UX check, but keep `POST /friends-groups` as the source of truth; create returns `409` if a slug is already taken.

Create friends group with subscription:

```json
{
  "payload": {
    "name": "George League",
    "slug": "george-league",
    "is_open": true,
    "subscription": {
      "providerLeagueId": 271
    }
  }
}
```

Creation auto-approves the friends group, activates the subscription, adds the creator as owner/member, and hydrates fixtures. Users can own one friends group and join many.

### Friends Group Membership

Mounted at `/friends-groups`.

```text
GET    /invite/:inviteToken
POST   /invite/:inviteToken/join
DELETE /:friendsGroupId/leave
GET    /:friendsGroupId/members
DELETE /:friendsGroupId/members/:userId
POST   /:friendsGroupId/transfer-ownership
GET    /me/groups
```

Open invite links join immediately. Private invite links create a join request for the group owner.
`GET /me/groups` includes each group's `invite_token` and `joinLink`, so the FE can rebuild share/invite UI after reload or cache clear. It also includes `friends_group.league`, `friends_group.currentMatchweek`, and the current user's cumulative season `score` so group cards can show labels like `Premier League week 12` plus the user's season total/rank.
`GET /:friendsGroupId/members` is the owner settings read for member-management UI. Owners can remove members, transfer ownership to an existing member, and leave only when they are the final member. Final-owner leave archives the group, preserves history, hides it from normal group lists, and frees the owner to create another group.

### Join Requests

Mounted at `/friends-groups`.

```text
GET    /:friendsGroupId/request/status
POST   /requests/:requestId/approve
POST   /requests/:requestId/reject
GET    /:friendsGroupId/requests/pending
```

Group owner can approve/reject private-group join requests. Approval inserts membership.

### Matchweek Overview

Mounted at `/friends-groups`.

```text
GET    /:friendsGroupId/matchweeks/current/overview
GET    /:friendsGroupId/matchweeks/:matchweek/overview
```

This is the main FE dashboard/commentary read. It returns fixtures, current user's prediction slip, revealed member predictions after lock, compact selected-matchweek score rows, members, navigation, permissions, saved live feed, and `locksAt` for the countdown to prediction lock. It does not return season totals or leaderboard data; use `/me/groups` for group-card season score and `/weekly-score/:friendsGroupId/leaderboard` for standings.

### Prediction Slip

Mounted at `/friends-groups`.

```text
GET    /:friendsGroupId/matchweeks/:matchweek/predictions/mine
PUT    /:friendsGroupId/matchweeks/:matchweek/predictions/mine
POST   /:friendsGroupId/matchweeks/:matchweek/predictions/mine/submit
DELETE /:friendsGroupId/matchweeks/:matchweek/predictions/mine
```

The slip combines score predictions for every fixture in the matchweek plus exactly one red-card fixture pick. Users can edit until the first fixture in that matchweek starts.

## MVP Readiness

Implemented for first FE build:

- user sign up/sign in/sign out/me
- friend group creation with active SportMonks subscription
- fixture hydration on creation only
- competition catalog endpoint backed by seed data
- creator auto-added as owner/member on creation
- open invite-link join
- private/group join request approval
- matchweek overview reads from local DB, not SportMonks
- unified matchweek prediction slip with exactly one red-card pick
- automatic scoring from finished fixtures
- matchweek history, saved live chat, and season leaderboard
- live refresh endpoint calls SportMonks only when admin/worker triggers it

Not complete yet:

- real AI provider and push delivery
- rate limiting

Scoring rules:

- correct result: 1 point
- exact scoreline: 2 bonus points, so an exact score is 3 points total
- total goals scored: 2 bonus points for the nearest player(s) across the matchweek
- red-card prediction hit: 5 bonus points
- only submitted users are scored for that matchweek

### Profiles

```text
GET    /profiles/id
PUT    /profiles/id
```

### Scores, Submissions, Events

```text
GET    /weekly-score/:friendsGroupId/leaderboard

POST   /weekly-score/:friendsGroupId/calculate      # internal job/admin
POST   /weekly-score/calculate-all                  # internal job/admin
POST   /weekly-score/upsert                         # internal maintenance

POST   /match-event                                 # internal maintenance
POST   /fixtures/live/refresh                       # internal job/admin
```

### Admin Hydration

Mounted at `/admin`. Admin profile required.

```text
POST /admin/fixtures/hydrate/full
POST /admin/fixtures/hydrate/matchweek
POST /admin/fixtures/hydrate/upcoming
POST /admin/fixtures/hydrate/finished
POST /admin/fixtures/hydrate/range
POST /admin/fixtures/hydrate/league-season
```

## Prod Readiness Checklist

Next work, priority order:

1. Local Supabase smoke
   - run `supabase start`
   - run `supabase db reset`
   - sign up user
   - create admin profile
   - create friends group + subscription
   - confirm fixtures hydrate once

2. Bruno smoke
   - open included workspace/collection and select `local`
   - run happy path locally
   - verify negative cases: unauth, non-member prediction, bad fixture, non-admin live refresh

3. SportMonks real-token smoke
   - set token
   - create Premier League test group
   - verify fixtures hydrate once
   - verify normal FE reads do not call SportMonks

4. Expand automated coverage
   - keep `npm run test:e2e` as the required happy-path gate
   - keep `npm run test:season` as the end-of-season scoring/load gate
   - add smaller unit tests only around high-risk scoring edge cases

5. Live feed work
   - poll only active live fixtures
   - store deduped `live_feed_events`
   - generate AI message from event + group predictions
   - push to subscribed devices

6. Production hardening
   - rate limit auth/write endpoints
   - validate request payloads with schema lib
   - structured logging
   - request IDs
   - error monitoring
   - cron disabled by default unless env enables it
   - CORS locked to FE domain
   - secure cookie domain configured

## Verification

Current local checks:

```bash
npm run build
npm run test:cron
npm run test:live
npm run test:e2e
npm run test:season
npm test
git diff --check
```

E2E test commands:

- `npm run test:cron` verifies active subscription refresh stays league/season based, dedupes duplicate friendGroup subscriptions, catches postponed/rescheduled fixture updates, and refreshes recent finished fixtures by league rather than by user.
- `npm run test:live` verifies goal/red-card live chat history with mock LLM, prediction-aware names, generic no-prediction messages, and duplicate event protection.
- `npm run test:e2e` runs targeted API stories for friends group creation/joining, prediction slips, scoring/leaderboard, matchweek overview, and a cross-group season flow.
- `npm run test:season` generates a full 380-fixture season with 10 friendGroups, 30 users per group, 114,000 predictions, and verifies weekly scores, cumulative points, leaderboard totals, and history-scale reads.

Known gap:

- `npm test` still runs the Jest placeholder suite
- `npm run lint` cannot run until `eslint` dependency/config exists
