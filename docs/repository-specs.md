# Repository Specs And Migration Tracker

## Goal

Move backend data access toward:

```text
Controller -> Service -> Repository -> Supabase
```

This tracker is the source of truth for the repository refactor. Update it after every repository, spec, or service migration so the remaining work is always clear.

## Architecture Target

- Controllers handle HTTP request/response concerns only.
- Services own business rules and orchestration.
- Repositories own Supabase table access.
- Production services/controllers should not call `supabase.from(...)` once migration is complete.
- E2E tests may keep direct Supabase access for fixture setup and cleanup.

## Task Checklist

1. [x] Add test infrastructure for unit/component specs.
2. [x] Add mocked Supabase query builder helper.
3. [x] Add repository mock helper for service tests.
4. [x] Add repository base types and factory.
5. [x] Create one repository per DB table.
6. [x] Add one `RepositoryName.spec.ts` per repository.
7. [x] Migrate prediction/scoring services first.
8. [x] Add `PredictionSlipService.spec.ts` and `WeeklyScoreService.spec.ts`.
9. [x] Migrate matchweek overview service.
10. [x] Add `MatchweekOverviewService.spec.ts`.
11. [x] Migrate friends group services.
12. [x] Add specs for friends group services.
13. [x] Migrate fixture/profile/match event services.
14. [x] Add specs for those services.
15. [x] Migrate live feed and SportMonks persistence services.
16. [x] Add specs for live feed and integration persistence behavior.
17. [x] Remove remaining direct `supabase.from(...)` from production services/controllers.
18. [x] Run full verification suite.

## Repository Specs

- [x] `FixturesRepository.spec.ts`
- [x] `FootballCompetitionsRepository.spec.ts`
- [x] `FootballSeasonsRepository.spec.ts`
- [x] `FriendsGroupsRepository.spec.ts`
- [x] `FriendsGroupUsersRepository.spec.ts`
- [x] `FriendsGroupJoinRequestsRepository.spec.ts`
- [x] `FriendsGroupSubscriptionsRepository.spec.ts`
- [x] `PredictionsRepository.spec.ts`
- [x] `RedCardPredictionsRepository.spec.ts`
- [x] `UserSubmissionsRepository.spec.ts`
- [x] `WeeklyScoresRepository.spec.ts`
- [x] `ProfilesRepository.spec.ts`
- [x] `MatchEventsRepository.spec.ts`
- [x] `LiveFeedEventsRepository.spec.ts`
- [x] `NotificationSubscriptionsRepository.spec.ts`

## Service Specs

- [x] `PredictionSlipService.spec.ts`
- [x] `WeeklyScoreService.spec.ts`
- [x] `MatchweekOverviewService.spec.ts`
- [x] `FriendsGroupService.spec.ts`
- [x] `FriendsGroupUsersService.spec.ts`
- [x] `FriendsGroupJoinRequestService.spec.ts`
- [x] `FriendsGroupSubscriptionService.spec.ts`
- [x] `FixturesService.spec.ts`
- [x] `ProfileService.spec.ts`
- [x] `MatchEventService.spec.ts`
- [x] `LiveFeedService.spec.ts`
- [x] `SportMonksPersistence.spec.ts`

## Migration Order

1. Repository test infrastructure and mocked Supabase helpers.
2. Repository base types, repository factory, and one repository per table.
3. Repository specs for every table repository.
4. Prediction and scoring service migration.
5. Matchweek overview service migration.
6. Friends group service migration.
7. Fixture, profile, and match event service migration.
8. Live feed and SportMonks persistence migration.
9. Final direct DB access cleanup and verification.

## Completion Criteria

- [x] `docs/repository-specs.md` is updated after every repository/service migration.
- [x] Every repository has a matching `.spec.ts`.
- [x] Every migrated service has a matching `.spec.ts`.
- [x] Production services/controllers no longer call `supabase.from(...)`.
- [x] Existing E2E tests pass after each migration batch.
- [x] Final verification suite passes:
  - `npm run build`
  - `npm run test:e2e`
  - `npm run test:live`
  - `npm run test:cron`
  - `npm run test:season`
  - `npm run test:overview`
