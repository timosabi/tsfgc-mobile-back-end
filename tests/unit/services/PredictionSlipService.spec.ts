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

  repositories.friendsGroupSubscriptions.findActiveByFriendsGroup.mockResolvedValue({
    friends_group_id: "group-1",
    provider_league_id: 8,
    provider_season_id: 23614,
  });
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
});

function predictionRow(
  userId: string,
  fixtureId: number,
  homeScore: number,
  awayScore: number
): PredictionRow {
  return {
    id: `${userId}-${fixtureId}`,
    user_id: userId,
    friends_group_id: "group-1",
    fixture_id: fixtureId,
    home_score_prediction: homeScore,
    away_score_prediction: awayScore,
    created_at: "2099-08-01T10:00:00Z",
    updated_at: "2099-08-01T10:00:00Z",
  };
}

function redCardRow(userId: string, fixtureId: number): RedCardPredictionRow {
  return {
    id: `red-${userId}-${fixtureId}`,
    user_id: userId,
    friends_group_id: "group-1",
    fixture_id: fixtureId,
    created_at: "2099-08-01T10:00:00Z",
  };
}
