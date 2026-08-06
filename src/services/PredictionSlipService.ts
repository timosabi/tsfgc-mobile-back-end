import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { AppError } from "../middleware/errorHandler.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type { MatchweekFixtureRow } from "../repositories/FixturesRepository.js";
import type { ProfilePreview } from "../repositories/ProfilesRepository.js";

type FixtureRow = MatchweekFixtureRow;
type PredictionRow = Database["public"]["Tables"]["predictions"]["Row"];
type RedCardPredictionRow =
  Database["public"]["Tables"]["red_card_predictions"]["Row"];
type UserSubmissionRow =
  Database["public"]["Tables"]["user_submissions"]["Row"];

type PredictionSlipRepositories = Pick<
  Repositories,
  | "fixtures"
  | "friendsGroupSubscriptions"
  | "liveFeedEvents"
  | "predictions"
  | "profiles"
  | "redCardPredictions"
  | "userSubmissions"
  | "weeklyScores"
>;

export type PredictionSlipInput = {
  predictions: Array<{
    fixtureId: number;
    homeScore: number;
    awayScore: number;
  }>;
  redCardFixtureId?: number;
  redCardFixtureIds?: number[];
};

export default class PredictionSlipService {
  private readonly repositories: PredictionSlipRepositories;

  constructor(clientOrRepositories: SupabaseClient<Database> | PredictionSlipRepositories) {
    this.repositories = isPredictionSlipRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async getMine(params: {
    userId: string;
    friendsGroupId: string;
    matchweek: string;
  }) {
    const fixtures = await this.getMatchweekFixtures(params.friendsGroupId, params.matchweek);
    const fixtureIds = fixtures.map((fixture) => fixture.id);
    const [predictions, redCards, submission] = await Promise.all([
      this.getPredictions(params.friendsGroupId, fixtureIds, [params.userId]),
      this.getRedCards(params.friendsGroupId, fixtureIds, [params.userId]),
      this.getSubmission(params.userId, params.friendsGroupId, params.matchweek),
    ]);

    return {
      friendsGroupId: params.friendsGroupId,
      matchweek: params.matchweek,
      locked: this.isLocked(fixtures),
      submitted: Boolean(submission),
      fixtures,
      predictions,
      redCardFixtureId: redCards[0]?.fixture_id ?? null,
    };
  }

  async saveMine(params: {
    userId: string;
    friendsGroupId: string;
    matchweek: string;
    payload: PredictionSlipInput;
  }) {
    this.assertSlipPayload(params.payload);
    const fixtures = await this.getMatchweekFixtures(params.friendsGroupId, params.matchweek);
    this.assertEditable(fixtures);
    const fixtureIds = fixtures.map((fixture) => fixture.id);
    const fixtureIdSet = new Set(fixtureIds);
    const redCardFixtureId = this.extractRedCardFixtureId(params.payload);
    const scorePredictions = this.normalizeScorePredictions(params.payload);

    if (!fixtureIdSet.has(redCardFixtureId)) {
      throw new AppError("redCardFixtureId must belong to this matchweek", 400);
    }

    if (scorePredictions.length !== fixtures.length) {
      throw new AppError("Prediction slip must include every fixture in the matchweek", 400);
    }

    const seen = new Set<number>();
    for (const prediction of scorePredictions) {
      if (!fixtureIdSet.has(prediction.fixtureId)) {
        throw new AppError("Prediction fixture does not belong to this matchweek", 400);
      }
      if (seen.has(prediction.fixtureId)) {
        throw new AppError("Duplicate fixture prediction in slip", 400);
      }
      seen.add(prediction.fixtureId);
      if (
        !Number.isInteger(prediction.homeScore) ||
        !Number.isInteger(prediction.awayScore) ||
        prediction.homeScore < 0 ||
        prediction.awayScore < 0
      ) {
        throw new AppError("Score predictions must be non-negative integers", 400);
      }
    }

    await this.deleteSlipRows(params.userId, params.friendsGroupId, fixtureIds);

    const predictionRows = scorePredictions.map((prediction) => ({
      user_id: params.userId,
      friends_group_id: params.friendsGroupId,
      fixture_id: prediction.fixtureId,
      home_score_prediction: prediction.homeScore,
      away_score_prediction: prediction.awayScore,
      updated_at: new Date().toISOString(),
    }));

    await this.repositories.predictions.insertPredictions(predictionRows);

    await this.repositories.redCardPredictions.insertPrediction({
      user_id: params.userId,
      friends_group_id: params.friendsGroupId,
      fixture_id: redCardFixtureId,
    });

    return this.getMine(params);
  }

  async submitMine(params: {
    userId: string;
    friendsGroupId: string;
    matchweek: string;
  }) {
    const fixtures = await this.getMatchweekFixtures(params.friendsGroupId, params.matchweek);
    this.assertEditable(fixtures);
    const fixtureIds = fixtures.map((fixture) => fixture.id);
    const [predictions, redCards] = await Promise.all([
      this.getPredictions(params.friendsGroupId, fixtureIds, [params.userId]),
      this.getRedCards(params.friendsGroupId, fixtureIds, [params.userId]),
    ]);

    if (predictions.length !== fixtures.length) {
      throw new AppError("Cannot submit incomplete score predictions", 400);
    }
    if (redCards.length !== 1) {
      throw new AppError("Select exactly one red-card fixture before submitting", 400);
    }

    await this.repositories.userSubmissions.upsertSubmission({
      user_id: params.userId,
      friends_group_id: params.friendsGroupId,
      matchweek: params.matchweek,
      submitted_at: new Date().toISOString(),
    });

    return this.getMine(params);
  }

  async deleteMine(params: {
    userId: string;
    friendsGroupId: string;
    matchweek: string;
  }) {
    const fixtures = await this.getMatchweekFixtures(params.friendsGroupId, params.matchweek);
    this.assertEditable(fixtures);
    await this.deleteSlipRows(
      params.userId,
      params.friendsGroupId,
      fixtures.map((fixture) => fixture.id)
    );
    await this.repositories.userSubmissions.deleteByUserGroupMatchweek(
      params.userId,
      params.friendsGroupId,
      params.matchweek
    );

    return { deleted: true };
  }

  async getAll(params: {
    friendsGroupId: string;
    matchweek: string;
    requestingUserId?: string;
  }) {
    const fixtures = await this.getMatchweekFixtures(params.friendsGroupId, params.matchweek);
    const locked = this.isLocked(fixtures);
    const fixtureIds = fixtures.map((fixture) => fixture.id);
    const submissions = await this.repositories.userSubmissions.listSubmittedUsers(
      params.friendsGroupId,
      params.matchweek
    );

    const userIds = submissions.map((row) => row.user_id);
    const [predictions, redCards, profiles] = await Promise.all([
      this.getPredictions(params.friendsGroupId, fixtureIds, userIds),
      this.getRedCards(params.friendsGroupId, fixtureIds, userIds),
      this.getProfiles(userIds),
    ]);

    return {
      friendsGroupId: params.friendsGroupId,
      matchweek: params.matchweek,
      locked,
      fixtures,
      users: submissions.map((submission) => ({
        userId: submission.user_id,
        submittedAt: submission.submitted_at,
        profile: profiles.get(submission.user_id) ?? null,
        predictions:
          locked || submission.user_id === params.requestingUserId
            ? predictions.filter((row) => row.user_id === submission.user_id)
            : [],
        redCardFixtureId:
          locked || submission.user_id === params.requestingUserId
            ? redCards.find((row) => row.user_id === submission.user_id)?.fixture_id ?? null
            : null,
      })),
    };
  }

  async getHistory(params: {
    userId?: string;
    friendsGroupId: string;
    matchweek: string;
  }) {
    const fixtures = await this.getMatchweekFixtures(params.friendsGroupId, params.matchweek);
    const weekNumber = this.weekNumberFromMatchweek(params.matchweek);
    const [scores, allPredictions, feed] = await Promise.all([
      this.repositories.weeklyScores.listByGroupWeek(
        params.friendsGroupId,
        weekNumber,
        true,
        params.userId
      ),
      this.getAll({
        friendsGroupId: params.friendsGroupId,
        matchweek: params.matchweek,
        requestingUserId: params.userId,
      }),
      this.repositories.liveFeedEvents.listByGroupMatchweekWithFixture(
          params.friendsGroupId,
          params.matchweek
      ),
    ]);

    return {
      friendsGroupId: params.friendsGroupId,
      matchweek: params.matchweek,
      fixtures,
      predictions: allPredictions,
      scores,
      liveFeed: feed,
    };
  }

  async getMatchweekFixtures(
    friendsGroupId: string,
    matchweek: string
  ): Promise<FixtureRow[]> {
    const subscription =
      await this.repositories.friendsGroupSubscriptions.findActiveByFriendsGroup(
        friendsGroupId
      );
    if (!subscription) throw new AppError("Friends group has no active subscription", 400);

    const fixtures = await this.repositories.fixtures.listMatchweekFixtures({
      providerLeagueId: subscription.provider_league_id,
      providerSeasonId: subscription.provider_season_id,
      matchweek,
    });

    if (!fixtures.length) throw new AppError("No fixtures found for matchweek", 404);
    return fixtures;
  }

  private async getPredictions(
    friendsGroupId: string,
    fixtureIds: number[],
    userIds: string[]
  ): Promise<PredictionRow[]> {
    if (!fixtureIds.length || !userIds.length) return [];
    return this.repositories.predictions.listByGroupFixturesUsers(
      friendsGroupId,
      fixtureIds,
      userIds
    );
  }

  private async getRedCards(
    friendsGroupId: string,
    fixtureIds: number[],
    userIds: string[]
  ): Promise<RedCardPredictionRow[]> {
    if (!fixtureIds.length || !userIds.length) return [];
    return this.repositories.redCardPredictions.listByGroupFixturesUsers(
      friendsGroupId,
      fixtureIds,
      userIds
    );
  }

  private async getSubmission(
    userId: string,
    friendsGroupId: string,
    matchweek: string
  ): Promise<UserSubmissionRow | null> {
    return this.repositories.userSubmissions.findByUserGroupMatchweek(
      userId,
      friendsGroupId,
      matchweek
    );
  }

  private async getProfiles(userIds: string[]) {
    const profiles = new Map<string, ProfilePreview>();
    if (!userIds.length) return profiles;
    const data = await this.repositories.profiles.listPreviewsByIds(userIds);
    for (const profile of data) profiles.set(profile.id, profile);
    return profiles;
  }

  private async deleteSlipRows(
    userId: string,
    friendsGroupId: string,
    fixtureIds: number[]
  ) {
    await Promise.all([
      this.repositories.predictions.deleteByUserGroupFixtures(
        userId,
        friendsGroupId,
        fixtureIds
      ),
      this.repositories.redCardPredictions.deleteByUserGroupFixtures(
        userId,
        friendsGroupId,
        fixtureIds
      ),
    ]);
  }

  private extractRedCardFixtureId(payload: PredictionSlipInput) {
    const ids =
      payload.redCardFixtureIds ??
      (payload.redCardFixtureId === undefined ? [] : [payload.redCardFixtureId]);
    if (ids.length !== 1 || !Number.isInteger(Number(ids[0]))) {
      throw new AppError("Select exactly one red-card fixture", 400);
    }
    return Number(ids[0]);
  }

  private assertSlipPayload(payload: PredictionSlipInput) {
    if (!payload || !Array.isArray(payload.predictions)) {
      throw new AppError("Prediction slip must include predictions", 400);
    }
  }

  private normalizeScorePredictions(payload: PredictionSlipInput) {
    return payload.predictions.map((prediction) => ({
      fixtureId: Number(prediction.fixtureId),
      homeScore: Number(prediction.homeScore),
      awayScore: Number(prediction.awayScore),
    }));
  }

  private assertEditable(fixtures: FixtureRow[]) {
    if (this.isLocked(fixtures)) {
      throw new AppError("Predictions are locked for this matchweek", 409);
    }
  }

  private isLocked(fixtures: FixtureRow[]) {
    const firstStart = Math.min(
      ...fixtures.map((fixture) => this.fixtureStartTime(fixture))
    );
    return firstStart <= Date.now();
  }

  private fixtureStartTime(fixture: FixtureRow) {
    if (fixture.starting_at) return new Date(fixture.starting_at).getTime();
    return new Date(`${fixture.match_date}T${fixture.match_time}Z`).getTime();
  }

  private weekNumberFromMatchweek(matchweek: string) {
    const n = Number(matchweek.match(/\d+/)?.[0]);
    return Number.isInteger(n) && n > 0 ? n : 0;
  }
}

function isPredictionSlipRepositories(
  value: SupabaseClient<Database> | PredictionSlipRepositories
): value is PredictionSlipRepositories {
  return "fixtures" in value && "predictions" in value && "userSubmissions" in value;
}
