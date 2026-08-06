import MatchweekOverviewService from "../../../src/services/MatchweekOverviewService.js";
import type { Database } from "../../../src/integrations/supabase/types.js";
import type { OverviewFixtureRow } from "../../../src/repositories/FixturesRepository.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

type PredictionRow = Database["public"]["Tables"]["predictions"]["Row"];
type RedCardPredictionRow =
  Database["public"]["Tables"]["red_card_predictions"]["Row"];
type WeeklyScoreRow = Database["public"]["Tables"]["weekly_scores"]["Row"];
type LiveFeedRow = Database["public"]["Tables"]["live_feed_events"]["Row"];

function createService(fixtures: OverviewFixtureRow[]) {
  const repositories = {
    fixtures: createRepositoryMock<
      Pick<Repositories["fixtures"], "listOverviewFixturesForSubscription">
    >(["listOverviewFixturesForSubscription"]),
    friendsGroups: createRepositoryMock<
      Pick<Repositories["friendsGroups"], "findOverviewById">
    >(["findOverviewById"]),
    friendsGroupSubscriptions: createRepositoryMock<
      Pick<Repositories["friendsGroupSubscriptions"], "findActiveByFriendsGroup">
    >(["findActiveByFriendsGroup"]),
    friendsGroupUsers: createRepositoryMock<
      Pick<Repositories["friendsGroupUsers"], "listMembers">
    >(["listMembers"]),
    liveFeedEvents: createRepositoryMock<
      Pick<Repositories["liveFeedEvents"], "listByGroupMatchweek">
    >(["listByGroupMatchweek"]),
    predictions: createRepositoryMock<
      Pick<Repositories["predictions"], "listByGroupFixtures">
    >(["listByGroupFixtures"]),
    profiles: createRepositoryMock<Pick<Repositories["profiles"], "listPreviewsByIds">>([
      "listPreviewsByIds",
    ]),
    redCardPredictions: createRepositoryMock<
      Pick<Repositories["redCardPredictions"], "listByGroupFixtures">
    >(["listByGroupFixtures"]),
    userSubmissions: createRepositoryMock<
      Pick<Repositories["userSubmissions"], "listSubmittedUsers">
    >(["listSubmittedUsers"]),
    weeklyScores: createRepositoryMock<
      Pick<Repositories["weeklyScores"], "listByGroupPaginated" | "listByGroupWeek">
    >(["listByGroupPaginated", "listByGroupWeek"]),
  };

  repositories.friendsGroups.findOverviewById.mockResolvedValue({
    id: "group-1",
    name: "Los Muchachos",
    slug: "los-muchachos",
    is_open: true,
    status: "approved",
    created_by: "user-a",
  });
  repositories.friendsGroupSubscriptions.findActiveByFriendsGroup.mockResolvedValue({
    friends_group_id: "group-1",
    provider_league_id: 8,
    provider_season_id: 23614,
  });
  repositories.fixtures.listOverviewFixturesForSubscription.mockResolvedValue(fixtures);
  repositories.friendsGroupUsers.listMembers.mockResolvedValue([
    { user_id: "user-a", role: "owner", joined_at: "2026-08-01T10:00:00Z" },
    { user_id: "user-b", role: "member", joined_at: "2026-08-01T10:01:00Z" },
  ]);
  repositories.userSubmissions.listSubmittedUsers.mockResolvedValue([
    { user_id: "user-a", submitted_at: "2026-08-02T10:00:00Z" },
    { user_id: "user-b", submitted_at: "2026-08-02T10:01:00Z" },
  ]);
  repositories.predictions.listByGroupFixtures.mockResolvedValue([
    predictionRow("user-a", 201, 1, 0),
    predictionRow("user-b", 201, 0, 0),
  ]);
  repositories.redCardPredictions.listByGroupFixtures.mockResolvedValue([
    redCardRow("user-a", 201),
    redCardRow("user-b", 201),
  ]);
  repositories.weeklyScores.listByGroupWeek.mockResolvedValue([]);
  repositories.weeklyScores.listByGroupPaginated.mockResolvedValue([]);
  repositories.liveFeedEvents.listByGroupMatchweek.mockResolvedValue([
    liveFeedRow("feed-1", "Matchweek 2", "Goal for Arsenal"),
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
  ]);

  return {
    repositories,
    service: new MatchweekOverviewService(
      repositories as unknown as ConstructorParameters<typeof MatchweekOverviewService>[0]
    ),
  };
}

describe("MatchweekOverviewService", () => {
  it("selects the live current matchweek and returns a polling dashboard snapshot", async () => {
    const { service } = createService([
      overviewFixture(101, "Matchweek 1", "finished", "2026-08-01T12:00:00Z", {
        home_score: 2,
        away_score: 1,
      }),
      overviewFixture(201, "Matchweek 2", "live", "2026-08-08T12:00:00Z", {
        live_home_score: 1,
        live_away_score: 0,
        current_minute: 27,
      }),
    ]);

    const overview = await service.getOverview({
      userId: "user-a",
      friendsGroupId: "group-1",
      matchweek: "current",
    });

    expect(overview.selectedMatchweek).toBe("Matchweek 2");
    expect(overview.locksAt).toBe("2026-08-08T12:00:00.000Z");
    expect(overview.state).toBe("live");
    expect(overview.permissions).toEqual({
      canEditPredictions: false,
      canSubmitPredictions: false,
      canViewAllPredictions: true,
      shouldPoll: true,
    });
    expect(overview.navigation).toMatchObject({
      previous: "Matchweek 1",
      next: null,
      current: "Matchweek 2",
    });
    expect(overview.scores.rows.find((row) => row.user_id === "user-a"))
      .toMatchObject({
      user_id: "user-a",
      points_earned: 5,
      provisional: true,
    });
    expect(overview.scores.rows[0]).not.toHaveProperty("friends_group_id");
    expect(overview.scores.rows[0]).not.toHaveProperty("week_number");
    expect(overview.scores.rows[0]).not.toHaveProperty("fixtures_predicted");
    expect(overview.scores.rows[0]).not.toHaveProperty("group_points");
    expect(overview.scores).not.toHaveProperty("mine");
    expect(overview).not.toHaveProperty("leaderboard");
    expect(overview.members.find((member) => member.userId === "user-b")?.prediction)
      .toMatchObject({ redCardFixtureId: 201 });
    expect(overview.liveFeed).toHaveLength(1);
  });

  it("keeps other members' predictions hidden before the first kickoff", async () => {
    const { service } = createService([
      overviewFixture(202, "Matchweek 2", "scheduled", "2099-08-08T18:00:00Z"),
      overviewFixture(201, "Matchweek 2", "scheduled", "2099-08-08T12:00:00Z"),
      overviewFixture(301, "Matchweek 3", "scheduled", "2099-08-15T12:00:00Z"),
    ]);

    const overview = await service.getOverview({
      userId: "user-a",
      friendsGroupId: "group-1",
      matchweek: "Matchweek 2",
    });

    expect(overview.state).toBe("editable");
    expect(overview.locksAt).toBe("2099-08-08T12:00:00.000Z");
    expect(overview.permissions.canEditPredictions).toBe(true);
    expect(overview.navigation.next).toBe("Matchweek 3");
    expect(overview.myPrediction.predictions).toHaveLength(1);
    expect(overview.members.find((member) => member.userId === "user-b")?.prediction)
      .toBeNull();
  });

  it("uses persisted finished-week scores and readonly history when available", async () => {
    const { repositories, service } = createService([
      overviewFixture(201, "Matchweek 2", "finished", "2026-08-08T12:00:00Z", {
        home_score: 1,
        away_score: 0,
        has_red_card: true,
      }),
    ]);
    repositories.weeklyScores.listByGroupWeek.mockResolvedValue([
      weeklyScoreRow("score-a", "user-a", 2, 5, 10),
      weeklyScoreRow("score-b", "user-b", 2, 1, 3),
    ]);
    repositories.weeklyScores.listByGroupPaginated.mockResolvedValue([
      weeklyScoreRow("score-a", "user-a", 2, 5, 10),
      weeklyScoreRow("score-b", "user-b", 2, 1, 3),
    ]);

    const overview = await service.getOverview({
      userId: "user-a",
      friendsGroupId: "group-1",
      matchweek: "Matchweek 2",
    });

    expect(overview.state).toBe("finished");
    expect(overview.locksAt).toBe("2026-08-08T12:00:00.000Z");
    expect(overview.permissions.shouldPoll).toBe(false);
    expect(overview.scores.rows.find((row) => row.user_id === "user-a"))
      .toMatchObject({
      user_id: "user-a",
      points_earned: 5,
      provisional: false,
    });
    expect(overview.scores.rows[0]).not.toHaveProperty("group_points");
    expect(overview).not.toHaveProperty("leaderboard");
    expect(overview.members.every((member) => member.prediction !== null)).toBe(true);
  });
});

function overviewFixture(
  id: number,
  matchweek: string,
  status: string,
  startingAt: string,
  overrides: Partial<OverviewFixtureRow> = {}
): OverviewFixtureRow {
  return {
    id,
    sm_fixture_id: id + 1000,
    home_team: "Arsenal",
    away_team: "Chelsea",
    home_score: null,
    away_score: null,
    live_home_score: null,
    live_away_score: null,
    has_red_card: false,
    current_minute: null,
    status,
    match_date: startingAt.slice(0, 10),
    match_time: startingAt.slice(11, 19),
    starting_at: startingAt,
    matchweek,
    ...overrides,
  };
}

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
  groupPoints: number
): WeeklyScoreRow {
  return {
    id,
    user_id: userId,
    friends_group_id: "group-1",
    week_number: weekNumber,
    fixtures_predicted: 1,
    exact_score_points: points >= 3 ? 3 : 0,
    correct_result_points: points < 3 ? points : 0,
    total_goals_bonus: points >= 4 ? 1 : 0,
    red_card_bonus: points >= 5 ? 1 : 0,
    points_earned: points,
    group_points: groupPoints,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  };
}

function liveFeedRow(
  id: string,
  matchweek: string,
  message: string
): LiveFeedRow {
  return {
    id,
    friends_group_id: "group-1",
    fixture_id: 201,
    sm_fixture_id: 1201,
    matchweek,
    event_key: id,
    event_type: "goal",
    ai_message: message,
    payload: {},
    pushed_at: null,
    created_at: "2026-08-08T12:27:00Z",
  };
}
