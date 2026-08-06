import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type { FixtureScoreRow } from "../repositories/FixturesRepository.js";

type WeeklyScoreRow = Database["public"]["Tables"]["weekly_scores"]["Row"];
type WeeklyScoreInsert =
  Database["public"]["Tables"]["weekly_scores"]["Insert"];
type SubmittedUserRef = Pick<
  Database["public"]["Tables"]["user_submissions"]["Row"],
  "user_id"
>;
type ScorePredictionRow = Pick<
  Database["public"]["Tables"]["predictions"]["Row"],
  "user_id" | "fixture_id" | "home_score_prediction" | "away_score_prediction"
>;
type RedCardPredictionRef = Pick<
  Database["public"]["Tables"]["red_card_predictions"]["Row"],
  "user_id" | "fixture_id"
>;
type LeaderboardRow = {
  user_id: string;
  friends_group_id: string;
  points: number;
  fixtures_predicted: number;
  exact_score_points: number;
  correct_result_points: number;
  total_goals_bonus: number;
  red_card_bonus: number;
  weeks_played: number;
  rank?: number;
};
type CalculatedWeeklyScore = WeeklyScoreInsert & {
  fixtures_predicted: number;
  exact_score_points: number;
  correct_result_points: number;
  total_goals_bonus: number;
  red_card_bonus: number;
  points_earned: number;
  group_points: number;
};
type ResultSign = "home" | "away" | "draw";
type WeeklyScoreRepositories = Pick<
  Repositories,
  | "fixtures"
  | "friendsGroupSubscriptions"
  | "predictions"
  | "profiles"
  | "redCardPredictions"
  | "userSubmissions"
  | "weeklyScores"
>;

export default class WeeklyScoreService {
  private readonly repositories: WeeklyScoreRepositories;

  constructor(clientOrRepositories: SupabaseClient<Database> | WeeklyScoreRepositories) {
    this.repositories = isWeeklyScoreRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async getUserWeeklyScore(
    userId: string,
    leagueId: string,
    targetWeek: number
  ) {
    return this.repositories.weeklyScores.findByUserGroupWeek(
      userId,
      leagueId,
      targetWeek
    );
  }

  async upsertWeeklyScore(payload: { weeklyScores: WeeklyScoreInsert[] }) {
    return this.repositories.weeklyScores.upsertScores(payload.weeklyScores);
  }

  async calculateForFriendsGroupMatchweek(
    friendsGroupId: string,
    matchweek: string
  ) {
    const weekNumber = this.weekNumberFromMatchweek(matchweek);

    const subscription =
      await this.repositories.friendsGroupSubscriptions.findActiveByFriendsGroup(
        friendsGroupId
      );
    if (!subscription) return { rows: [], fixturesScored: 0 };

    const fixtures = await this.repositories.fixtures.listFinishedScoreFixtures({
      providerLeagueId: subscription.provider_league_id,
      providerSeasonId: subscription.provider_season_id,
      matchweek,
    });
    if (!fixtures.length) return { rows: [], fixturesScored: 0 };

    const fixtureIds = fixtures.map((fixture) => fixture.id);
    const fixtureById = new Map<number, FixtureScoreRow>(
      fixtures.map((fixture) => [fixture.id, fixture])
    );

    const submissions = await this.repositories.userSubmissions.listSubmittedUsers(
      friendsGroupId,
      matchweek
    );
    const submittedUserIds = Array.from<string>(
      new Set((submissions ?? []).map((row: SubmittedUserRef) => row.user_id))
    );
    if (!submittedUserIds.length) return { rows: [], fixturesScored: fixtures.length };

    const predictions = await this.repositories.predictions.listByGroupFixturesUsers(
      friendsGroupId,
      fixtureIds,
      submittedUserIds,
      "user_id, fixture_id, home_score_prediction, away_score_prediction"
    );

    const redCards =
      await this.repositories.redCardPredictions.listByGroupFixturesUsers(
        friendsGroupId,
        fixtureIds,
        submittedUserIds,
        "user_id, fixture_id"
      );

    const redCardHitUserIds = new Set<string>();
    for (const row of (redCards ?? []) as RedCardPredictionRef[]) {
      const fixture = fixtureById.get(row.fixture_id);
      if (fixture?.has_red_card === true) redCardHitUserIds.add(row.user_id);
    }

    const rowsByUser = new Map<string, CalculatedWeeklyScore>();
    const predictionCountsByUser = new Map<string, number>();
    const predictedTotalsByUser = new Map<string, number>();
    const actualTotalGoals = fixtures.reduce(
      (total, fixture) => total + (fixture.home_score ?? 0) + (fixture.away_score ?? 0),
      0
    );
    for (const userId of submittedUserIds) {
      rowsByUser.set(userId, {
        user_id: userId,
        friends_group_id: friendsGroupId,
        week_number: weekNumber,
        fixtures_predicted: 0,
        exact_score_points: 0,
        correct_result_points: 0,
        total_goals_bonus: 0,
        red_card_bonus: 0,
        points_earned: 0,
        group_points: 0,
        updated_at: new Date().toISOString(),
      });
    }

    for (const prediction of (predictions ?? []) as ScorePredictionRow[]) {
      const fixture = fixtureById.get(prediction.fixture_id);
      if (!fixture) continue;

      const row = rowsByUser.get(prediction.user_id);
      if (!row) continue;

      row.fixtures_predicted += 1;
      predictionCountsByUser.set(
        prediction.user_id,
        (predictionCountsByUser.get(prediction.user_id) ?? 0) + 1
      );
      predictedTotalsByUser.set(
        prediction.user_id,
        (predictedTotalsByUser.get(prediction.user_id) ?? 0) +
          prediction.home_score_prediction +
          prediction.away_score_prediction
      );

      const exact =
        fixture.home_score !== null &&
        fixture.away_score !== null &&
        prediction.home_score_prediction === fixture.home_score &&
        prediction.away_score_prediction === fixture.away_score;

      if (exact) {
        row.correct_result_points += 1;
        row.exact_score_points += 2;
      } else if (
        this.resultSign(prediction.home_score_prediction, prediction.away_score_prediction) ===
        this.resultSign(fixture.home_score, fixture.away_score)
      ) {
        row.correct_result_points += 1;
      }
    }

    const totalGoalBonusWinners = this.findNearestTotalGoalUsers({
      userIds: submittedUserIds,
      predictionCountsByUser,
      predictedTotalsByUser,
      expectedFixtureCount: fixtures.length,
      actualTotalGoals,
    });
    for (const userId of totalGoalBonusWinners) {
      const row = rowsByUser.get(userId);
      if (row) row.total_goals_bonus += 2;
    }

    for (const userId of redCardHitUserIds) {
      const row = rowsByUser.get(userId);
      if (row) {
        row.red_card_bonus += 5;
      }
    }

    const weeklyScores = Array.from(rowsByUser.values()).map((row) => ({
      ...row,
      points_earned:
        row.exact_score_points +
        row.correct_result_points +
        row.total_goals_bonus +
        row.red_card_bonus,
    }));

    const data = await this.repositories.weeklyScores.upsertScores(weeklyScores, {
      returnRows: true,
    });

    await this.recalculateCumulativeGroupPoints(friendsGroupId);

    const refreshed = await this.repositories.weeklyScores.listByGroupWeek(
      friendsGroupId,
      weekNumber
    );

    return {
      rows: refreshed ?? data ?? [],
      fixturesScored: fixtures.length,
      submittedUsers: submittedUserIds.length,
    };
  }

  async calculateAllFinished() {
    const subscriptions =
      await this.repositories.friendsGroupSubscriptions.listActiveTargets();

    const results = [];
    for (const subscription of subscriptions ?? []) {
      const matchweeks = await this.repositories.fixtures.listFinishedMatchweeks({
        providerLeagueId: subscription.provider_league_id,
        providerSeasonId: subscription.provider_season_id,
      });

      for (const matchweek of matchweeks) {
        const result = await this.calculateForFriendsGroupMatchweek(
          subscription.friends_group_id,
          matchweek
        );
        results.push({
          friendsGroupId: subscription.friends_group_id,
          matchweek,
          ...result,
        });
      }
    }

    return results;
  }

  async getLeaderboard(friendsGroupId: string) {
    const scores = await this.getAllWeeklyScores(friendsGroupId);

    const totals = new Map<string, LeaderboardRow>();
    for (const score of scores ?? []) {
      const row = totals.get(score.user_id) ?? {
        user_id: score.user_id,
        friends_group_id: friendsGroupId,
        points: 0,
        fixtures_predicted: 0,
        exact_score_points: 0,
        correct_result_points: 0,
        total_goals_bonus: 0,
        red_card_bonus: 0,
        weeks_played: 0,
      };

      row.points += score.points_earned;
      row.fixtures_predicted += score.fixtures_predicted;
      row.exact_score_points += score.exact_score_points;
      row.correct_result_points += score.correct_result_points;
      row.total_goals_bonus += score.total_goals_bonus;
      row.red_card_bonus += score.red_card_bonus;
      row.weeks_played += 1;
      totals.set(score.user_id, row);
    }

    const rows = Array.from(totals.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.exact_score_points !== a.exact_score_points) {
        return b.exact_score_points - a.exact_score_points;
      }
      return b.correct_result_points - a.correct_result_points;
    });

    rows.forEach((row, index) => {
      row.rank = index + 1;
    });

    if (!rows.length) return [];

    const userIds = rows.map((row) => row.user_id);
    const profiles = await this.repositories.profiles.listPreviewsByIds(userIds);
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

    return rows.map((row) => ({
      ...row,
      profile: profileById.get(row.user_id) ?? null,
    }));
  }

  async getHistory(friendsGroupId: string, userId?: string) {
    return this.getAllWeeklyScores(friendsGroupId, userId, [
      ["week_number", true],
      ["points_earned", false],
    ]);
  }

  async getWeekScores(friendsGroupId: string, weekNumber: number) {
    return this.repositories.weeklyScores.listByGroupWeek(
      friendsGroupId,
      weekNumber,
      true
    );
  }

  private weekNumberFromMatchweek(matchweek: string) {
    const n = Number(matchweek.match(/\d+/)?.[0]);
    if (!Number.isInteger(n) || n <= 0) return 0;
    return n;
  }

  private resultSign(home: number | null, away: number | null): ResultSign {
    home ??= 0;
    away ??= 0;
    if (home > away) return "home";
    if (away > home) return "away";
    return "draw";
  }

  private async recalculateCumulativeGroupPoints(friendsGroupId: string) {
    const scores = await this.getAllWeeklyScores(friendsGroupId, undefined, [
      ["user_id", true],
      ["week_number", true],
    ]);

    const running = new Map<string, number>();
    const updates = [];
    for (const score of scores) {
      const total = (running.get(score.user_id) ?? 0) + score.points_earned;
      running.set(score.user_id, total);

      updates.push({
        ...score,
        group_points: total,
        updated_at: new Date().toISOString(),
      });
    }

    for (let i = 0; i < updates.length; i += 500) {
      const batch = updates.slice(i, i + 500);
      await this.repositories.weeklyScores.upsertScores(batch, {
        onConflict: "id",
      });
    }
  }

  private findNearestTotalGoalUsers(params: {
    userIds: string[];
    predictionCountsByUser: Map<string, number>;
    predictedTotalsByUser: Map<string, number>;
    expectedFixtureCount: number;
    actualTotalGoals: number;
  }) {
    if (params.expectedFixtureCount <= 0) return [];

    let bestDistance: number | null = null;
    const winners: string[] = [];

    for (const userId of params.userIds) {
      if (
        (params.predictionCountsByUser.get(userId) ?? 0) !==
        params.expectedFixtureCount
      ) {
        continue;
      }

      const predictedTotal = params.predictedTotalsByUser.get(userId);
      if (predictedTotal === undefined) continue;

      const distance = Math.abs(predictedTotal - params.actualTotalGoals);
      if (bestDistance === null || distance < bestDistance) {
        bestDistance = distance;
        winners.length = 0;
        winners.push(userId);
      } else if (distance === bestDistance) {
        winners.push(userId);
      }
    }

    return winners;
  }

  private async getAllWeeklyScores(
    friendsGroupId: string,
    userId?: string,
    orders: Array<[string, boolean]> = []
  ) {
    return this.repositories.weeklyScores.listByGroupPaginated({
      friendsGroupId,
      userId,
      orders,
    });
  }
}

function isWeeklyScoreRepositories(
  value: SupabaseClient<Database> | WeeklyScoreRepositories
): value is WeeklyScoreRepositories {
  return "fixtures" in value && "weeklyScores" in value && "userSubmissions" in value;
}
