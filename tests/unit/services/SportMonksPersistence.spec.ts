import { SportMonksHydrationService } from "../../../src/integrations/sportmonks/hydration-service.js";
import { SportMonksLiveService } from "../../../src/integrations/sportmonks/live-service.js";
import type { Database } from "../../../src/integrations/supabase/types.js";
import type { Repositories } from "../../../src/repositories/index.js";
import type SportMonksService from "../../../src/integrations/sportmonks/service.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

type FixtureInsert = Database["public"]["Tables"]["fixtures"]["Insert"];

function fixture(smFixtureId: number): FixtureInsert {
  return {
    sm_fixture_id: smFixtureId,
    sm_league_id: 8,
    sm_season_id: 23614,
    home_team: "Arsenal",
    away_team: "Chelsea",
    match_date: "2026-08-01",
    match_time: "12:30:00",
    status: "scheduled",
  };
}

describe("SportMonks persistence services", () => {
  it("hydrates a league season through fixture repository upserts", async () => {
    const repositories = {
      fixtures: createRepositoryMock<
        Pick<Repositories["fixtures"], "upsertBySportMonksFixtureId">
      >(["upsertBySportMonksFixtureId"]),
      friendsGroupSubscriptions: createRepositoryMock<
        Pick<Repositories["friendsGroupSubscriptions"], "listActiveTargets">
      >(["listActiveTargets"]),
    };
    const sportMonks = {
      getFixturesByLeague: jest.fn().mockResolvedValue([fixture(1101)]),
    } as unknown as SportMonksService;
    const service = new SportMonksHydrationService(
      sportMonks,
      repositories as unknown as ConstructorParameters<typeof SportMonksHydrationService>[1]
    );

    await expect(service.hydrateLeagueSeason(8, 23614)).resolves.toEqual({
      fixturesSynced: 1,
    });
    expect(repositories.fixtures.upsertBySportMonksFixtureId).toHaveBeenCalledWith(
      [fixture(1101)],
      { batchSize: 800 }
    );
  });

  it("updates live fixture score through SportMonks and returns the DB snapshot", async () => {
    const repositories = {
      fixtures: createRepositoryMock<
        Pick<
          Repositories["fixtures"],
          | "findIdAndSportMonksFixtureId"
          | "findLiveSnapshot"
          | "listLiveOrdered"
          | "patchLiveRows"
          | "upsertBySportMonksFixtureId"
        >
      >([
        "findIdAndSportMonksFixtureId",
        "findLiveSnapshot",
        "listLiveOrdered",
        "patchLiveRows",
        "upsertBySportMonksFixtureId",
      ]),
    };
    repositories.fixtures.findIdAndSportMonksFixtureId.mockResolvedValue({
      id: 101,
      sm_fixture_id: 1101,
    });
    repositories.fixtures.findLiveSnapshot.mockResolvedValue({
      live_home_score: 1,
      live_away_score: 0,
      status: "live",
      current_minute: 27,
    });
    const sportMonks = {
      getFixtureById: jest.fn().mockResolvedValue({ fixture: fixture(1101) }),
    } as unknown as SportMonksService;
    const service = new SportMonksLiveService(
      sportMonks,
      repositories as unknown as ConstructorParameters<typeof SportMonksLiveService>[1]
    );

    await expect(service.getFixtureLiveScore(101)).resolves.toEqual({
      live_home_score: 1,
      live_away_score: 0,
      status: "live",
      current_minute: 27,
    });
    expect(repositories.fixtures.upsertBySportMonksFixtureId)
      .toHaveBeenCalledWith([fixture(1101)]);
  });
});
