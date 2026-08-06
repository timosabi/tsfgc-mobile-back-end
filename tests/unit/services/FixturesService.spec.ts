import FixtureService from "../../../src/services/FixturesService.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

function createService() {
  const repositories = {
    fixtures: createRepositoryMock<
      Pick<
        Repositories["fixtures"],
        | "countAvailable"
        | "findFixtureForSubscription"
        | "insertFixtures"
        | "listAllOrdered"
        | "listForSubscription"
        | "listIdsByMatchweek"
        | "listByMatchweekWithStatuses"
        | "updateFixtureById"
      >
    >([
      "countAvailable",
      "findFixtureForSubscription",
      "insertFixtures",
      "listAllOrdered",
      "listForSubscription",
      "listIdsByMatchweek",
      "listByMatchweekWithStatuses",
      "updateFixtureById",
    ]),
    friendsGroupSubscriptions: createRepositoryMock<
      Pick<
        Repositories["friendsGroupSubscriptions"],
        "findActiveByFriendsGroup" | "listIdsForFriendsGroup"
      >
    >(["findActiveByFriendsGroup", "listIdsForFriendsGroup"]),
  };

  return {
    repositories,
    service: new FixtureService(
      repositories as unknown as ConstructorParameters<typeof FixtureService>[0]
    ),
  };
}

describe("FixtureService", () => {
  it("returns no group fixtures when the friends group has no active subscription", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupSubscriptions.findActiveByFriendsGroup.mockResolvedValue(null);

    await expect(service.getFixturesForCustomLeague("group-1")).resolves.toEqual([]);
    expect(repositories.fixtures.listForSubscription).not.toHaveBeenCalled();
  });

  it("loads fixtures through the active SportMonks subscription", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupSubscriptions.findActiveByFriendsGroup.mockResolvedValue({
      friends_group_id: "group-1",
      provider_league_id: 8,
      provider_season_id: 23614,
    });
    repositories.fixtures.listForSubscription.mockResolvedValue([]);

    await service.getFixturesForCustomLeague("group-1", "Matchweek 2");

    expect(repositories.fixtures.listForSubscription).toHaveBeenCalledWith({
      providerLeagueId: 8,
      providerSeasonId: 23614,
      matchweek: "Matchweek 2",
    });
  });

  it("updates and inserts fixtures through the repository", async () => {
    const { repositories, service } = createService();

    await service.setStatus({ fixtureId: 101, data: { status: "finished" } });
    await service.insertFixture({
      sm_fixture_id: 1101,
      sm_league_id: 8,
      home_team: "Arsenal",
      away_team: "Chelsea",
      match_date: "2026-08-01",
      match_time: "12:30:00",
    });

    expect(repositories.fixtures.updateFixtureById).toHaveBeenCalledWith(101, {
      status: "finished",
    });
    expect(repositories.fixtures.insertFixtures).toHaveBeenCalledWith(
      expect.objectContaining({ sm_fixture_id: 1101 })
    );
  });
});
