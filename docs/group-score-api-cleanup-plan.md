# Group Score API Cleanup Plan

## Goal

Separate matchweek data from group/season data so the frontend has a cleaner contract:

- Matchweek overview returns only data for the selected matchweek.
- Group list/detail APIs return group-level and season-level summary data.
- The frontend can identify the current user's score row by `user_id`, so the overview does not need a duplicate `scores.mine` object.

## Current Problem

`GET /friends-groups/:friendsGroupId/matchweeks/:matchweek/overview` currently returns:

```json
{
  "scores": {
    "mine": {
      "points_earned": 22,
      "group_points": 242
    },
    "rows": []
  },
  "leaderboard": []
}
```

This is confusing because:

- `scores.mine.points_earned` is matchweek-only.
- `scores.mine.group_points` is cumulative season/group total.
- `leaderboard` is season-wide, not matchweek-only.
- `mine` duplicates data that already exists in `scores.rows`.

## Target API Shape

### Matchweek Overview

Endpoints:

- `GET /friends-groups/:friendsGroupId/matchweeks/current/overview`
- `GET /friends-groups/:friendsGroupId/matchweeks/:matchweek/overview`

Keep this response focused on the selected matchweek only.

Change `scores` to:

```json
{
  "scores": {
    "rows": [
      {
        "user_id": "uuid",
        "exact_score_points": 10,
        "correct_result_points": 5,
        "total_goals_bonus": 2,
        "red_card_bonus": 5,
        "points_earned": 22,
        "provisional": false,
        "rank": 1
      }
    ]
  }
}
```

Remove from matchweek overview:

- `scores.mine`
- `scores.rows[].friends_group_id`
- `scores.rows[].week_number`
- `scores.rows[].fixtures_predicted`
- `scores.rows[].group_points`
- top-level `leaderboard`
- any other season/global-only score fields

Reason:

- `friendsGroupId` is already known from the route and `friendsGroup`.
- `week_number` is already represented by `selectedMatchweek`.
- prediction/submission state already exists in `myPrediction`, `members[].prediction`, and `members[].submitted`.
- matchweek score rows should be compact UI score breakdowns, not database row shapes.

Frontend behavior:

- To show the current user score for the selected matchweek, find:
  - `scores.rows.find(row => row.user_id === currentUser.id)`
- If no row exists, show zero/not submitted state based on prediction/submission data.

### Overview Deduplication Pass

Before implementing, review the full matchweek overview schema and remove duplicated keys where another top-level section already owns that information.

Keep these ownership rules:

- `friendsGroup` owns group identity and metadata.
- `selectedMatchweek` and `locksAt` own selected week and lock timing.
- `fixtures` owns fixture identity, fixture status, teams, kickoff, score, minute, and red-card state.
- `myPrediction` owns the current user's prediction slip.
- `members` owns member identity, profile, role, submitted state, and optionally visible member prediction.
- `scores.rows` owns only selected-matchweek score breakdown values per user.
- Group/season totals belong in `GET /friends-groups/me/groups` or the dedicated leaderboard endpoint, not overview.

Candidate fields to remove from overview score rows:

- `friends_group_id`
- `week_number`
- `fixtures_predicted`
- `group_points`

Candidate fields to keep in overview score rows:

- `user_id`
- `exact_score_points`
- `correct_result_points`
- `total_goals_bonus`
- `red_card_bonus`
- `points_earned`
- `provisional`
- `rank`

If `rank` is kept, it means selected-matchweek rank only.

### My Groups

Endpoint:

- `GET /friends-groups/me/groups`

Add season/group-level scoring summary here, because this endpoint powers group cards and group switching.

Each returned group should include a season score summary for the current user using a similar shape, but with season totals instead of matchweek values:

```json
{
  "id": "friends-group-id",
  "name": "Los Muchachos",
  "role": "owner",
  "subscription": {
    "competitionName": "Premier League",
    "currentMatchweek": "Matchweek 12"
  },
  "score": {
    "user_id": "uuid",
    "friends_group_id": "uuid",
    "fixtures_predicted": 50,
    "exact_score_points": 40,
    "correct_result_points": 30,
    "total_goals_bonus": 10,
    "red_card_bonus": 15,
    "points_earned": 95,
    "rank": 2,
    "weeks_played": 11
  }
}
```

Meaning:

- `score.points_earned` is the user's season total inside this friends group.
- `score.rank` is the user's season rank inside this friends group.
- `score.weeks_played` is how many scored matchweeks contributed to the total.

## Implementation Tasks

1. Update `MatchweekOverviewService`.
   - Remove `mine` from `scores`.
   - Replace overview score rows with a compact DTO, not the persisted weekly score DB row.
   - Remove duplicated score fields from overview rows: `friends_group_id`, `week_number`, `fixtures_predicted`, and `group_points`.
   - Remove top-level `leaderboard` from overview.
   - Keep `members[].score` matchweek-only as well, or remove cumulative fields from it.
   - Run a full overview schema deduplication pass before coding so no DB-row-shaped objects leak into FE-facing overview data.

2. Update group list scoring.
   - Extend `GET /friends-groups/me/groups` to include current user's season score summary per group.
   - Reuse existing weekly score aggregation logic where possible.
   - Include `rank` so group cards can show position without calling leaderboard separately.

3. Keep dedicated leaderboard endpoint.
   - `GET /weekly-score/:friendsGroupId/leaderboard` remains the full group season leaderboard.
   - FE uses it for a dedicated standings screen.

4. Update types and DTOs.
   - Create separate DTOs for matchweek score row and season score summary.
   - Avoid reusing the same DTO for both matchweek and season data.

5. Update Bruno and OpenAPI docs.
   - Matchweek overview docs must say scores are selected-matchweek only.
   - My groups docs must say score fields are season totals.
   - Remove `leaderboard` from overview schema.
   - Add group score summary schema.

6. Update `fe_guide.md`.
   - Document where FE should read matchweek score vs group/season score.
   - Add examples for current user lookup from `scores.rows`.

## Test Plan

Add or update tests for:

- Matchweek overview does not return `scores.mine`.
- Matchweek overview `scores.rows` includes current user when they have a score.
- Matchweek overview score rows do not include `friends_group_id`, `week_number`, `fixtures_predicted`, or `group_points`.
- Matchweek overview does not return top-level `leaderboard`.
- `GET /friends-groups/me/groups` returns the current user's season score summary per group.
- Group score summary totals match accumulated weekly score rows.
- Group score summary rank matches leaderboard rank.
- Existing leaderboard endpoint still returns full season leaderboard.

Run:

```bash
npm run build
npm run test:unit
npm run test:overview
npm run test:all
```

## Notes

This is a breaking API cleanup. No backwards compatibility needed unless the frontend has already shipped against the old shape.
