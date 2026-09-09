import PlayerStatsService from "../../../src/services/PlayerStatsService.js";
import type { Database } from "../../../src/integrations/supabase/types.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

type WeeklyScoreRow = Database["public"]["Tables"]["weekly_scores"]["Row"];

function createService() {
  const repositories = {
    friendsGroupUsers: createRepositoryMock<Pick<Repositories["friendsGroupUsers"], "listForUser">>(
      ["listForUser"]
    ),
    weeklyScores: createRepositoryMock<Pick<Repositories["weeklyScores"], "listByGroupPaginated">>(
      ["listByGroupPaginated"]
    ),
    predictions: createRepositoryMock<Pick<Repositories["predictions"], "listByUserId">>([
      "listByUserId",
    ]),
    redCardPredictions: createRepositoryMock<
      Pick<Repositories["redCardPredictions"], "listByUserId">
    >(["listByUserId"]),
    fixtures: createRepositoryMock<Pick<Repositories["fixtures"], "listByIds">>(["listByIds"]),
  };

  repositories.friendsGroupUsers.listForUser.mockResolvedValue([]);
  repositories.weeklyScores.listByGroupPaginated.mockResolvedValue([]);
  repositories.predictions.listByUserId.mockResolvedValue([]);
  repositories.redCardPredictions.listByUserId.mockResolvedValue([]);
  repositories.fixtures.listByIds.mockResolvedValue([]);

  return {
    repositories,
    service: new PlayerStatsService(
      repositories as unknown as ConstructorParameters<typeof PlayerStatsService>[0]
    ),
  };
}

function membershipRow(friendsGroupId: string, name: string) {
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
      status: "approved",
      created_at: "2099-08-01T10:00:00Z",
      updated_at: "2099-08-01T10:00:00Z",
    },
  };
}

function scoreRow(overrides: {
  userId: string;
  friendsGroupId: string;
  weekNumber: number;
  fixturesPredicted?: number;
  correctResultPoints?: number;
  exactScorePoints?: number;
  pointsEarned?: number;
}): WeeklyScoreRow {
  return {
    id: `${overrides.userId}-${overrides.friendsGroupId}-${overrides.weekNumber}`,
    user_id: overrides.userId,
    friends_group_id: overrides.friendsGroupId,
    week_number: overrides.weekNumber,
    fixtures_predicted: overrides.fixturesPredicted ?? 10,
    exact_score_points: overrides.exactScorePoints ?? 0,
    correct_result_points: overrides.correctResultPoints ?? 0,
    total_goals_bonus: 0,
    red_card_bonus: 0,
    points_earned: overrides.pointsEarned ?? 0,
    group_points: 0,
    created_at: "2099-08-01T10:00:00Z",
    updated_at: "2099-08-01T10:00:00Z",
  };
}

function predictionRow(
  fixtureId: number,
  friendsGroupId: string,
  homeScore: number,
  awayScore: number,
  updatedAt: string
) {
  return {
    fixture_id: fixtureId,
    friends_group_id: friendsGroupId,
    home_score_prediction: homeScore,
    away_score_prediction: awayScore,
    updated_at: updatedAt,
  };
}

function redCardRow(fixtureId: number, friendsGroupId: string, createdAt: string) {
  return { fixture_id: fixtureId, friends_group_id: friendsGroupId, created_at: createdAt };
}

function fixtureRow(id: number, homeScore: number | null, awayScore: number | null, hasRedCard = false) {
  return { id, home_score: homeScore, away_score: awayScore, has_red_card: hasRedCard };
}

describe("PlayerStatsService", () => {
  it("deduplicates an identical guess submitted to two groups for the same fixture", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-1", "Group One"),
      membershipRow("group-2", "Group Two"),
    ]);
    repositories.predictions.listByUserId.mockResolvedValue([
      predictionRow(101, "group-1", 2, 1, "2099-08-01T10:00:00Z"),
      predictionRow(101, "group-2", 2, 1, "2099-08-01T11:00:00Z"),
    ]);
    repositories.fixtures.listByIds.mockResolvedValue([fixtureRow(101, 2, 1)]);

    const result = await service.getMyStats("user-a");

    expect(result.exactScoreCount).toBe(1);
    expect(result.correctResultCount).toBe(1);
    expect(result.totalFixturesPredicted).toBe(1);
  });

  it("counts two different correctly-guessed fixtures across two groups without over-deduplicating", async () => {
    const { repositories, service } = createService();
    repositories.predictions.listByUserId.mockResolvedValue([
      predictionRow(101, "group-1", 2, 1, "2099-08-01T10:00:00Z"),
      predictionRow(102, "group-2", 0, 0, "2099-08-01T10:00:00Z"),
    ]);
    repositories.fixtures.listByIds.mockResolvedValue([
      fixtureRow(101, 2, 1),
      fixtureRow(102, 0, 0),
    ]);

    const result = await service.getMyStats("user-a");

    expect(result.correctResultCount).toBe(2);
    expect(result.totalFixturesPredicted).toBe(2);
  });

  it("counts a #1 finish in two different groups the same week as two separate wins", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-1", "Group One"),
      membershipRow("group-2", "Group Two"),
    ]);
    repositories.weeklyScores.listByGroupPaginated.mockImplementation(
      async ({ friendsGroupId }: { friendsGroupId: string }) => {
        if (friendsGroupId === "group-1") {
          return [
            scoreRow({ userId: "user-a", friendsGroupId: "group-1", weekNumber: 1, pointsEarned: 10 }),
            scoreRow({ userId: "user-b", friendsGroupId: "group-1", weekNumber: 1, pointsEarned: 5 }),
          ];
        }
        if (friendsGroupId === "group-2") {
          return [
            scoreRow({ userId: "user-a", friendsGroupId: "group-2", weekNumber: 1, pointsEarned: 8 }),
            scoreRow({ userId: "user-c", friendsGroupId: "group-2", weekNumber: 1, pointsEarned: 2 }),
          ];
        }
        return [];
      }
    );

    const result = await service.getMyStats("user-a");

    expect(result.weeksWon).toBe(2);
  });

  it("resets the win streak on a non-#1 week and on a gap in week_number, reporting the right group", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-1", "Group One"),
    ]);
    repositories.weeklyScores.listByGroupPaginated.mockResolvedValue([
      scoreRow({ userId: "user-a", friendsGroupId: "group-1", weekNumber: 1, pointsEarned: 10 }),
      scoreRow({ userId: "user-b", friendsGroupId: "group-1", weekNumber: 1, pointsEarned: 5 }),
      scoreRow({ userId: "user-a", friendsGroupId: "group-1", weekNumber: 2, pointsEarned: 10 }),
      scoreRow({ userId: "user-b", friendsGroupId: "group-1", weekNumber: 2, pointsEarned: 5 }),
      scoreRow({ userId: "user-a", friendsGroupId: "group-1", weekNumber: 3, pointsEarned: 2 }),
      scoreRow({ userId: "user-b", friendsGroupId: "group-1", weekNumber: 3, pointsEarned: 9 }),
      scoreRow({ userId: "user-a", friendsGroupId: "group-1", weekNumber: 4, pointsEarned: 10 }),
      scoreRow({ userId: "user-b", friendsGroupId: "group-1", weekNumber: 4, pointsEarned: 5 }),
      // gap at week 5
      scoreRow({ userId: "user-a", friendsGroupId: "group-1", weekNumber: 6, pointsEarned: 10 }),
      scoreRow({ userId: "user-b", friendsGroupId: "group-1", weekNumber: 6, pointsEarned: 5 }),
    ]);

    const result = await service.getMyStats("user-a");

    expect(result.winStreak).toEqual({
      length: 2,
      friendsGroupId: "group-1",
      friendsGroupName: "Group One",
    });
  });

  it("counts every week the user has the lowest points_earned as a last-place finish, summed across groups", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-1", "Group One"),
      membershipRow("group-2", "Group Two"),
    ]);
    repositories.weeklyScores.listByGroupPaginated.mockImplementation(
      async ({ friendsGroupId }: { friendsGroupId: string }) => {
        if (friendsGroupId === "group-1") {
          return [
            scoreRow({ userId: "user-a", friendsGroupId: "group-1", weekNumber: 1, pointsEarned: 1 }),
            scoreRow({ userId: "user-b", friendsGroupId: "group-1", weekNumber: 1, pointsEarned: 5 }),
          ];
        }
        if (friendsGroupId === "group-2") {
          return [
            scoreRow({ userId: "user-a", friendsGroupId: "group-2", weekNumber: 1, pointsEarned: 0 }),
            scoreRow({ userId: "user-c", friendsGroupId: "group-2", weekNumber: 1, pointsEarned: 9 }),
          ];
        }
        return [];
      }
    );

    const result = await service.getMyStats("user-a");

    expect(result.timesLastPlace).toBe(2);
  });

  it("deduplicates a red-card guess submitted to multiple groups for the same fixture", async () => {
    const { repositories, service } = createService();
    repositories.redCardPredictions.listByUserId.mockResolvedValue([
      redCardRow(201, "group-1", "2099-08-01T10:00:00Z"),
      redCardRow(201, "group-2", "2099-08-01T11:00:00Z"),
    ]);
    repositories.fixtures.listByIds.mockResolvedValue([fixtureRow(201, 1, 1, true)]);

    const result = await service.getMyStats("user-a");

    expect(result.redCardGuessesTotal).toBe(1);
    expect(result.redCardGuessesCorrect).toBe(1);
    expect(result.redCardAccuracy).toBe(1);
  });

  it("excludes unfinished fixtures from the accuracy denominator", async () => {
    const { repositories, service } = createService();
    repositories.predictions.listByUserId.mockResolvedValue([
      predictionRow(101, "group-1", 2, 1, "2099-08-01T10:00:00Z"),
      predictionRow(102, "group-1", 1, 1, "2099-08-01T10:00:00Z"),
    ]);
    repositories.fixtures.listByIds.mockResolvedValue([
      fixtureRow(101, 2, 1),
      fixtureRow(102, null, null),
    ]);

    const result = await service.getMyStats("user-a");

    expect(result.totalFixturesPredicted).toBe(1);
    expect(result.correctResultCount).toBe(1);
  });

  it("computes gScore from the participation/accuracy/points formula for a single week", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-1", "Group One"),
    ]);
    repositories.weeklyScores.listByGroupPaginated.mockResolvedValue([
      scoreRow({
        userId: "user-a",
        friendsGroupId: "group-1",
        weekNumber: 1,
        fixturesPredicted: 10,
        correctResultPoints: 5,
        pointsEarned: 11,
      }),
    ]);

    const result = await service.getMyStats("user-a");

    // weekScore = 0.2*1 + 0.4*(5/10) + 0.4*(11/27) = 0.2 + 0.2 + 0.162963... ~= 0.562963
    expect(result.gScore).toBe(563);
  });

  it("scores a missed week as a hard 0, pulling the rolling average down", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-1", "Group One"),
    ]);
    repositories.weeklyScores.listByGroupPaginated.mockResolvedValue([
      scoreRow({
        userId: "user-a",
        friendsGroupId: "group-1",
        weekNumber: 1,
        fixturesPredicted: 10,
        correctResultPoints: 10,
        pointsEarned: 20,
      }),
      // week 2: user-a has no row at all (missed it) -- another member did submit,
      // so the week still "exists" as finished.
      scoreRow({ userId: "user-b", friendsGroupId: "group-1", weekNumber: 2, pointsEarned: 5 }),
    ]);

    const result = await service.getMyStats("user-a");

    // week1 weekScore ~= 0.2 + 0.4 + 0.4*min(20/27,1) ~= 0.2+0.4+0.296296 = 0.896296
    // week2 weekScore = 0 (missed)
    // average = 0.448148 -> gScore ~= 448
    expect(result.gScore).toBe(448);
  });

  it("only averages the 6 most recent finished weeks per group", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-1", "Group One"),
    ]);
    const rows: WeeklyScoreRow[] = [
      // week 1 is an extreme outlier that must be excluded from a 6-week window
      scoreRow({
        userId: "user-a",
        friendsGroupId: "group-1",
        weekNumber: 1,
        fixturesPredicted: 10,
        correctResultPoints: 10,
        pointsEarned: 27,
      }),
    ];
    for (let week = 2; week <= 7; week += 1) {
      rows.push(
        scoreRow({
          userId: "user-a",
          friendsGroupId: "group-1",
          weekNumber: week,
          fixturesPredicted: 10,
          correctResultPoints: 0,
          pointsEarned: 0,
        })
      );
    }
    repositories.weeklyScores.listByGroupPaginated.mockResolvedValue(rows);

    const result = await service.getMyStats("user-a");

    // If week 1 (the outlier, all correct) were included the average would be much
    // higher. With only weeks 2-7 (all zero) the whole window's weekScore is just
    // participation: 0.2*1 + 0.4*0 + 0.4*0 = 0.2 -> gScore = 200.
    expect(result.gScore).toBe(200);
  });

  it("reports trend up/down when the current window differs from the previous window", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-1", "Group One"),
    ]);
    const rows: WeeklyScoreRow[] = [];
    // previous window: weeks 1-6, all zero points
    for (let week = 1; week <= 6; week += 1) {
      rows.push(
        scoreRow({ userId: "user-a", friendsGroupId: "group-1", weekNumber: week, pointsEarned: 0 })
      );
    }
    // current window: weeks 7-12, all strong weeks
    for (let week = 7; week <= 12; week += 1) {
      rows.push(
        scoreRow({
          userId: "user-a",
          friendsGroupId: "group-1",
          weekNumber: week,
          correctResultPoints: 10,
          pointsEarned: 27,
        })
      );
    }
    repositories.weeklyScores.listByGroupPaginated.mockResolvedValue(rows);

    const result = await service.getMyStats("user-a");

    expect(result.trend).toBe("up");
    expect(result.gScore).toBeGreaterThan(0);
  });

  it("reports trend as null when only one week has ever been finished", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-1", "Group One"),
    ]);
    repositories.weeklyScores.listByGroupPaginated.mockResolvedValue([
      scoreRow({ userId: "user-a", friendsGroupId: "group-1", weekNumber: 1, pointsEarned: 10 }),
    ]);

    const result = await service.getMyStats("user-a");

    expect(result.trend).toBeNull();
  });

  it("reports a real trend from as little as two finished weeks (early-season case)", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      membershipRow("group-1", "Group One"),
    ]);
    repositories.weeklyScores.listByGroupPaginated.mockResolvedValue([
      scoreRow({
        userId: "user-a",
        friendsGroupId: "group-1",
        weekNumber: 1,
        correctResultPoints: 0,
        pointsEarned: 0,
      }),
      scoreRow({
        userId: "user-a",
        friendsGroupId: "group-1",
        weekNumber: 2,
        correctResultPoints: 10,
        pointsEarned: 27,
      }),
    ]);

    const result = await service.getMyStats("user-a");

    // previous window = [week1] only (weekScore 0.2), current window =
    // [week1, week2] (average of 0.2 and 1.0 = 0.6) -> current > previous.
    expect(result.trend).toBe("up");
  });

  it("returns an all-zero, non-crashing result for a brand-new user", async () => {
    const { service } = createService();

    const result = await service.getMyStats("user-new");

    expect(result).toEqual({
      gScore: 0,
      trend: null,
      accuracy: 0,
      exactScoreCount: 0,
      correctResultCount: 0,
      totalFixturesPredicted: 0,
      weeksWon: 0,
      winStreak: { length: 0, friendsGroupId: null, friendsGroupName: null },
      timesLastPlace: 0,
      redCardGuessesTotal: 0,
      redCardGuessesCorrect: 0,
      redCardAccuracy: 0,
    });
  });
});
