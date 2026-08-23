import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { AppError } from "../middleware/errorHandler.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type { OverviewFixtureRow } from "../repositories/FixturesRepository.js";
import type { FriendsGroupOverviewRow } from "../repositories/FriendsGroupsRepository.js";
import type { FriendsGroupMemberRef } from "../repositories/FriendsGroupUsersRepository.js";
import type { ActiveSubscriptionRef } from "../repositories/FriendsGroupSubscriptionsRepository.js";
import type { ProfilePreview } from "../repositories/ProfilesRepository.js";

type FriendsGroupRow = FriendsGroupOverviewRow;
type SubscriptionRow = Pick<
  ActiveSubscriptionRef,
  "provider_league_id" | "provider_season_id"
>;
type FixtureRow = OverviewFixtureRow;
type FriendsGroupUserRow = FriendsGroupMemberRef;
type ProfileRow = ProfilePreview;
type PredictionRow = Pick<
  Database["public"]["Tables"]["predictions"]["Row"],
  "user_id" | "fixture_id" | "home_score_prediction" | "away_score_prediction"
>;
type RedCardPredictionRow = Pick<
  Database["public"]["Tables"]["red_card_predictions"]["Row"],
  "user_id" | "fixture_id"
>;
type SubmissionRow = Pick<
  Database["public"]["Tables"]["user_submissions"]["Row"],
  "user_id" | "submitted_at"
>;
type WeeklyScoreRow = Database["public"]["Tables"]["weekly_scores"]["Row"];
type LiveFeedRow = Database["public"]["Tables"]["live_feed_events"]["Row"];
type MatchweekOverviewRepositories = Pick<
  Repositories,
  | "fixtures"
  | "friendsGroups"
  | "friendsGroupSubscriptions"
  | "friendsGroupUsers"
  | "liveFeedEvents"
  | "predictions"
  | "profiles"
  | "redCardPredictions"
  | "userSubmissions"
  | "weeklyScores"
>;

type MatchweekState = "editable" | "locked" | "live" | "finished";
type ScoreBreakdown = {
  user_id: string;
  friends_group_id: string;
  week_number: number;
  fixtures_predicted: number;
  exact_score_points: number;
  correct_result_points: number;
  total_goals_bonus: number;
  red_card_bonus: number;
  points_earned: number;
  group_points: number;
  provisional: boolean;
  rank?: number;
};
type MatchweekScoreRow = {
  user_id: string;
  exact_score_points: number;
  correct_result_points: number;
  total_goals_bonus: number;
  red_card_bonus: number;
  points_earned: number;
  provisional: boolean;
  rank?: number;
};
type ResultSign = "home" | "away" | "draw";

export default class MatchweekOverviewService {
  private readonly repositories: MatchweekOverviewRepositories;

  constructor(clientOrRepositories: SupabaseClient<Database> | MatchweekOverviewRepositories) {
    this.repositories = isMatchweekOverviewRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async getOverview(params: {
    userId: string;
    friendsGroupId: string;
    matchweek: string | "current";
  }) {
    const { friendsGroup, subscription } = await this.getGroupContext(
      params.friendsGroupId
    );
    const allFixtures = await this.getSubscriptionFixtures(subscription);
    if (!allFixtures.length) {
      throw new AppError("No fixtures found for friends group subscription", 404);
    }

    const matchweeks = this.groupByMatchweek(allFixtures);
    const openMatchweeks = await this.repositories.fixtures.listOpenMatchweeks({
      providerLeagueId: subscription.provider_league_id,
      providerSeasonId: subscription.provider_season_id,
    });
    const selectedMatchweek =
      params.matchweek === "current"
        ? this.pickCurrentMatchweek(matchweeks)
        : params.matchweek;
    const fixtures = matchweeks.get(selectedMatchweek);
    if (!fixtures?.length) throw new AppError("No fixtures found for matchweek", 404);
    if (params.matchweek !== "current" && !openMatchweeks.includes(selectedMatchweek)) {
      throw new AppError("This matchweek isn't open yet", 403);
    }

    const locksAt = this.matchweekLocksAt(fixtures);
    const state = this.getState(fixtures);
    const locked = state !== "editable";
    const canViewAllPredictions = locked;
    const fixtureIds = fixtures.map((fixture) => fixture.id);
    const weekNumber = this.weekNumberFromMatchweek(selectedMatchweek);

    const [
      members,
      submissions,
      predictions,
      redCards,
      persistedScores,
      liveFeed,
    ] = await Promise.all([
      this.getMembers(params.friendsGroupId),
      this.getSubmissions(params.friendsGroupId, selectedMatchweek),
      this.getPredictions(params.friendsGroupId, fixtureIds),
      this.getRedCards(params.friendsGroupId, fixtureIds),
      this.getWeeklyScores(params.friendsGroupId, weekNumber),
      this.getLiveFeed(params.friendsGroupId, selectedMatchweek),
    ]);

    const userIds = Array.from(
      new Set([
        ...members.map((member) => member.user_id),
        ...submissions.map((submission) => submission.user_id),
        ...persistedScores.map((score) => score.user_id),
      ])
    );
    const profiles = await this.getProfiles(userIds);

    const submittedUserIds = submissions.map((submission) => submission.user_id);
    const predictionUsers = canViewAllPredictions
      ? Array.from(new Set([...submittedUserIds, params.userId]))
      : [params.userId];
    const predictionsByUser = this.groupPredictionsByUser(
      predictions.filter((prediction) => predictionUsers.includes(prediction.user_id))
    );
    const redCardByUser = this.groupRedCardsByUser(
      redCards.filter((redCard) => predictionUsers.includes(redCard.user_id))
    );
    const submissionsByUser = new Map(
      submissions.map((submission) => [submission.user_id, submission])
    );

    const scores =
      persistedScores.length > 0
        ? this.normalizePersistedScores(persistedScores, params.friendsGroupId)
        : this.calculateProvisionalScores({
            friendsGroupId: params.friendsGroupId,
            weekNumber,
            fixtures,
            predictions,
            redCards,
            submittedUserIds,
          });
    this.rankScores(scores);
    const scoresByUser = new Map(scores.map((score) => [score.user_id, score]));

    const myPrediction = this.buildPredictionSlip({
      userId: params.userId,
      submittedAt: submissionsByUser.get(params.userId)?.submitted_at ?? null,
      predictions: predictionsByUser.get(params.userId) ?? [],
      redCardFixtureId: redCardByUser.get(params.userId) ?? null,
      locked,
    });

    return {
      friendsGroup,
      selectedMatchweek,
      locksAt,
      state,
      navigation: this.buildNavigation(matchweeks, selectedMatchweek, openMatchweeks),
      permissions: {
        canEditPredictions: state === "editable",
        canSubmitPredictions: state === "editable",
        canViewAllPredictions,
        shouldPoll: state === "live",
      },
      fixtures,
      myPrediction,
      members: members.map((member) => {
        const predictionVisible =
          member.user_id === params.userId ||
          (canViewAllPredictions && submissionsByUser.has(member.user_id));
        return {
          userId: member.user_id,
          role: member.role,
          joinedAt: member.joined_at,
          profile: profiles.get(member.user_id) ?? null,
          submitted: submissionsByUser.has(member.user_id),
          submittedAt: submissionsByUser.get(member.user_id)?.submitted_at ?? null,
          score: this.toMatchweekScoreRow(
            scoresByUser.get(member.user_id) ??
              this.emptyScore(member.user_id, params.friendsGroupId, weekNumber)
          ),
          prediction: predictionVisible
            ? this.buildPredictionSlip({
                userId: member.user_id,
                submittedAt:
                  submissionsByUser.get(member.user_id)?.submitted_at ?? null,
                predictions: predictionsByUser.get(member.user_id) ?? [],
                redCardFixtureId: redCardByUser.get(member.user_id) ?? null,
                locked,
              })
            : null,
        };
      }),
      scores: {
        rows: scores.map((score) => this.toMatchweekScoreRow(score)),
      },
      liveFeed,
    };
  }

  private async getGroupContext(friendsGroupId: string) {
    const [friendsGroup, subscription] = await Promise.all([
      this.repositories.friendsGroups.findOverviewById(friendsGroupId),
      this.repositories.friendsGroupSubscriptions.findActiveByFriendsGroup(
        friendsGroupId
      ),
    ]);
    if (!friendsGroup) throw new AppError("Friends group not found", 404);
    if (!subscription) {
      throw new AppError("Friends group has no active subscription", 400);
    }

    return {
      friendsGroup: friendsGroup as FriendsGroupRow,
      subscription: subscription as SubscriptionRow,
    };
  }

  private async getSubscriptionFixtures(subscription: SubscriptionRow) {
    return this.repositories.fixtures.listOverviewFixturesForSubscription({
      providerLeagueId: subscription.provider_league_id,
      providerSeasonId: subscription.provider_season_id,
    });
  }

  private async getMembers(friendsGroupId: string): Promise<FriendsGroupUserRow[]> {
    return this.repositories.friendsGroupUsers.listMembers(friendsGroupId);
  }

  private async getSubmissions(
    friendsGroupId: string,
    matchweek: string
  ): Promise<SubmissionRow[]> {
    return this.repositories.userSubmissions.listSubmittedUsers(
      friendsGroupId,
      matchweek
    );
  }

  private async getPredictions(
    friendsGroupId: string,
    fixtureIds: number[]
  ): Promise<PredictionRow[]> {
    if (!fixtureIds.length) return [];
    return this.repositories.predictions.listByGroupFixtures(
      friendsGroupId,
      fixtureIds,
      "user_id, fixture_id, home_score_prediction, away_score_prediction"
    );
  }

  private async getRedCards(
    friendsGroupId: string,
    fixtureIds: number[]
  ): Promise<RedCardPredictionRow[]> {
    if (!fixtureIds.length) return [];
    return this.repositories.redCardPredictions.listByGroupFixtures(
      friendsGroupId,
      fixtureIds,
      "user_id, fixture_id"
    );
  }

  private async getWeeklyScores(
    friendsGroupId: string,
    weekNumber: number
  ): Promise<WeeklyScoreRow[]> {
    return this.repositories.weeklyScores.listByGroupWeek(
      friendsGroupId,
      weekNumber,
      true
    );
  }

  private async getLiveFeed(
    friendsGroupId: string,
    matchweek: string
  ): Promise<LiveFeedRow[]> {
    return this.repositories.liveFeedEvents.listByGroupMatchweek(
      friendsGroupId,
      matchweek
    );
  }

  private async getProfiles(userIds: string[]) {
    const profiles = new Map<string, ProfileRow>();
    if (!userIds.length) return profiles;
    const data = await this.repositories.profiles.listPreviewsByIds(userIds);
    for (const profile of data) profiles.set(profile.id, profile);
    return profiles;
  }

  private groupByMatchweek(fixtures: FixtureRow[]) {
    const matchweeks = new Map<string, FixtureRow[]>();
    for (const fixture of fixtures) {
      if (!fixture.matchweek) continue;
      const rows = matchweeks.get(fixture.matchweek) ?? [];
      rows.push(fixture);
      matchweeks.set(fixture.matchweek, rows);
    }
    return new Map(
      Array.from(matchweeks.entries()).sort(
        ([a], [b]) => this.weekNumberFromMatchweek(a) - this.weekNumberFromMatchweek(b)
      )
    );
  }

  private pickCurrentMatchweek(matchweeks: Map<string, FixtureRow[]>) {
    const entries = Array.from(matchweeks.entries());
    const live = entries.find(([, fixtures]) =>
      fixtures.some((fixture) => fixture.status === "live")
    );
    if (live) return live[0];

    const next = entries.find(([, fixtures]) =>
      fixtures.some((fixture) => fixture.status !== "finished")
    );
    if (next) return next[0];

    return entries.length ? entries[entries.length - 1][0] : "Matchweek 1";
  }

  private buildNavigation(
    matchweeks: Map<string, FixtureRow[]>,
    selected: string,
    openMatchweeks: string[]
  ) {
    const keys = Array.from(matchweeks.keys());
    const index = keys.indexOf(selected);
    const current = this.pickCurrentMatchweek(matchweeks);
    return {
      current,
      previous: index > 0 ? keys[index - 1] : null,
      next: index >= 0 && index < keys.length - 1 ? keys[index + 1] : null,
      available: keys,
      openMatchweeks,
    };
  }

  private getState(fixtures: FixtureRow[]): MatchweekState {
    if (fixtures.length && fixtures.every((fixture) => fixture.status === "finished")) {
      return "finished";
    }
    if (fixtures.some((fixture) => fixture.status === "live")) return "live";
    return this.isLocked(fixtures) ? "locked" : "editable";
  }

  private buildPredictionSlip(params: {
    userId: string;
    submittedAt: string | null;
    predictions: PredictionRow[];
    redCardFixtureId: number | null;
    locked: boolean;
  }) {
    return {
      userId: params.userId,
      submitted: Boolean(params.submittedAt),
      submittedAt: params.submittedAt,
      locked: params.locked,
      predictions: params.predictions,
      redCardFixtureId: params.redCardFixtureId,
    };
  }

  private groupPredictionsByUser(predictions: PredictionRow[]) {
    const byUser = new Map<string, PredictionRow[]>();
    for (const prediction of predictions) {
      const rows = byUser.get(prediction.user_id) ?? [];
      rows.push(prediction);
      byUser.set(prediction.user_id, rows);
    }
    return byUser;
  }

  private groupRedCardsByUser(redCards: RedCardPredictionRow[]) {
    const byUser = new Map<string, number>();
    for (const redCard of redCards) byUser.set(redCard.user_id, redCard.fixture_id);
    return byUser;
  }

  private normalizePersistedScores(
    rows: WeeklyScoreRow[],
    friendsGroupId: string
  ): ScoreBreakdown[] {
    return rows.map((row) => ({
      user_id: row.user_id,
      friends_group_id: friendsGroupId,
      week_number: row.week_number,
      fixtures_predicted: row.fixtures_predicted,
      exact_score_points: row.exact_score_points,
      correct_result_points: row.correct_result_points,
      total_goals_bonus: row.total_goals_bonus,
      red_card_bonus: row.red_card_bonus,
      points_earned: row.points_earned,
      group_points: row.group_points,
      provisional: false,
    }));
  }

  private calculateProvisionalScores(params: {
    friendsGroupId: string;
    weekNumber: number;
    fixtures: FixtureRow[];
    predictions: PredictionRow[];
    redCards: RedCardPredictionRow[];
    submittedUserIds: string[];
  }) {
    const fixtureById = new Map(params.fixtures.map((fixture) => [fixture.id, fixture]));
    const redCardHitUserIds = new Set<string>();
    for (const redCard of params.redCards) {
      const fixture = fixtureById.get(redCard.fixture_id);
      if (fixture?.has_red_card === true) redCardHitUserIds.add(redCard.user_id);
    }

    const rowsByUser = new Map<string, ScoreBreakdown>();
    const predictionCountsByUser = new Map<string, number>();
    const predictedTotalsByUser = new Map<string, number>();
    const actualTotalGoals = params.fixtures.reduce((total, fixture) => {
      const actual = this.scoreForFixture(fixture);
      return actual ? total + actual.home + actual.away : total;
    }, 0);
    const scoredFixtureCount = params.fixtures.filter((fixture) =>
      Boolean(this.scoreForFixture(fixture))
    ).length;

    for (const userId of params.submittedUserIds) {
      rowsByUser.set(
        userId,
        this.emptyScore(userId, params.friendsGroupId, params.weekNumber, true)
      );
    }

    for (const prediction of params.predictions) {
      const row = rowsByUser.get(prediction.user_id);
      const fixture = fixtureById.get(prediction.fixture_id);
      const actual = fixture ? this.scoreForFixture(fixture) : null;
      if (!row || !fixture || !actual) continue;

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

    const totalGoalBonusWinners = this.findNearestTotalGoalUsers({
      userIds: params.submittedUserIds,
      predictionCountsByUser,
      predictedTotalsByUser,
      expectedFixtureCount: scoredFixtureCount,
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

    for (const row of rowsByUser.values()) {
      // total_goals_bonus is left out of the provisional total on purpose: "closest
      // total" can only be determined once every fixture in the matchweek has a final
      // score, so crediting it mid-week would make the running total swing as the
      // standings shift. It's still awarded normally once WeeklyScoreService finalizes
      // the matchweek (see calculateAllFinished).
      row.points_earned =
        row.exact_score_points + row.correct_result_points + row.red_card_bonus;
      row.group_points = row.points_earned;
    }

    return Array.from(rowsByUser.values());
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

  private rankScores(scores: ScoreBreakdown[]) {
    scores.sort((a, b) => {
      if (b.points_earned !== a.points_earned) {
        return b.points_earned - a.points_earned;
      }
      if (b.exact_score_points !== a.exact_score_points) {
        return b.exact_score_points - a.exact_score_points;
      }
      return b.correct_result_points - a.correct_result_points;
    });
    scores.forEach((score, index) => {
      score.rank = index + 1;
    });
  }

  private emptyScore(
    userId: string,
    friendsGroupId: string,
    weekNumber: number,
    provisional = false
  ): ScoreBreakdown {
    return {
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
      provisional,
    };
  }

  private toMatchweekScoreRow(score: ScoreBreakdown): MatchweekScoreRow {
    return {
      user_id: score.user_id,
      exact_score_points: score.exact_score_points,
      correct_result_points: score.correct_result_points,
      total_goals_bonus: score.total_goals_bonus,
      red_card_bonus: score.red_card_bonus,
      points_earned: score.points_earned,
      provisional: score.provisional,
      rank: score.rank,
    };
  }

  private scoreForFixture(fixture: FixtureRow) {
    const home =
      fixture.status === "live"
        ? fixture.live_home_score ?? fixture.home_score
        : fixture.home_score;
    const away =
      fixture.status === "live"
        ? fixture.live_away_score ?? fixture.away_score
        : fixture.away_score;
    if (home === null || away === null) return null;
    return { home, away };
  }

  private isLocked(fixtures: FixtureRow[]) {
    return this.matchweekLockTime(fixtures) <= Date.now();
  }

  private matchweekLocksAt(fixtures: FixtureRow[]) {
    return new Date(this.matchweekLockTime(fixtures)).toISOString();
  }

  private matchweekLockTime(fixtures: FixtureRow[]) {
    return Math.min(...fixtures.map((fixture) => this.fixtureStartTime(fixture)));
  }

  private fixtureStartTime(fixture: FixtureRow) {
    if (fixture.starting_at) return new Date(fixture.starting_at).getTime();
    return new Date(`${fixture.match_date}T${fixture.match_time}Z`).getTime();
  }

  private weekNumberFromMatchweek(matchweek: string) {
    const n = Number(matchweek.match(/\d+/)?.[0]);
    return Number.isInteger(n) && n > 0 ? n : 0;
  }

  private resultSign(home: number, away: number): ResultSign {
    if (home > away) return "home";
    if (away > home) return "away";
    return "draw";
  }
}

function isMatchweekOverviewRepositories(
  value: SupabaseClient<Database> | MatchweekOverviewRepositories
): value is MatchweekOverviewRepositories {
  return "fixtures" in value && "friendsGroups" in value && "weeklyScores" in value;
}
