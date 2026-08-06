import FriendsGroupSubscriptionService from "../../../src/services/FriendsGroupSubscriptionService.js";
import type { Database } from "../../../src/integrations/supabase/types.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

type SubscriptionRow =
  Database["public"]["Tables"]["friends_group_subscriptions"]["Row"];

function createService() {
    const repositories = {
      footballCompetitions: createRepositoryMock<
        Pick<
          Repositories["footballCompetitions"],
          "findByProviderLeagueId" | "listWithSeasons" | "upsertCompetition"
        >
      >(["findByProviderLeagueId", "listWithSeasons", "upsertCompetition"]),
    footballSeasons: createRepositoryMock<
      Pick<Repositories["footballSeasons"], "upsertSeason">
    >(["upsertSeason"]),
    friendsGroupSubscriptions: createRepositoryMock<
      Pick<
        Repositories["friendsGroupSubscriptions"],
        | "findActiveWithCatalog"
        | "findPendingByFriendsGroup"
        | "findPendingOrActiveId"
        | "insertSubscription"
        | "setPendingStatusForFriendsGroup"
        | "updateSubscriptionById"
      >
    >([
      "findActiveWithCatalog",
      "findPendingByFriendsGroup",
      "findPendingOrActiveId",
      "insertSubscription",
      "setPendingStatusForFriendsGroup",
      "updateSubscriptionById",
    ]),
  };

  repositories.footballCompetitions.upsertCompetition.mockResolvedValue({
    id: "competition-1",
    provider_league_id: 8,
    name: "Premier League",
  });
  repositories.footballSeasons.upsertSeason.mockResolvedValue({ id: "season-1" });
  repositories.friendsGroupSubscriptions.findPendingOrActiveId.mockResolvedValue(null);
  repositories.friendsGroupSubscriptions.insertSubscription.mockResolvedValue(
    subscriptionRow("subscription-1")
  );

  return {
    repositories,
    service: new FriendsGroupSubscriptionService(
      repositories as unknown as ConstructorParameters<typeof FriendsGroupSubscriptionService>[0]
    ),
  };
}

describe("FriendsGroupSubscriptionService", () => {
  it("creates a competition, season, and active friends-group subscription", async () => {
    const { repositories, service } = createService();

    const result = await service.subscribe({
      friendsGroupId: "group-1",
      createdBy: "user-a",
      providerLeagueId: 8,
      providerSeasonId: 23614,
      competitionName: "Premier League",
      seasonName: "2026/2027",
    });

    expect(result.competition.id).toBe("competition-1");
    expect(repositories.footballSeasons.upsertSeason).toHaveBeenCalledWith({
      competitionId: "competition-1",
      providerSeasonId: 23614,
      name: "2026/2027",
    });
    expect(repositories.friendsGroupSubscriptions.insertSubscription)
      .toHaveBeenCalledWith(expect.objectContaining({
        friends_group_id: "group-1",
        competition_id: "competition-1",
        season_id: "season-1",
        provider_league_id: 8,
        provider_season_id: 23614,
        status: "active",
      }));
  });

  it("updates an existing pending or active subscription", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupSubscriptions.findPendingOrActiveId.mockResolvedValue({
      id: "subscription-1",
    });
    repositories.friendsGroupSubscriptions.updateSubscriptionById.mockResolvedValue(
      subscriptionRow("subscription-1", { provider_season_id: 23615 })
    );

    await service.subscribe({
      friendsGroupId: "group-1",
      createdBy: "user-a",
      providerLeagueId: 8,
      providerSeasonId: 23615,
      competitionName: "Premier League",
    });

    expect(repositories.friendsGroupSubscriptions.updateSubscriptionById)
      .toHaveBeenCalledWith("subscription-1", expect.objectContaining({
        provider_season_id: 23615,
      }));
    expect(repositories.friendsGroupSubscriptions.insertSubscription)
      .not.toHaveBeenCalled();
  });

  it("reads catalog and pending/active subscription states", async () => {
    const { repositories, service } = createService();
    repositories.footballCompetitions.listWithSeasons.mockResolvedValue([]);
    repositories.friendsGroupSubscriptions.findPendingByFriendsGroup.mockResolvedValue(
      subscriptionRow("subscription-1", { status: "pending" })
    );
    repositories.friendsGroupSubscriptions.setPendingStatusForFriendsGroup
      .mockResolvedValue(subscriptionRow("subscription-1", { status: "active" }));

    await expect(service.listCompetitions()).resolves.toEqual([]);
    await expect(service.getPendingForFriendsGroup("group-1")).resolves
      .toMatchObject({ status: "pending" });
    await expect(service.setStatusForFriendsGroup("group-1", "active")).resolves
      .toMatchObject({ status: "active" });
  });

  it("syncs catalog competitions and current seasons without creating subscriptions", async () => {
    const { repositories, service } = createService();

    await service.syncCompetitionCatalog([
      {
        providerLeagueId: 501,
        providerSeasonId: 25598,
        competitionName: "Premiership",
        countryName: "Scotland",
        logoUrl: "https://cdn.sportmonks.com/images/soccer/leagues/501.png",
        seasonName: "2025/2026",
      },
    ]);

    expect(repositories.footballCompetitions.upsertCompetition).toHaveBeenCalledWith({
      providerLeagueId: 501,
      name: "Premiership",
      countryName: "Scotland",
      logoUrl: "https://cdn.sportmonks.com/images/soccer/leagues/501.png",
      currentProviderSeasonId: 25598,
    });
    expect(repositories.footballSeasons.upsertSeason).toHaveBeenCalledWith({
      competitionId: "competition-1",
      providerSeasonId: 25598,
      name: "2025/2026",
    });
    expect(repositories.friendsGroupSubscriptions.insertSubscription)
      .not.toHaveBeenCalled();
  });

  it("reads a competition with seasons by SportMonks league id", async () => {
    const { repositories, service } = createService();
    repositories.footballCompetitions.findByProviderLeagueId.mockResolvedValue({
      id: "competition-1",
      provider: "sportmonks",
      provider_league_id: 501,
      name: "Premiership",
      country_name: "Scotland",
      logo_url: null,
      current_provider_season_id: 25598,
      created_at: "2026-08-01T10:00:00Z",
      updated_at: "2026-08-01T10:00:00Z",
      seasons: [],
    });

    await expect(service.getCompetition(501)).resolves.toMatchObject({
      provider_league_id: 501,
      current_provider_season_id: 25598,
    });
  });
});

function subscriptionRow(
  id: string,
  overrides: Partial<SubscriptionRow> = {}
): SubscriptionRow {
  return {
    id,
    friends_group_id: "group-1",
    competition_id: "competition-1",
    season_id: "season-1",
    provider: "sportmonks",
    provider_league_id: 8,
    provider_season_id: 23614,
    status: "active",
    created_by: "user-a",
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}
