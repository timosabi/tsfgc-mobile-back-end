import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type {
  PermutationGenerator,
  PermutationContext,
  PermutationScenario,
} from "./PermutationChatGenerator.js";

type FixtureRow = Database["public"]["Tables"]["fixtures"]["Row"];
type GroupRow = Pick<Database["public"]["Tables"]["friends_groups"]["Row"], "id" | "name">;
type PredictionRow = Pick<
  Database["public"]["Tables"]["predictions"]["Row"],
  "user_id" | "fixture_id" | "home_score_prediction" | "away_score_prediction"
>;
type RedCardRow = Pick<
  Database["public"]["Tables"]["red_card_predictions"]["Row"],
  "user_id" | "fixture_id"
>;
type ResultSign = "home" | "away" | "draw";

type ScoreTally = {
  exact_score_points: number;
  correct_result_points: number;
  total_goals_bonus: number;
  red_card_bonus: number;
  points_earned: number;
};

const MAX_SCENARIOS = 8;
// "N or more goals" band -- beyond this, further breakpoints stop being
// worth a distinct mention (a realistic top end for a single fixture).
const GOAL_SWEEP_CAP = 8;

type MatchweekPermutationRepositories = Pick<
  Repositories,
  "predictions" | "redCardPredictions" | "userSubmissions" | "profiles" | "liveFeedEvents"
>;

export default class MatchweekPermutationService {
  private readonly repositories: MatchweekPermutationRepositories;

  constructor(
    clientOrRepositories: SupabaseClient<Database> | MatchweekPermutationRepositories,
    private readonly generator: PermutationGenerator
  ) {
    this.repositories = isMatchweekPermutationRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  // Called once per fixture kickoff (already durably deduped upstream by
  // LiveFeedService's smEventId check -- see processEvent) so this never
  // needs its own dedup bookkeeping. A no-op unless `fixture` is genuinely
  // the last-scheduled fixture of its matchweek with every other fixture
  // already finished.
  async checkAndNotify(params: {
    fixtureId: number;
    allMatchweekFixtures: FixtureRow[];
    groups: GroupRow[];
  }): Promise<void> {
    if (!params.groups.length) return;

    const targetFixture = params.allMatchweekFixtures.find(
      (fixture) => fixture.id === params.fixtureId
    );
    if (!targetFixture || !targetFixture.matchweek) return;

    const lastFixture = [...params.allMatchweekFixtures].sort(
      (a, b) => this.fixtureTime(b) - this.fixtureTime(a)
    )[0];
    if (!lastFixture || lastFixture.id !== targetFixture.id) return;

    const others = params.allMatchweekFixtures.filter(
      (fixture) => fixture.id !== targetFixture.id
    );
    if (!others.every((fixture) => fixture.status === "finished")) return;

    await Promise.all(
      params.groups.map((group) =>
        this.notifyGroup(group, targetFixture, params.allMatchweekFixtures)
      )
    );
  }

  private async notifyGroup(
    group: GroupRow,
    targetFixture: FixtureRow,
    allMatchweekFixtures: FixtureRow[]
  ): Promise<void> {
    const finishedFixtures = allMatchweekFixtures.filter(
      (fixture) => fixture.id !== targetFixture.id
    );
    const fixtureIds = allMatchweekFixtures.map((fixture) => fixture.id);

    const submittedUsers = await this.repositories.userSubmissions.listSubmittedUserIds(
      group.id,
      targetFixture.matchweek!
    );
    const submittedUserIds = Array.from(
      new Set(submittedUsers.map((row) => row.user_id))
    );
    if (!submittedUserIds.length) return;

    const [predictions, redCards] = await Promise.all([
      this.repositories.predictions.listByGroupFixturesUsers(
        group.id,
        fixtureIds,
        submittedUserIds,
        "user_id, fixture_id, home_score_prediction, away_score_prediction"
      ) as Promise<PredictionRow[]>,
      this.repositories.redCardPredictions.listByGroupFixturesUsers(
        group.id,
        fixtureIds,
        submittedUserIds,
        "user_id, fixture_id"
      ) as Promise<RedCardRow[]>,
    ]);

    const targetPredictions = predictions.filter(
      (prediction) => prediction.fixture_id === targetFixture.id
    );
    if (!targetPredictions.length) return;

    const names = await this.getDisplayNames(submittedUserIds);
    const nameFor = (userId: string) => names.get(userId) ?? "Player";

    const baseline = this.tallyPartial(finishedFixtures, predictions, submittedUserIds);
    const baselineLeaders = this.leadersOf(baseline).map(nameFor);

    const scenarios: PermutationScenario[] = [];

    // Every distinct scoreline someone actually predicted for this fixture,
    // plus a small set of "generic" representative scorelines (one per
    // result type, and one per goal-total breakpoint where the Goal Bonus
    // recipient changes) that don't collide with anyone's specific guess --
    // together these cover both "someone calls it exactly" and "the shape
    // of the result matters even if nobody called it exactly" scenarios.
    const seen = new Set<string>();
    const candidates: Array<{
      home: number;
      away: number;
      exactGuessers: string[];
    }> = [];

    for (const prediction of targetPredictions) {
      const key = `${prediction.home_score_prediction}-${prediction.away_score_prediction}`;
      const existing = candidates.find(
        (candidate) =>
          candidate.home === prediction.home_score_prediction &&
          candidate.away === prediction.away_score_prediction
      );
      if (existing) {
        existing.exactGuessers.push(names.get(prediction.user_id) ?? "Someone");
      } else {
        candidates.push({
          home: prediction.home_score_prediction,
          away: prediction.away_score_prediction,
          exactGuessers: [names.get(prediction.user_id) ?? "Someone"],
        });
      }
      seen.add(key);
    }

    for (const [home, away] of [
      [1, 0],
      [0, 0],
      [0, 1],
    ] as const) {
      const key = `${home}-${away}`;
      if (!seen.has(key)) {
        candidates.push({ home, away, exactGuessers: [] });
        seen.add(key);
      }
    }

    const lockedGoalsSoFar = finishedFixtures.reduce(
      (total, fixture) => total + (fixture.home_score ?? 0) + (fixture.away_score ?? 0),
      0
    );
    const predictionCountsByUser = new Map<string, number>();
    const predictedTotalsByUser = new Map<string, number>();
    for (const prediction of predictions) {
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
    }

    let previousBonusWinners: string | null = null;
    for (let goalsInLastGame = 0; goalsInLastGame <= GOAL_SWEEP_CAP; goalsInLastGame += 1) {
      const winners = this.nearestTotalGoalUsers({
        userIds: submittedUserIds,
        predictionCountsByUser,
        predictedTotalsByUser,
        expectedFixtureCount: allMatchweekFixtures.length,
        actualTotalGoals: lockedGoalsSoFar + goalsInLastGame,
      });
      const winnerKey = [...winners].sort().join(",");
      if (winnerKey !== previousBonusWinners) {
        previousBonusWinners = winnerKey;
        const home = Math.ceil(goalsInLastGame / 2);
        const away = Math.floor(goalsInLastGame / 2);
        const key = `${home}-${away}`;
        if (!seen.has(key)) {
          candidates.push({ home, away, exactGuessers: [] });
          seen.add(key);
        }
      }
    }

    // Reserve one slot for the red card overlay below, if there is one.
    for (const candidate of candidates.slice(0, MAX_SCENARIOS - 1)) {
      const hypothetical = [
        ...finishedFixtures,
        {
          ...targetFixture,
          status: "finished",
          home_score: candidate.home,
          away_score: candidate.away,
        },
      ];
      const tally = this.tallyFinal({
        fixtures: hypothetical,
        predictions,
        redCards,
        submittedUserIds,
        expectedFixtureCount: allMatchweekFixtures.length,
      });
      const leaders = this.leadersOf(tally).map(nameFor);

      scenarios.push({
        outcome: candidate.exactGuessers.length
          ? `${candidate.home}-${candidate.away} exactly (${candidate.exactGuessers.join(" or ")}'s call)`
          : `a ${candidate.home}-${candidate.away}-shaped result (${
              candidate.home + candidate.away
            } total goals)`,
        leaders,
        tied: leaders.length > 1,
      });
    }

    const redCardPickerIds = new Set(
      redCards
        .filter((row) => row.fixture_id === targetFixture.id)
        .map((row) => row.user_id)
    );
    if (redCardPickerIds.size) {
      const withRedCard = new Map(baseline);
      for (const [userId, row] of baseline) {
        if (redCardPickerIds.has(userId)) {
          withRedCard.set(userId, {
            ...row,
            red_card_bonus: row.red_card_bonus + 5,
            points_earned: row.points_earned + 5,
          });
        }
      }
      const redCardLeaders = this.leadersOf(withRedCard).map(nameFor);
      scenarios.push({
        outcome: `a red card in this match (${Array.from(redCardPickerIds)
          .map(nameFor)
          .join(" or ")}'s pick)`,
        leaders: redCardLeaders,
        tied: redCardLeaders.length > 1,
      });
    }

    if (!scenarios.length) return;

    const context: PermutationContext = {
      groupName: group.name,
      matchweek: targetFixture.matchweek!,
      fixtureName: `${targetFixture.home_team} vs ${targetFixture.away_team}`,
      currentStandings: baselineLeaders.map((name) => ({ name, points: 0 })),
      scenarios,
    };

    const message = await this.generator.generate(context);

    await this.repositories.liveFeedEvents.upsertFeedEvent({
      friends_group_id: group.id,
      fixture_id: targetFixture.id,
      matchweek: targetFixture.matchweek,
      sm_fixture_id: targetFixture.sm_fixture_id,
      event_key: `${targetFixture.id}:permutations`,
      event_type: "permutations",
      payload: { ...context, stage: "permutations" } as unknown as Json,
      ai_message: message,
    });
  }

  private async getDisplayNames(userIds: string[]): Promise<Map<string, string>> {
    const profiles = await this.repositories.profiles.listDisplayNamesByIds(userIds);
    const names = new Map<string, string>();
    for (const profile of profiles) names.set(profile.id, profile.display_name ?? "Player");
    return names;
  }

  // Correct-result + exact-score only -- the Goal Bonus can't be known
  // until every fixture in the matchweek (including the one still to
  // kick off) has a final score, so it's never attempted here.
  private tallyPartial(
    fixtures: FixtureRow[],
    predictions: PredictionRow[],
    submittedUserIds: string[]
  ): Map<string, ScoreTally> {
    const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
    const rows = new Map<string, ScoreTally>();
    for (const userId of submittedUserIds) rows.set(userId, this.emptyTally());

    for (const prediction of predictions) {
      const fixture = fixtureById.get(prediction.fixture_id);
      const actual = fixture ? this.scoreForFixture(fixture) : null;
      if (!fixture || !actual) continue;

      const row = rows.get(prediction.user_id);
      if (!row) continue;
      const exact =
        prediction.home_score_prediction === actual.home &&
        prediction.away_score_prediction === actual.away;
      if (exact) {
        row.correct_result_points += 1;
        row.exact_score_points += 2;
      } else if (
        this.resultSign(prediction.home_score_prediction, prediction.away_score_prediction) ===
        this.resultSign(actual.home, actual.away)
      ) {
        row.correct_result_points += 1;
      }
      row.points_earned = row.exact_score_points + row.correct_result_points;
      rows.set(prediction.user_id, row);
    }

    return rows;
  }

  // Full finalize-style tally (Correct Result + Exact Score + Goal Bonus +
  // Red Card), mirroring WeeklyScoreService.calculateForFriendsGroupMatchweek's
  // math -- but over an in-memory fixture list with the target fixture's
  // score substituted in, rather than requiring it to already be finished
  // in the DB (MatchweekOverviewService.getMatchweekScores's
  // fixtureScoreOverride can't be reused here since it deliberately excludes
  // the Goal Bonus from the total for still-in-progress weeks).
  private tallyFinal(params: {
    fixtures: FixtureRow[];
    predictions: PredictionRow[];
    redCards: RedCardRow[];
    submittedUserIds: string[];
    expectedFixtureCount: number;
  }): Map<string, ScoreTally> {
    const fixtureById = new Map(params.fixtures.map((fixture) => [fixture.id, fixture]));
    const rows = new Map<string, ScoreTally>();
    for (const userId of params.submittedUserIds) rows.set(userId, this.emptyTally());

    const predictionCountsByUser = new Map<string, number>();
    const predictedTotalsByUser = new Map<string, number>();
    const actualTotalGoals = params.fixtures.reduce((total, fixture) => {
      const actual = this.scoreForFixture(fixture);
      return actual ? total + actual.home + actual.away : total;
    }, 0);

    for (const prediction of params.predictions) {
      const row = rows.get(prediction.user_id);
      const fixture = fixtureById.get(prediction.fixture_id);
      const actual = fixture ? this.scoreForFixture(fixture) : null;
      if (!row || !fixture || !actual) continue;

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
        prediction.home_score_prediction === actual.home &&
        prediction.away_score_prediction === actual.away;
      if (exact) {
        row.correct_result_points += 1;
        row.exact_score_points += 2;
      } else if (
        this.resultSign(prediction.home_score_prediction, prediction.away_score_prediction) ===
        this.resultSign(actual.home, actual.away)
      ) {
        row.correct_result_points += 1;
      }
    }

    const goalBonusWinners = this.nearestTotalGoalUsers({
      userIds: params.submittedUserIds,
      predictionCountsByUser,
      predictedTotalsByUser,
      expectedFixtureCount: params.expectedFixtureCount,
      actualTotalGoals,
    });
    for (const userId of goalBonusWinners) {
      const row = rows.get(userId);
      if (row) row.total_goals_bonus += 2;
    }

    const redCardHitUserIds = new Set<string>();
    for (const redCard of params.redCards) {
      const fixture = fixtureById.get(redCard.fixture_id);
      if (fixture?.has_red_card === true) redCardHitUserIds.add(redCard.user_id);
    }
    for (const userId of redCardHitUserIds) {
      const row = rows.get(userId);
      if (row) row.red_card_bonus += 5;
    }

    for (const row of rows.values()) {
      row.points_earned =
        row.exact_score_points +
        row.correct_result_points +
        row.total_goals_bonus +
        row.red_card_bonus;
    }

    return rows;
  }

  private nearestTotalGoalUsers(params: {
    userIds: string[];
    predictionCountsByUser: Map<string, number>;
    predictedTotalsByUser: Map<string, number>;
    expectedFixtureCount: number;
    actualTotalGoals: number;
  }): string[] {
    if (params.expectedFixtureCount <= 0) return [];

    let bestDistance: number | null = null;
    const winners: string[] = [];

    for (const userId of params.userIds) {
      if (
        (params.predictionCountsByUser.get(userId) ?? 0) !== params.expectedFixtureCount
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

  // Names aren't known inside this helper -- callers pass a map already
  // keyed by user id, so this returns user ids; notifyGroup maps them to
  // display names via `names` before use. Ties are decided by
  // points_earned ALONE, matching MatchweekOverviewService.rankScores's
  // actual tie semantics -- exact_score_points/correct_result_points are
  // only a display sort-order tie-break there (see rankScores's
  // tiedWithPrevious check, which compares points_earned only), never a
  // reason to call an equal-points pair anything but a genuine tie.
  private leadersOf(rows: Map<string, ScoreTally>): string[] {
    let bestPoints = -Infinity;
    let leaders: string[] = [];
    for (const [userId, row] of rows) {
      if (row.points_earned > bestPoints) {
        bestPoints = row.points_earned;
        leaders = [userId];
      } else if (row.points_earned === bestPoints) {
        leaders.push(userId);
      }
    }
    return leaders;
  }

  private emptyTally(): ScoreTally {
    return {
      exact_score_points: 0,
      correct_result_points: 0,
      total_goals_bonus: 0,
      red_card_bonus: 0,
      points_earned: 0,
    };
  }

  private scoreForFixture(fixture: FixtureRow): { home: number; away: number } | null {
    const home = fixture.status === "live" ? fixture.live_home_score ?? fixture.home_score : fixture.home_score;
    const away = fixture.status === "live" ? fixture.live_away_score ?? fixture.away_score : fixture.away_score;
    if (home === null || away === null) return null;
    return { home, away };
  }

  private resultSign(home: number, away: number): ResultSign {
    if (home > away) return "home";
    if (away > home) return "away";
    return "draw";
  }

  private fixtureTime(fixture: FixtureRow): number {
    const raw = fixture.starting_at ?? `${fixture.match_date}T${fixture.match_time}Z`;
    const time = new Date(raw).getTime();
    return Number.isFinite(time) ? time : 0;
  }
}

function isMatchweekPermutationRepositories(
  value: SupabaseClient<Database> | MatchweekPermutationRepositories
): value is MatchweekPermutationRepositories {
  return "predictions" in value && "userSubmissions" in value;
}
