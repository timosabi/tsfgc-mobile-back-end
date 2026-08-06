import WeeklyScoreService from "../../../src/services/WeeklyScoreService.js";
import type { Database } from "../../../src/integrations/supabase/types.js";
import type { FixtureScoreRow } from "../../../src/repositories/FixturesRepository.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

type PredictionRow = Database["public"]["Tables"]["predictions"]["Row"];
type RedCardPredictionRow =
  Database["public"]["Tables"]["red_card_predictions"]["Row"];
type WeeklyScoreRow = Database["public"]["Tables"]["weekly_scores"]["Row"];

const finishedFixtures: FixtureScoreRow[] = [
  { id: 101, home_score: 2, away_score: 1, has_red_card: true },
  { id: 102, home_score: 0, away_score: 0, has_red_card: false },
];

function createService() {
  const repositories = {
    fixtures: createRepositoryMock<
      Pick<Repositories["fixtures"], "listFinishedMatchweeks" | "listFinishedScoreFixtures">
    >(["listFinishedMatchweeks", "listFinishedScoreFixtures"]),
    friendsGroupSubscriptions: createRepositoryMock<
      Pick<
        Repositories["friendsGroupSubscriptions"],
        "findActiveByFriendsGroup" | "listActiveTargets"
      >
    >(["findActiveByFriendsGroup", "listActiveTargets"]),
    predictions: createRepositoryMock<
      Pick<Repositories["predictions"], "listByGroupFixturesUsers">
    >(["listByGroupFixturesUsers"]),
    profiles: createRepositoryMock<Pick<Repositories["profiles"], "listPreviewsByIds">>([
      "listPreviewsByIds",
    ]),
    redCardPredictions: createRepositoryMock<
      Pick<Repositories["redCardPredictions"], "listByGroupFixturesUsers">
    >(["listByGroupFixturesUsers"]),
    userSubmissions: createRepositoryMock<
      Pick<Repositories["userSubmissions"], "listSubmittedUsers">
    >(["listSubmittedUsers"]),
    weeklyScores: createRepositoryMock<
      Pick<
        Repositories["weeklyScores"],
        | "findByUserGroupWeek"
        | "listByGroupPaginated"
        | "listByGroupWeek"
        | "upsertScores"
      >
    >(["findByUserGroupWeek", "listByGroupPaginated", "listByGroupWeek", "upsertScores"]),
  };

  repositories.friendsGroupSubscriptions.findActiveByFriendsGroup.mockResolvedValue({
    friends_group_id: "group-1",
    provider_league_id: 8,
    provider_season_id: 23614,
  });
  repositories.fixtures.listFinishedScoreFixtures.mockResolvedValue(finishedFixtures);
  repositories.userSubmissions.listSubmittedUsers.mockResolvedValue([
    { user_id: "user-a", submitted_at: "2026-08-01T10:00:00Z" },
    { user_id: "user-b", submitted_at: "2026-08-01T10:01:00Z" },
  ]);
  repositories.predictions.listByGroupFixturesUsers.mockResolvedValue([
    predictionRow("user-a", 101, 2, 1),
    predictionRow("user-a", 102, 1, 1),
    predictionRow("user-b", 101, 1, 0),
    predictionRow("user-b", 102, 0, 0),
  ]);
  repositories.redCardPredictions.listByGroupFixturesUsers.mockResolvedValue([
    redCardRow("user-a", 101),
    redCardRow("user-b", 102),
  ]);
  repositories.weeklyScores.upsertScores.mockResolvedValue(null);
  repositories.weeklyScores.listByGroupWeek.mockResolvedValue([
    weeklyScoreRow("score-a", "user-a", 2, 11, 11),
    weeklyScoreRow("score-b", "user-b", 2, 6, 6),
  ]);
  repositories.weeklyScores.listByGroupPaginated.mockResolvedValue([
    weeklyScoreRow("score-a", "user-a", 2, 11, 0),
    weeklyScoreRow("score-b", "user-b", 2, 6, 0),
  ]);

  return {
    repositories,
    service: new WeeklyScoreService(
      repositories as unknown as ConstructorParameters<typeof WeeklyScoreService>[0]
    ),
  };
}

describe("WeeklyScoreService", () => {
  it("calculates exact score, result, total-goals, red-card, and cumulative points", async () => {
    const { repositories, service } = createService();

    const result = await service.calculateForFriendsGroupMatchweek(
      "group-1",
      "Matchweek 2"
    );

    expect(result.fixturesScored).toBe(2);
    expect(result.submittedUsers).toBe(2);
    expect(result.rows).toHaveLength(2);

    const [calculatedRows] = repositories.weeklyScores.upsertScores.mock.calls[0];
    expect(calculatedRows).toEqual([
      expect.objectContaining({
        user_id: "user-a",
        week_number: 2,
        exact_score_points: 2,
        correct_result_points: 2,
        total_goals_bonus: 2,
        red_card_bonus: 5,
        points_earned: 11,
      }),
      expect.objectContaining({
        user_id: "user-b",
        week_number: 2,
        exact_score_points: 2,
        correct_result_points: 2,
        total_goals_bonus: 2,
        red_card_bonus: 0,
        points_earned: 6,
      }),
    ]);

    expect(repositories.weeklyScores.upsertScores).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({ id: "score-a", user_id: "user-a", group_points: 11 }),
        expect.objectContaining({ id: "score-b", user_id: "user-b", group_points: 6 }),
      ],
      { onConflict: "id" }
    );
  });

  it("ranks season leaderboard by points then exact scores then correct results", async () => {
    const { repositories, service } = createService();

    repositories.weeklyScores.listByGroupPaginated.mockResolvedValue([
      weeklyScoreRow("score-a-1", "user-a", 1, 4, 4, {
        exact_score_points: 1,
        correct_result_points: 1,
      }),
      weeklyScoreRow("score-b-1", "user-b", 1, 4, 4, {
        exact_score_points: 2,
        correct_result_points: 0,
      }),
      weeklyScoreRow("score-c-1", "user-c", 1, 3, 3, {
        exact_score_points: 3,
        correct_result_points: 0,
      }),
    ]);
    repositories.profiles.listPreviewsByIds.mockResolvedValue([
      {
        id: "user-a",
        display_name: "Alex",
        avatar_emoji: "A",
        color_class: "blue",
      },
      {
        id: "user-b",
        display_name: "Bianca",
        avatar_emoji: "B",
        color_class: "green",
      },
      {
        id: "user-c",
        display_name: "Chris",
        avatar_emoji: "C",
        color_class: "pink",
      },
    ]);

    const leaderboard = await service.getLeaderboard("group-1");

    expect(leaderboard.map((row) => [row.user_id, row.rank, row.points])).toEqual([
      ["user-b", 1, 4],
      ["user-a", 2, 4],
      ["user-c", 3, 3],
    ]);
    expect(leaderboard[0].profile?.display_name).toBe("Bianca");
  });

  it("calculates every finished matchweek for every active subscription", async () => {
    const { repositories, service } = createService();

    repositories.friendsGroupSubscriptions.listActiveTargets.mockResolvedValue([
      {
        friends_group_id: "group-1",
        provider_league_id: 8,
        provider_season_id: 23614,
      },
    ]);
    repositories.fixtures.listFinishedMatchweeks.mockResolvedValue([
      "Matchweek 1",
      "Matchweek 2",
    ]);

    const results = await service.calculateAllFinished();

    expect(results).toHaveLength(2);
    expect(repositories.fixtures.listFinishedScoreFixtures).toHaveBeenCalledTimes(2);
    expect(results.map((row) => row.matchweek)).toEqual([
      "Matchweek 1",
      "Matchweek 2",
    ]);
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
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  };
}

function redCardRow(userId: string, fixtureId: number): RedCardPredictionRow {
  return {
    id: `red-${userId}-${fixtureId}`,
    user_id: userId,
    friends_group_id: "group-1",
    fixture_id: fixtureId,
    created_at: "2026-08-01T10:00:00Z",
  };
}

function weeklyScoreRow(
  id: string,
  userId: string,
  weekNumber: number,
  points: number,
  groupPoints: number,
  overrides: Partial<WeeklyScoreRow> = {}
): WeeklyScoreRow {
  return {
    id,
    user_id: userId,
    friends_group_id: "group-1",
    week_number: weekNumber,
    fixtures_predicted: 2,
    exact_score_points: 3,
    correct_result_points: 1,
    total_goals_bonus: 1,
    red_card_bonus: 1,
    points_earned: points,
    group_points: groupPoints,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}
