import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";

type WeeklyScoreRow = Database["public"]["Tables"]["weekly_scores"]["Row"];

type PlayerStatsRepositories = Pick<
  Repositories,
  "friendsGroupUsers" | "weeklyScores" | "predictions" | "redCardPredictions" | "fixtures"
>;

const GSCORE_WINDOW_SIZE = 6;
const PARTICIPATION_WEIGHT = 0.2;
const ACCURACY_WEIGHT = 0.4;
const POINTS_WEIGHT = 0.4;

export type WinStreak = {
  length: number;
  friendsGroupId: string | null;
  friendsGroupName: string | null;
};

export type PlayerStats = {
  gScore: number;
  trend: "up" | "down" | "flat" | null;
  accuracy: number;
  exactScoreCount: number;
  correctResultCount: number;
  totalFixturesPredicted: number;
  weeksWon: number;
  winStreak: WinStreak;
  timesLastPlace: number;
  redCardGuessesTotal: number;
  redCardGuessesCorrect: number;
  redCardAccuracy: number;
};

export default class PlayerStatsService {
  private readonly repositories: PlayerStatsRepositories;

  constructor(clientOrRepositories: SupabaseClient<Database> | PlayerStatsRepositories) {
    this.repositories = isPlayerStatsRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async getMyStats(userId: string): Promise<PlayerStats> {
    const memberships = await this.repositories.friendsGroupUsers.listForUser(userId);

    let weeksWon = 0;
    let timesLastPlace = 0;
    let bestWinStreak: WinStreak = { length: 0, friendsGroupId: null, friendsGroupName: null };

    const currentWindowScores: number[] = [];
    const previousWindowScores: number[] = [];

    for (const membership of memberships) {
      const friendsGroupId = membership.friends_group.id;
      const friendsGroupName = membership.friends_group.name;

      const rows = await this.repositories.weeklyScores.listByGroupPaginated({ friendsGroupId });

      const weekMap = new Map<number, WeeklyScoreRow[]>();
      for (const row of rows) {
        const weekRows = weekMap.get(row.week_number) ?? [];
        weekRows.push(row);
        weekMap.set(row.week_number, weekRows);
      }

      const weekNumbers = [...weekMap.keys()].sort((a, b) => a - b);

      let currentStreak = 0;
      let previousWeekNumber: number | null = null;

      for (const weekNumber of weekNumbers) {
        const weekRows = weekMap.get(weekNumber)!;
        const userRow = weekRows.find((row) => row.user_id === userId);
        const topPoints = Math.max(...weekRows.map((row) => row.points_earned));
        const bottomPoints = Math.min(...weekRows.map((row) => row.points_earned));

        const isWin = Boolean(userRow) && userRow!.points_earned === topPoints;
        const isLast = Boolean(userRow) && userRow!.points_earned === bottomPoints;

        if (isWin) weeksWon += 1;
        if (isLast) timesLastPlace += 1;

        const isConsecutiveWithPrevious =
          previousWeekNumber !== null && weekNumber === previousWeekNumber + 1;
        currentStreak = isWin ? (isConsecutiveWithPrevious ? currentStreak + 1 : 1) : 0;

        if (currentStreak > bestWinStreak.length) {
          bestWinStreak = { length: currentStreak, friendsGroupId, friendsGroupName };
        }

        previousWeekNumber = weekNumber;
      }

      const recentWeekNumbers = weekNumbers.slice(-GSCORE_WINDOW_SIZE);
      const priorWeekNumbers = weekNumbers.slice(
        Math.max(0, weekNumbers.length - GSCORE_WINDOW_SIZE * 2),
        Math.max(0, weekNumbers.length - GSCORE_WINDOW_SIZE)
      );

      for (const weekNumber of recentWeekNumbers) {
        currentWindowScores.push(computeWeekScore(weekMap.get(weekNumber)!, userId));
      }
      for (const weekNumber of priorWeekNumbers) {
        previousWindowScores.push(computeWeekScore(weekMap.get(weekNumber)!, userId));
      }
    }

    const gScore = currentWindowScores.length
      ? Math.round(average(currentWindowScores) * 1000)
      : 0;
    const previousGScore = previousWindowScores.length
      ? Math.round(average(previousWindowScores) * 1000)
      : null;
    const trend: PlayerStats["trend"] =
      previousGScore === null
        ? null
        : gScore > previousGScore
          ? "up"
          : gScore < previousGScore
            ? "down"
            : "flat";

    const [predictionRows, redCardRows] = await Promise.all([
      this.repositories.predictions.listByUserId(userId),
      this.repositories.redCardPredictions.listByUserId(userId),
    ]);

    const dedupedPredictions = dedupeByFixture(predictionRows, (row) => row.updated_at);
    const dedupedRedCards = dedupeByFixture(redCardRows, (row) => row.created_at);

    const fixtureIds = [
      ...new Set([
        ...dedupedPredictions.map((row) => row.fixture_id),
        ...dedupedRedCards.map((row) => row.fixture_id),
      ]),
    ];

    const fixtures = await this.repositories.fixtures.listByIds(fixtureIds);
    const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

    let exactScoreCount = 0;
    let correctResultCount = 0;
    let totalFixturesPredicted = 0;

    for (const prediction of dedupedPredictions) {
      const fixture = fixtureById.get(prediction.fixture_id);
      if (!fixture || fixture.home_score === null || fixture.away_score === null) continue;

      totalFixturesPredicted += 1;

      const isExact =
        prediction.home_score_prediction === fixture.home_score &&
        prediction.away_score_prediction === fixture.away_score;
      const predictedSign = resultSign(
        prediction.home_score_prediction,
        prediction.away_score_prediction
      );
      const actualSign = resultSign(fixture.home_score, fixture.away_score);

      if (isExact) exactScoreCount += 1;
      if (isExact || predictedSign === actualSign) correctResultCount += 1;
    }

    let redCardGuessesTotal = 0;
    let redCardGuessesCorrect = 0;

    for (const pick of dedupedRedCards) {
      const fixture = fixtureById.get(pick.fixture_id);
      if (!fixture || fixture.home_score === null || fixture.away_score === null) continue;

      redCardGuessesTotal += 1;
      if (fixture.has_red_card) redCardGuessesCorrect += 1;
    }

    const accuracy = totalFixturesPredicted ? correctResultCount / totalFixturesPredicted : 0;
    const redCardAccuracy = redCardGuessesTotal ? redCardGuessesCorrect / redCardGuessesTotal : 0;

    return {
      gScore,
      trend,
      accuracy,
      exactScoreCount,
      correctResultCount,
      totalFixturesPredicted,
      weeksWon,
      winStreak: bestWinStreak,
      timesLastPlace,
      redCardGuessesTotal,
      redCardGuessesCorrect,
      redCardAccuracy,
    };
  }
}

// A missed week must contribute a hard 0 (not be skipped) so a poor/quiet
// week visibly drags the rolling G-Score down -- see PlayerStats plan.
function computeWeekScore(weekRows: WeeklyScoreRow[], userId: string): number {
  const userRow = weekRows.find((row) => row.user_id === userId);
  if (!userRow) return 0;

  const participation = 1;
  const accuracy =
    userRow.fixtures_predicted > 0
      ? userRow.correct_result_points / userRow.fixtures_predicted
      : 0;
  const ceiling = userRow.fixtures_predicted * 2 + 2 + 5;
  const normalizedPoints = ceiling > 0 ? Math.min(userRow.points_earned / ceiling, 1) : 0;

  return (
    PARTICIPATION_WEIGHT * participation +
    ACCURACY_WEIGHT * accuracy +
    POINTS_WEIGHT * normalizedPoints
  );
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resultSign(home: number, away: number): "H" | "A" | "D" {
  if (home > away) return "H";
  if (home < away) return "A";
  return "D";
}

// The same real guess can exist as one row per friends group (submitted
// manually or via the quick-fill "Submit Latest Guesses" feature); counting
// personal-accuracy stats without deduplicating by fixture_id would inflate
// with group membership rather than measure skill. Latest submission wins
// for the rare case where a user entered genuinely different guesses for
// the same fixture in different groups.
function dedupeByFixture<T extends { fixture_id: number }>(
  rows: T[],
  sortKey: (row: T) => string
): T[] {
  const byFixture = new Map<number, T>();
  for (const row of rows) {
    const existing = byFixture.get(row.fixture_id);
    if (!existing || sortKey(row) > sortKey(existing)) {
      byFixture.set(row.fixture_id, row);
    }
  }
  return [...byFixture.values()];
}

function isPlayerStatsRepositories(
  value: SupabaseClient<Database> | PlayerStatsRepositories
): value is PlayerStatsRepositories {
  return (
    "friendsGroupUsers" in value &&
    "weeklyScores" in value &&
    "predictions" in value &&
    "redCardPredictions" in value &&
    "fixtures" in value
  );
}
