# FE Guide

Backend base URL:

```text
http://localhost:3001
```

Auth uses HTTP-only Supabase cookies. FE requests must send credentials:

```ts
fetch(url, {
  credentials: "include",
  headers: { "Content-Type": "application/json" },
});
```

Normal FE APIs read/write our backend DB. The FE must never call SportMonks or the LLM directly.

## Product Flow

1. User signs up/signs in.
2. User creates one friends group, chooses open/private access, and selects one football competition/season.
3. Backend auto-approves the group, activates subscription, adds creator as member, hydrates fixtures, and returns an invite token/link.
4. Open invite link joins immediately. Private invite link creates a join request for the group owner.
5. Owners can remove members or transfer ownership. Owners can only leave when they are the final member; that archives the group.
6. Members save one matchweek prediction slip: scores for every fixture plus exactly one red-card fixture.
7. Members can edit until the first fixture in the matchweek starts.
8. Members submit the slip.
9. FE reads the matchweek overview as the main dashboard/commentary snapshot.
10. Backend calculates scores after results are hydrated; old matchweek overviews become readonly history.

## Auth

### Sign Up

```http
POST /auth/sign-up
```

```json
{
  "email": "test@example.com",
  "password": "Password123!",
  "displayName": "George"
}
```

Sign-up automatically creates the profile row.

### Sign In

```http
POST /auth/sign-in
```

```json
{
  "email": "test@example.com",
  "password": "Password123!"
}
```

### Current User

```http
GET /auth/me
```

### Sign Out

```http
POST /auth/sign-out
```

Returns `204`.

## Competition Catalog

Use this for the create-group league select.

```http
GET /friends-groups/competitions
```

FE sends only `provider_league_id` as `providerLeagueId` when creating a
group. Backend owns current-season resolution.

Backend behavior: if the saved catalog is missing current season data, this
endpoint performs a lightweight SportMonks catalog sync for the configured
catalog leagues, stores `current_provider_season_id` and `seasons`, then
returns the refreshed DB rows. Normal repeated calls read from our DB.

## Friends Group Creation

A user can own only one friends group.

```http
POST /friends-groups
```

```json
{
  "payload": {
    "name": "George League",
    "slug": "george-league",
    "accessType": "open",
    "subscription": {
      "providerLeagueId": 501
    }
  }
}
```

`accessType` is either `open` or `private`.

Response includes:

```json
{
  "data": {
    "id": "friends-group-uuid",
    "status": "approved",
    "is_open": true,
    "invite_token": "unguessable-token"
  },
  "joinLink": "/join/unguessable-token",
  "subscription": {
    "status": "active"
  },
  "hydration": {
    "fixturesSynced": 6
  }
}
```

The creator is also inserted into group membership with `role: "owner"`. Invited users join with `role: "member"`.

### Check Slug

```http
GET /friends-groups/check-slug/:slug
```

Use this in the create-group form after the FE has produced a lowercase kebab-case slug.

```json
{
  "data": {
    "available": true
  }
}
```

Recommended FE behavior: debounce this while the user types for nicer UX, then still trust `POST /friends-groups` on submit. The create endpoint also validates duplicate slugs and returns `409` if the slug was taken after the last check.

### Active Subscription

```http
GET /friends-groups/:friendsGroupId/subscription
```

Use on group/settings screens to show which football competition/season powers the group.

## Invite Links And Membership

Use only the invite-token flow for joining.

### Preview Invite Link

```http
GET /friends-groups/invite/:inviteToken
```

Use for invite landing page. Returns group name, access type, and member count.

### Join By Invite Link

```http
POST /friends-groups/invite/:inviteToken/join
```

```json
{
  "message": "Let me in",
  "userDisplayName": "George"
}
```

Open group response:

```json
{
  "status": "joined",
  "friendsGroupId": "uuid"
}
```

Private group response:

```json
{
  "status": "requested",
  "friendsGroupId": "uuid"
}
```

### Owner Join Request Queue

```http
GET /friends-groups/:friendsGroupId/requests/pending
POST /friends-groups/requests/:requestId/approve
POST /friends-groups/requests/:requestId/reject
```

### User Group State

```http
GET /friends-groups/me/groups
GET /friends-groups/:friendsGroupId/request/status
DELETE /friends-groups/:friendsGroupId/leave
GET /friends-groups/:friendsGroupId/members
DELETE /friends-groups/:friendsGroupId/members/:userId
POST /friends-groups/:friendsGroupId/transfer-ownership
```

`GET /friends-groups/me/groups` is the normal group switcher/home state. It returns only active approved groups and includes `friends_group.invite_token`, `friends_group.joinLink`, and `friends_group.accessType` so invite UI survives reload/cache clear.

For richer group cards it also includes:

```json
{
  "score": {
    "user_id": "current-user-uuid",
    "fixtures_predicted": 50,
    "exact_score_points": 40,
    "correct_result_points": 30,
    "total_goals_bonus": 10,
    "red_card_bonus": 15,
    "points_earned": 95,
    "weeks_played": 11,
    "rank": 2
  },
  "friends_group": {
    "league": {
      "name": "Premier League",
      "providerLeagueId": 8,
      "providerSeasonId": 25583,
      "countryName": "England",
      "logoUrl": "https://...",
      "seasonName": "2025/2026"
    },
    "currentMatchweek": {
      "matchweek": "Matchweek 12",
      "weekNumber": 12,
      "state": "upcoming",
      "displayLabel": "Premier League week 12"
    }
  }
}
```

Use `friends_group.currentMatchweek.displayLabel` directly on the card, or render from `league.name` + `currentMatchweek.weekNumber`.
Use `score.points_earned` and `score.rank` for the current user's season/group total on the group card. This is not a matchweek score.

`DELETE /friends-groups/:friendsGroupId/leave` returns `data.status = "left"` for normal member leave. If the current user is owner and other members remain, it returns `409`; show UI to transfer ownership or remove members. If owner is the final member, it returns `data.status = "archived"` and the group disappears from normal group lists.

Owner member-management:

```http
GET /friends-groups/:friendsGroupId/members
```

Use this for the owner settings/member-management screen. It returns members with profile preview data plus `canRemove` and `canTransferOwnership` flags. It is owner-only. The matchweek overview still returns members for dashboard display, but owner actions should use this endpoint.

```json
POST /friends-groups/:friendsGroupId/transfer-ownership
{
  "newOwnerUserId": "member-user-uuid"
}
```

`DELETE /friends-groups/:friendsGroupId/members/:userId` removes a member. It is owner-only and cannot be used by an owner to remove themselves.

The matchweek overview endpoint below includes fixtures, members, scores, and live chat, so the FE should not stitch the dashboard together from separate fixture/profile/history endpoints.

## Matchweek Overview

Use this as the primary API for the swipeable matchweek dashboard and commentary screens.

### Current Matchweek Overview

```http
GET /friends-groups/:friendsGroupId/matchweeks/current/overview
```

Backend selects the current matchweek:

- live matchweek first
- otherwise earliest non-finished matchweek
- otherwise latest finished matchweek

### Specific Matchweek Overview

```http
GET /friends-groups/:friendsGroupId/matchweeks/:matchweek/overview
```

Use this when the user swipes to older/newer weeks.

Response includes:

- friends group metadata
- selected matchweek and previous/next/current navigation
- `locksAt` countdown target for the first kickoff in the selected matchweek
- state: `editable`, `locked`, `live`, or `finished`
- permissions for edit/submit/reveal/poll
- fixtures with status, score, minute, and red-card state
- current user prediction slip
- member profiles, submitted status, scores, and predictions when visible
- selected-matchweek score rows
- saved matchweek live chat

Overview score rows are compact and matchweek-only:

```json
{
  "scores": {
    "rows": [
      {
        "user_id": "user-uuid",
        "exact_score_points": 4,
        "correct_result_points": 2,
        "total_goals_bonus": 2,
        "red_card_bonus": 5,
        "points_earned": 13,
        "provisional": false,
        "rank": 1
      }
    ]
  }
}
```

There is no `scores.mine`. To show the current user's selected-matchweek score, find the row where `row.user_id === currentUser.id`. Season totals belong to `GET /friends-groups/me/groups` and the leaderboard endpoint, not overview.

Prediction reveal rules:

- before lock, only the current user's own slip is returned
- after the first fixture starts, submitted member predictions are visible
- use `locksAt` for the countdown, but hide edit/submit UI from `permissions.canEditPredictions` and `permissions.canSubmitPredictions`
- still treat backend lock errors as source of truth if the local countdown is stale
- live weeks return `permissions.shouldPoll: true`; FE should poll every 30-60 seconds

## Matchweek Prediction Slip

Use these endpoints for all FE prediction UI. The old separate `/predictions`, `/redCard`, and `/user-submission` APIs are no longer part of the mounted app surface.

### Get My Slip

```http
GET /friends-groups/:friendsGroupId/matchweeks/:matchweek/predictions/mine
```

Returns fixtures, saved scores, selected red-card fixture, `submitted`, and `locked`.

### Save My Slip

```http
PUT /friends-groups/:friendsGroupId/matchweeks/:matchweek/predictions/mine
```

```json
{
  "predictions": [
    {
      "fixtureId": 123,
      "homeScore": 2,
      "awayScore": 1
    },
    {
      "fixtureId": 124,
      "homeScore": 0,
      "awayScore": 0
    }
  ],
  "redCardFixtureId": 123
}
```

Rules:

- include every fixture in the matchweek
- scores are non-negative integers
- select exactly one red-card fixture
- editable only until the first fixture in the matchweek starts

### Submit My Slip

```http
POST /friends-groups/:friendsGroupId/matchweeks/:matchweek/predictions/mine/submit
```

Submit validates the full slip and marks it scoreable.

### Delete My Slip

```http
DELETE /friends-groups/:friendsGroupId/matchweeks/:matchweek/predictions/mine
```

Only works before matchweek lock.

## Scores And History

Keep FE scoring reads simple: use the overview endpoint for selected-matchweek history/current week screens, `GET /friends-groups/me/groups` for the current user's season score on group cards, and leaderboard for the standalone season standings screen.

Scoring rules shown in the UI:

- correct result: 1 point
- exact scoreline: 2 bonus points, so an exact score is 3 points total
- total goals scored: 2 bonus points for the nearest player(s) across the matchweek
- red-card prediction hit: 5 bonus points
- only submitted users are scored for that matchweek

### Leaderboard

```http
GET /weekly-score/:friendsGroupId/leaderboard
```

Older matchweek history, direct submitted-predictions, raw fixture reads, profile lookup helpers, and standalone live-feed reads were removed from the public API surface. Use the overview response instead.

## Profiles

```http
GET /profiles/id
PUT /profiles/id
```

## Local Mock Mode

```bash
SPORTMONKS_USE_MOCK=true
```

Mock data:

- Mock catalog supports `providerLeagueId=501` and `providerLeagueId=271`
- `Matchweek 2` starts scheduled
- internal `POST /admin/fixtures/hydrate/finished` flips `Matchweek 2` to finished
- internal `POST /weekly-score/:friendsGroupId/calculate` calculates scores

Internal SportMonks/scoring endpoints are backend-job APIs, not normal FE APIs.
