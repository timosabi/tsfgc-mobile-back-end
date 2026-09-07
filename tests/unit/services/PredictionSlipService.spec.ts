import PredictionSlipService from "../../../src/services/PredictionSlipService.js";
import type { Database } from "../../../src/integrations/supabase/types.js";
import type { MatchweekFixtureRow } from "../../../src/repositories/FixturesRepository.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

type PredictionRow = Database["public"]["Tables"]["predictions"]["Row"];
type RedCardPredictionRow =
  Database["public"]["Tables"]["red_card_predictions"]["Row"];

const futureFixtures: MatchweekFixtureRow[] = [
  {
    id: 101,
    home_team: "Arsenal",
    away_team: "Chelsea",
    home_score: null,
    away_score: null,
    has_red_card: null,
    status: "scheduled",
    match_date: "2099-08-10",
    match_time: "12:30:00",
    starting_at: "2099-08-10T12:30:00Z",
    matchweek: "Matchweek 2",
  },
  {
    id: 102,
    home_team: "Brentford",
    away_team: "Brighton",
    home_score: null,
    away_score: null,
    has_red_card: null,
    status: "scheduled",
    match_date: "2099-08-11",
    match_time: "15:00:00",
    starting_at: "2099-08-11T15:00:00Z",
    matchweek: "Matchweek 2",
  },
];

const lockedFixtures: MatchweekFixtureRow[] = futureFixtures.map((fixture) => ({
  ...fixture,
  starting_at: "2020-08-10T12:30:00Z",
}));

function createService(fixtures = futureFixtures) {
  const repositories = {
    fixtures: createRepositoryMock<
      Pick<Repositories["fixtures"], "listMatchweekFixtures" | "listOpenMatchweeks">
    >(["listMatchweekFixtures", "listOpenMatchweeks"]),
    friendsGroupSubscriptions: createRepositoryMock<
      Pick<Repositories["friendsGroupSubscriptions"], "findActiveByFriendsGroup">
    >(["findActiveByFriendsGroup"]),
    friendsGroupUsers: createRepositoryMock<
      Pick<Repositories["friendsGroupUsers"], "listForUser">
    >(["listForUser"]),
    liveFeedEvents: createRepositoryMock<
      Pick<Repositories["liveFeedEvents"], "listByGroupMatchweekWithFixture">
    >(["listByGroupMatchweekWithFixture"]),
    predictions: createRepositoryMock<
      Pick<
        Repositories["predictions"],
        | "deleteByUserGroupFixtures"
        | "insertPredictions"
        | "listByGroupFixturesUsers"
      >
    >(["deleteByUserGroupFixtures", "insertPredictions", "listByGroupFixturesUsers"]),
    profiles: createRepositoryMock<Pick<Repositories["profiles"], "listPreviewsByIds">>([
      "listPreviewsByIds",
    ]),
    redCardPredictions: createRepositoryMock<
      Pick<
        Repositories["redCardPredictions"],
        | "deleteByUserGroupFixtures"
        | "insertPrediction"
        | "listByGroupFixturesUsers"
      >
    >(["deleteByUserGroupFixtures", "insertPrediction", "listByGroupFixturesUsers"]),
    userSubmissions: createRepositoryMock<
      Pick<
        Repositories["userSubmissions"],
        | "deleteByUserGroupMatchweek"
        | "findByUserGroupMatchweek"
        | "listSubmittedUsers"
        | "upsertSubmission"
      >
    >([
      "deleteByUserGroupMatchweek",
      "findByUserGroupMatchweek",
      "listSubmittedUsers",
      "upsertSubmission",
    ]),
    weeklyScores: createRepositoryMock<
      Pick<Repositories["weeklyScores"], "listByGroupPaginated" | "listByGroupWeek">
    >(["listByGroupPaginated", "listByGroupWeek"]),
  };

  repositories.friendsGroupSubscriptions.findActiveByFriendsGroup.mockImplementation(
    async (friendsGroupId: string) => {
      if (friendsGroupId === "group-1") {
        return { friends_group_id: "group-1", provider_league_id: 8, provider_season_id: 23614 };
      }
      return null;
    }
  );
  repositories.friendsGroupUsers.listForUser.mockResolvedValue([]);
  repositories.fixtures.listMatchweekFixtures.mockResolvedValue(fixtures);
  repositories.fixtures.listOpenMatchweeks.mockResolvedValue(["Matchweek 2"]);
  repositories.predictions.listByGroupFixturesUsers.mockResolvedValue([]);
  repositories.redCardPredictions.listByGroupFixturesUsers.mockResolvedValue([]);
  repositories.userSubmissions.findByUserGroupMatchweek.mockResolvedValue(null);
  repositories.userSubmissions.listSubmittedUsers.mockResolvedValue([]);
  repositories.profiles.listPreviewsByIds.mockResolvedValue([]);
  repositories.weeklyScores.listByGroupWeek.mockResolvedValue([]);
  repositories.liveFeedEvents.listByGroupMatchweekWithFixture.mockResolvedValue([]);

  return {
    repositories,
    service: new PredictionSlipService(
      repositories as unknown as ConstructorParameters<typeof PredictionSlipService>[0]
    ),
  };
}

describe("PredictionSlipService", () => {
  it("saves one full matchweek slip with exactly one red-card fixture", async () => {
    const { repositories, service } = createService();

    await service.saveMine({
      userId: "user-a",
      friendsGroupId: "group-1",
      matchweek: "Matchweek 2",
      payload: {
        predictions: [
          { fixtureId: 101, homeScore: 2, awayScore: 1 },
          { fixtureId: 102, homeScore: 0, awayScore: 0 },
        ],
        redCardFixtureId: 101,
      },
    });

    expect(repositories.predictions.deleteByUserGroupFixtures).toHaveBeenCalledWith(
      "user-a",
      "group-1",
      [101, 102]
    );
    expect(repositories.predictions.insertPredictions).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: "user-a",
        friends_group_id: "group-1",
        fixture_id: 101,
        home_score_prediction: 2,
        away_score_prediction: 1,
      }),
      expect.objectContaining({
        user_id: "user-a",
        friends_group_id: "group-1",
        fixture_id: 102,
        home_score_prediction: 0,
        away_score_prediction: 0,
      }),
    ]);
    expect(repositories.redCardPredictions.insertPrediction).toHaveBeenCalledWith({
      user_id: "user-a",
      friends_group_id: "group-1",
      fixture_id: 101,
    });
  });

  it("rejects slips without exactly one red-card fixture", async () => {
    const { repositories, service } = createService();

    await expect(
      service.saveMine({
        userId: "user-a",
        friendsGroupId: "group-1",
        matchweek: "Matchweek 2",
        payload: {
          predictions: [
            { fixtureId: 101, homeScore: 2, awayScore: 1 },
            { fixtureId: 102, homeScore: 0, awayScore: 0 },
          ],
          redCardFixtureIds: [],
        },
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(repositories.predictions.insertPredictions).not.toHaveBeenCalled();
  });

  it("blocks editing once the matchweek has started", async () => {
    const { repositories, service } = createService(lockedFixtures);

    await expect(
      service.saveMine({
        userId: "user-a",
        friendsGroupId: "group-1",
        matchweek: "Matchweek 2",
        payload: {
          predictions: [
            { fixtureId: 101, homeScore: 2, awayScore: 1 },
            { fixtureId: 102, homeScore: 0, awayScore: 0 },
          ],
          redCardFixtureId: 101,
        },
      })
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(repositories.predictions.insertPredictions).not.toHaveBeenCalled();
  });

  it("blocks access to a matchweek that isn't open yet", async () => {
    const { repositories, service } = createService();
    repositories.fixtures.listOpenMatchweeks.mockResolvedValue(["Matchweek 1"]);

    await expect(
      service.saveMine({
        userId: "user-a",
        friendsGroupId: "group-1",
        matchweek: "Matchweek 2",
        payload: {
          predictions: [
            { fixtureId: 101, homeScore: 2, awayScore: 1 },
            { fixtureId: 102, homeScore: 0, awayScore: 0 },
          ],
          redCardFixtureId: 101,
        },
      })
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(repositories.predictions.insertPredictions).not.toHaveBeenCalled();
  });

  it("hides other members' predictions before lock and reveals them after lock", async () => {
    const { repositories, service } = createService();
    const predictionRows: PredictionRow[] = [
      predictionRow("user-a", 101, 2, 1),
      predictionRow("user-b", 101, 0, 0),
    ];
    const redCardRows: RedCardPredictionRow[] = [
      redCardRow("user-a", 101),
      redCardRow("user-b", 102),
    ];

    repositories.userSubmissions.listSubmittedUsers.mockResolvedValue([
      { user_id: "user-a", submitted_at: "2099-08-01T10:00:00Z" },
      { user_id: "user-b", submitted_at: "2099-08-01T10:01:00Z" },
    ]);
    repositories.predictions.listByGroupFixturesUsers.mockResolvedValue(predictionRows);
    repositories.redCardPredictions.listByGroupFixturesUsers.mockResolvedValue(redCardRows);

    const beforeLock = await service.getAll({
      friendsGroupId: "group-1",
      matchweek: "Matchweek 2",
      requestingUserId: "user-a",
    });

    expect(beforeLock.users.find((user) => user.userId === "user-a")?.predictions).toHaveLength(1);
    expect(beforeLock.users.find((user) => user.userId === "user-b")?.predictions).toEqual([]);

    repositories.fixtures.listMatchweekFixtures.mockResolvedValue(lockedFixtures);
    const afterLock = await service.getAll({
      friendsGroupId: "group-1",
      matchweek: "Matchweek 2",
      requestingUserId: "user-a",
    });

    expect(afterLock.users.find((user) => user.userId === "user-b")?.predictions).toHaveLength(1);
    expect(afterLock.users.find((user) => user.userId === "user-b")?.redCardFixtureId).toBe(102);
  });

  it("getMine reports no import suggestion when no other matching-group submission exists", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-2", "Group Two", "approved"),
    ]);
    repositories.friendsGroupSubscriptions.findActiveByFriendsGroup.mockImplementation(
      async (friendsGroupId: string) => {
        if (friendsGroupId === "group-1") {
          return { friends_group_id: "group-1", provider_league_id: 8, provider_season_id: 23614 };
        }
        if (friendsGroupId === "group-2") {
          return { friends_group_id: "group-2", provider_league_id: 8, provider_season_id: 23614 };
        }
        return null;
      }
    );
    repositories.userSubmissions.findByUserGroupMatchweek.mockResolvedValue(null);

    const result = await service.getMine({
      userId: "user-a",
      friendsGroupId: "group-1",
      matchweek: "Matchweek 2",
    });

    expect(result.importSuggestion).toBeNull();
  });

  it("getMine surfaces the matching group's submission as an import suggestion", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-2", "Group Two", "approved"),
    ]);
    repositories.friendsGroupSubscriptions.findActiveByFriendsGroup.mockImplementation(
      async (friendsGroupId: string) => {
        if (friendsGroupId === "group-1") {
          return { friends_group_id: "group-1", provider_league_id: 8, provider_season_id: 23614 };
        }
        if (friendsGroupId === "group-2") {
          return { friends_group_id: "group-2", provider_league_id: 8, provider_season_id: 23614 };
        }
        return null;
      }
    );
    repositories.userSubmissions.findByUserGroupMatchweek.mockImplementation(
      async (_userId: string, friendsGroupId: string) => {
        if (friendsGroupId === "group-2") {
          return { id: "sub-group-2", user_id: "user-a", friends_group_id: "group-2", matchweek: "Matchweek 2", submitted_at: "2099-08-01T10:00:00Z" };
        }
        return null;
      }
    );

    const result = await service.getMine({
      userId: "user-a",
      friendsGroupId: "group-1",
      matchweek: "Matchweek 2",
    });

    expect(result.importSuggestion).toEqual({
      friendsGroupId: "group-2",
      friendsGroupName: "Group Two",
      submittedAt: "2099-08-01T10:00:00Z",
    });
  });

  it("getMine picks the most recently submitted among multiple matching groups", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-2", "Group Two", "approved"),
      membershipRow("group-3", "Group Three", "approved"),
    ]);
    repositories.friendsGroupSubscriptions.findActiveByFriendsGroup.mockImplementation(
      async (friendsGroupId: string) => {
        if (["group-1", "group-2", "group-3"].includes(friendsGroupId)) {
          return { friends_group_id: friendsGroupId, provider_league_id: 8, provider_season_id: 23614 };
        }
        return null;
      }
    );
    repositories.userSubmissions.findByUserGroupMatchweek.mockImplementation(
      async (_userId: string, friendsGroupId: string) => {
        if (friendsGroupId === "group-2") {
          return { id: "sub-group-2", user_id: "user-a", friends_group_id: "group-2", matchweek: "Matchweek 2", submitted_at: "2099-08-01T10:00:00Z" };
        }
        if (friendsGroupId === "group-3") {
          return { id: "sub-group-3", user_id: "user-a", friends_group_id: "group-3", matchweek: "Matchweek 2", submitted_at: "2099-08-02T10:00:00Z" };
        }
        return null;
      }
    );

    const result = await service.getMine({
      userId: "user-a",
      friendsGroupId: "group-1",
      matchweek: "Matchweek 2",
    });

    expect(result.importSuggestion?.friendsGroupId).toBe("group-3");
  });

  it("getMine ignores a matching-group submission from a different competition/season", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-2", "Group Two", "approved"),
    ]);
    repositories.friendsGroupSubscriptions.findActiveByFriendsGroup.mockImplementation(
      async (friendsGroupId: string) => {
        if (friendsGroupId === "group-1") {
          return { friends_group_id: "group-1", provider_league_id: 8, provider_season_id: 23614 };
        }
        if (friendsGroupId === "group-2") {
          return { friends_group_id: "group-2", provider_league_id: 82, provider_season_id: 99999 };
        }
        return null;
      }
    );
    repositories.userSubmissions.findByUserGroupMatchweek.mockResolvedValue({
      id: "sub-group-2",
      user_id: "user-a",
      friends_group_id: "group-2",
      matchweek: "Matchweek 2",
      submitted_at: "2099-08-01T10:00:00Z",
    });

    const result = await service.getMine({
      userId: "user-a",
      friendsGroupId: "group-1",
      matchweek: "Matchweek 2",
    });

    expect(result.importSuggestion).toBeNull();
  });

  it("getMine has no import suggestion once the current group already has a submission", async () => {
    const { repositories, service } = createService();
    repositories.userSubmissions.findByUserGroupMatchweek.mockImplementation(
      async (_userId: string, friendsGroupId: string) => {
        if (friendsGroupId === "group-1") {
          return { id: "sub-group-1", user_id: "user-a", friends_group_id: "group-1", matchweek: "Matchweek 2", submitted_at: "2099-08-01T10:00:00Z" };
        }
        return null;
      }
    );

    const result = await service.getMine({
      userId: "user-a",
      friendsGroupId: "group-1",
      matchweek: "Matchweek 2",
    });

    expect(result.importSuggestion).toBeNull();
    expect(repositories.friendsGroupUsers.listForUser).not.toHaveBeenCalled();
  });

  it("importMine copies the latest matching group's slip into the current group", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-2", "Group Two", "approved"),
    ]);
    repositories.friendsGroupSubscriptions.findActiveByFriendsGroup.mockImplementation(
      async (friendsGroupId: string) => {
        if (friendsGroupId === "group-1") {
          return { friends_group_id: "group-1", provider_league_id: 8, provider_season_id: 23614 };
        }
        if (friendsGroupId === "group-2") {
          return { friends_group_id: "group-2", provider_league_id: 8, provider_season_id: 23614 };
        }
        return null;
      }
    );
    repositories.userSubmissions.findByUserGroupMatchweek.mockImplementation(
      async (_userId: string, friendsGroupId: string) => {
        if (friendsGroupId === "group-2") {
          return { id: "sub-group-2", user_id: "user-a", friends_group_id: "group-2", matchweek: "Matchweek 2", submitted_at: "2099-08-01T10:00:00Z" };
        }
        return null;
      }
    );
    repositories.predictions.listByGroupFixturesUsers.mockImplementation(
      async (friendsGroupId: string) => {
        if (friendsGroupId === "group-2") {
          return [predictionRow("user-a", 101, 2, 1, "group-2"), predictionRow("user-a", 102, 0, 0, "group-2")];
        }
        return [];
      }
    );
    repositories.redCardPredictions.listByGroupFixturesUsers.mockImplementation(
      async (friendsGroupId: string) => {
        if (friendsGroupId === "group-2") {
          return [redCardRow("user-a", 101, "group-2")];
        }
        return [];
      }
    );

    const result = await service.importMine({
      userId: "user-a",
      friendsGroupId: "group-1",
      matchweek: "Matchweek 2",
    });

    expect(repositories.predictions.deleteByUserGroupFixtures).toHaveBeenCalledWith(
      "user-a",
      "group-1",
      [101, 102]
    );
    expect(repositories.predictions.insertPredictions).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: "user-a", friends_group_id: "group-1", fixture_id: 101, home_score_prediction: 2, away_score_prediction: 1 }),
      expect.objectContaining({ user_id: "user-a", friends_group_id: "group-1", fixture_id: 102, home_score_prediction: 0, away_score_prediction: 0 }),
    ]);
    expect(repositories.redCardPredictions.insertPrediction).toHaveBeenCalledWith({
      user_id: "user-a",
      friends_group_id: "group-1",
      fixture_id: 101,
    });
    expect(repositories.userSubmissions.upsertSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-a", friends_group_id: "group-1", matchweek: "Matchweek 2" })
    );
    expect(result.friendsGroupId).toBe("group-1");
  });

  it("importMine rejects when no previous guesses exist to import", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([]);

    await expect(
      service.importMine({
        userId: "user-a",
        friendsGroupId: "group-1",
        matchweek: "Matchweek 2",
      })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(repositories.predictions.insertPredictions).not.toHaveBeenCalled();
  });

  it("importMine rejects once the matchweek has started", async () => {
    const { repositories, service } = createService(lockedFixtures);
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-2", "Group Two", "approved"),
    ]);

    await expect(
      service.importMine({
        userId: "user-a",
        friendsGroupId: "group-1",
        matchweek: "Matchweek 2",
      })
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(repositories.predictions.insertPredictions).not.toHaveBeenCalled();
  });
});

function predictionRow(
  userId: string,
  fixtureId: number,
  homeScore: number,
  awayScore: number,
  friendsGroupId = "group-1"
): PredictionRow {
  return {
    id: `${userId}-${fixtureId}`,
    user_id: userId,
    friends_group_id: friendsGroupId,
    fixture_id: fixtureId,
    home_score_prediction: homeScore,
    away_score_prediction: awayScore,
    created_at: "2099-08-01T10:00:00Z",
    updated_at: "2099-08-01T10:00:00Z",
  };
}

function redCardRow(
  userId: string,
  fixtureId: number,
  friendsGroupId = "group-1"
): RedCardPredictionRow {
  return {
    id: `red-${userId}-${fixtureId}`,
    user_id: userId,
    friends_group_id: friendsGroupId,
    fixture_id: fixtureId,
    created_at: "2099-08-01T10:00:00Z",
  };
}

function membershipRow(friendsGroupId: string, name: string, status: string) {
  return {
    role: "member" as const,
    joined_at: "2099-08-01T10:00:00Z",
    friends_group: {
      id: friendsGroupId,
      name,
      slug: friendsGroupId,
      created_by: "user-owner",
      invite_token: `invite-${friendsGroupId}`,
      is_open: false,
      status,
      created_at: "2099-08-01T10:00:00Z",
      updated_at: "2099-08-01T10:00:00Z",
    },
  };
}
