import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../integrations/supabase/types.js";
import {
  LiveChatGenerator,
  MockLiveChatGenerator,
} from "./LiveChatGenerator.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type { LiveFeedFixtureRow } from "../repositories/FixturesRepository.js";

type LiveEventInput = {
  eventType: "goal" | "red_card" | "halftime" | "penalty" | "minute_85";
  fixtureId?: number;
  smFixtureId?: number;
  smEventId?: number;
  minute?: number | null;
  team?: string | null;
  playerName?: string | null;
  assistedBy?: string | null;
  isPenalty?: boolean;
  isOwnGoal?: boolean;
  homeScore?: number | null;
  awayScore?: number | null;
  beforeHomeScore?: number | null;
  beforeAwayScore?: number | null;
  eventKey?: string;
  providerPayload?: Json | null;
};

type FixtureRow = LiveFeedFixtureRow;
type GroupRow = Pick<
  Database["public"]["Tables"]["friends_groups"]["Row"],
  "id" | "name"
>;
type LiveFeedRow = Database["public"]["Tables"]["live_feed_events"]["Row"];
type LiveFeedRowWithFixture = LiveFeedRow & {
  fixture: Pick<
    Database["public"]["Tables"]["fixtures"]["Row"],
    "id" | "matchweek" | "home_team" | "away_team"
  > | null;
};
type SubscriptionTarget = Pick<
  Database["public"]["Tables"]["friends_group_subscriptions"]["Row"],
  "friends_group_id" | "provider_season_id"
>;
type UserSubmissionRef = Pick<
  Database["public"]["Tables"]["user_submissions"]["Row"],
  "user_id"
>;
type ProfileName = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "display_name"
>;
type RedCardUserRef = Pick<
  Database["public"]["Tables"]["red_card_predictions"]["Row"],
  "user_id"
>;
type ScorePredictionRef = Pick<
  Database["public"]["Tables"]["predictions"]["Row"],
  "user_id" | "home_score_prediction" | "away_score_prediction"
>;
type ProcessEventResult =
  | { created: number; skipped: true; reason: string }
  | { created: number; rows: LiveFeedRow[] };
type FixturePatch = Partial<
  Pick<
    Database["public"]["Tables"]["fixtures"]["Update"],
    "has_red_card" | "live_home_score" | "home_score" | "live_away_score" | "away_score"
  >
>;
type PredictionState = {
  exact: boolean;
  result: boolean;
  total: boolean;
};
type LiveFeedRepositories = Pick<
  Repositories,
  | "fixtures"
  | "friendsGroups"
  | "friendsGroupSubscriptions"
  | "liveFeedEvents"
  | "matchEvents"
  | "predictions"
  | "profiles"
  | "redCardPredictions"
  | "userSubmissions"
>;

export default class LiveFeedService {
  private readonly repositories: LiveFeedRepositories;

  constructor(
    clientOrRepositories: SupabaseClient<Database> | LiveFeedRepositories,
    private chatGenerator: LiveChatGenerator = new MockLiveChatGenerator()
  ) {
    this.repositories = isLiveFeedRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async listFeed(params: {
    friendsGroupId: string;
    fixtureId?: number;
    matchweek?: string;
    limit?: number;
  }): Promise<LiveFeedRowWithFixture[]> {
    return this.repositories.liveFeedEvents.listFeed({
      friendsGroupId: params.friendsGroupId,
      fixtureId: params.fixtureId,
      matchweek: params.matchweek,
      limit: params.limit ?? 50,
    }) as unknown as LiveFeedRowWithFixture[];
  }

  async processEvent(input: LiveEventInput): Promise<ProcessEventResult> {
    if (!["goal", "red_card", "halftime", "penalty", "minute_85"].includes(input.eventType)) {
      return { created: 0, skipped: true, reason: "unsupported_event" };
    }

    if (input.smEventId) {
      const existing = await this.repositories.matchEvents.findBySmEventId(
        input.smEventId
      );
      if (existing) {
        return { created: 0, skipped: true, reason: "already_processed" };
      }
    }

    const fixture = await this.getFixture(input);
    if (!fixture) return { created: 0, skipped: true, reason: "fixture_not_found" };

    await this.storeMatchEvent(input, fixture);
    await this.patchFixture(input, fixture);

    const groups = await this.getSubscribedGroups(fixture);

    const rows = await Promise.all(
      groups.map(async (group) => {
        const context = await this.buildGroupContext(input, fixture, group);
        const aiMessage = await this.chatGenerator.generate(context);
        const eventKey = this.eventKey(input);

        const payload = {
          ...context,
          smEventId: input.smEventId ?? null,
          event: {
            type: input.eventType,
            minute: input.minute ?? null,
            team: input.team ?? null,
            playerName: input.playerName ?? null,
            assistedBy: input.assistedBy ?? null,
            isPenalty: Boolean(input.isPenalty),
            isOwnGoal: Boolean(input.isOwnGoal),
            homeScore: input.homeScore ?? null,
            awayScore: input.awayScore ?? null,
          },
        };

        return this.repositories.liveFeedEvents.upsertFeedEvent({
          friends_group_id: group.id,
          fixture_id: fixture.id,
          matchweek: fixture.matchweek,
          sm_fixture_id: fixture.sm_fixture_id,
          event_key: eventKey,
          event_type: input.eventType,
          payload: payload as Json,
          ai_message: aiMessage,
        });
      })
    );

    return { created: rows.length, rows };
  }

  private async getFixture(input: LiveEventInput): Promise<FixtureRow | null> {
    return this.repositories.fixtures.findLiveFeedFixture({
      fixtureId: input.fixtureId,
      smFixtureId: input.smFixtureId,
    });
  }

  private async getSubscribedGroups(fixture: FixtureRow): Promise<GroupRow[]> {
    const subscriptions =
      await this.repositories.friendsGroupSubscriptions.listActiveByProviderLeague(
        fixture.sm_league_id
      );

    const groupIds = (subscriptions ?? [])
      .filter(
        (row) =>
          !row.provider_season_id ||
          !fixture.sm_season_id ||
          Number(row.provider_season_id) === Number(fixture.sm_season_id)
      )
      .map((row) => row.friends_group_id);

    if (!groupIds.length) return [];

    return this.repositories.friendsGroups.listApprovedNamesByIds(groupIds);
  }

  private async buildGroupContext(
    input: LiveEventInput,
    fixture: FixtureRow,
    group: GroupRow
  ) {
    const submittedUserIds = await this.getSubmittedUserIds(group.id, fixture);
    const profileById = await this.getProfiles(submittedUserIds);
    const fixtureName = `${fixture.home_team} vs ${fixture.away_team}`;
    const eventDetail = {
      player: input.playerName ?? null,
      assistedBy: input.assistedBy ?? null,
      team: input.team ?? null,
      isPenalty: Boolean(input.isPenalty),
      isOwnGoal: Boolean(input.isOwnGoal),
    };

    if (!submittedUserIds.length) {
      return {
        groupName: group.name,
        eventType: input.eventType,
        fixtureName,
        matchweek: fixture.matchweek,
        minute: input.minute ?? null,
        score: {
          home: input.homeScore ?? fixture.live_home_score ?? fixture.home_score,
          away: input.awayScore ?? fixture.live_away_score ?? fixture.away_score,
        },
        ...eventDetail,
        affectedPositive: [],
        affectedNegative: [],
        reason: "no_submitted_predictions",
      };
    }

    if (input.eventType === "red_card") {
      const yesUserIds = await this.getRedCardYesUserIds(
        group.id,
        fixture.id,
        submittedUserIds
      );
      const yes = new Set(yesUserIds);
      return {
        groupName: group.name,
        eventType: input.eventType,
        fixtureName,
        matchweek: fixture.matchweek,
        minute: input.minute ?? null,
        ...eventDetail,
        affectedPositive: submittedUserIds
          .filter((userId) => yes.has(userId))
          .map((userId) => profileById.get(userId) ?? "Player"),
        affectedNegative: submittedUserIds
          .filter((userId) => !yes.has(userId))
          .map((userId) => profileById.get(userId) ?? "Player"),
        reason: "red_card_prediction_changed",
      };
    }

    const predictions = await this.getScorePredictions(
      group.id,
      fixture.id,
      submittedUserIds
    );
    const beforeHome =
      input.beforeHomeScore ?? fixture.live_home_score ?? fixture.home_score ?? 0;
    const beforeAway =
      input.beforeAwayScore ?? fixture.live_away_score ?? fixture.away_score ?? 0;
    const afterHome = input.homeScore ?? beforeHome;
    const afterAway = input.awayScore ?? beforeAway;
    const positive = new Set<string>();
    const negative = new Set<string>();

    for (const prediction of predictions) {
      const before = this.predictionState(
        prediction.home_score_prediction,
        prediction.away_score_prediction,
        beforeHome,
        beforeAway
      );
      const after = this.predictionState(
        prediction.home_score_prediction,
        prediction.away_score_prediction,
        afterHome,
        afterAway
      );

      if (
        (!before.exact && after.exact) ||
        (!before.result && after.result) ||
        (!before.total && after.total)
      ) {
        positive.add(prediction.user_id);
      }

      if (
        (before.exact && !after.exact) ||
        (before.result && !after.result) ||
        (before.total && !after.total)
      ) {
        negative.add(prediction.user_id);
      }
    }

    return {
      groupName: group.name,
      eventType: input.eventType,
      fixtureName,
      matchweek: fixture.matchweek,
      minute: input.minute ?? null,
      score: { home: afterHome, away: afterAway },
      ...eventDetail,
      affectedPositive: Array.from(positive).map(
        (userId) => profileById.get(userId) ?? "Player"
      ),
      affectedNegative: Array.from(negative).map(
        (userId) => profileById.get(userId) ?? "Player"
      ),
      reason: "score_prediction_changed",
    };
  }

  private async getSubmittedUserIds(
    groupId: string,
    fixture: FixtureRow
  ): Promise<string[]> {
    if (!fixture.matchweek) return [];

    const data = await this.repositories.userSubmissions.listSubmittedUserIds(
      groupId,
      fixture.matchweek
    );
    return Array.from(
      new Set((data ?? []).map((row: UserSubmissionRef) => row.user_id))
    );
  }

  private async getProfiles(userIds: string[]): Promise<Map<string, string>> {
    const profileById = new Map<string, string>();
    if (!userIds.length) return profileById;

    const data = await this.repositories.profiles.listDisplayNamesByIds(userIds);

    for (const profile of (data ?? []) as ProfileName[]) {
      profileById.set(profile.id, profile.display_name ?? "Player");
    }

    return profileById;
  }

  private async getRedCardYesUserIds(
    groupId: string,
    fixtureId: number,
    userIds: string[]
  ): Promise<string[]> {
    const data =
      await this.repositories.redCardPredictions.listUserIdsByGroupFixture(
        groupId,
        fixtureId,
        userIds
      );
    return (data ?? []).map((row: RedCardUserRef) => row.user_id);
  }

  private async getScorePredictions(
    groupId: string,
    fixtureId: number,
    userIds: string[]
  ): Promise<ScorePredictionRef[]> {
    return this.repositories.predictions.listScorePredictionsByGroupFixture(
      groupId,
      fixtureId,
      userIds
    );
  }

  private async storeMatchEvent(
    input: LiveEventInput,
    fixture: FixtureRow
  ): Promise<void> {
    const row = {
      fixture_id: fixture.id,
      provider: "sportmonks",
      sm_event_id: input.smEventId ?? null,
      sm_fixture_id: fixture.sm_fixture_id,
      event_type: input.eventType,
      minute: input.minute ?? 0,
      player_name: input.playerName ?? "Unknown",
      team: input.team ?? "Unknown",
      provider_payload: input.providerPayload ?? {},
    };

    await this.repositories.matchEvents.upsertProviderEvent(
      row,
      Boolean(input.smEventId)
    );
  }

  private async patchFixture(
    input: LiveEventInput,
    fixture: FixtureRow
  ): Promise<void> {
    const patch: FixturePatch = {};

    if (input.eventType === "red_card") patch.has_red_card = true;
    if (input.homeScore !== undefined) {
      patch.live_home_score = input.homeScore;
      patch.home_score = input.homeScore;
    }
    if (input.awayScore !== undefined) {
      patch.live_away_score = input.awayScore;
      patch.away_score = input.awayScore;
    }

    if (!Object.keys(patch).length) return;

    await this.repositories.fixtures.updateFixtureById(fixture.id, patch);
  }

  private predictionState(
    predictedHome: number,
    predictedAway: number,
    actualHome: number,
    actualAway: number
  ): PredictionState {
    return {
      exact: predictedHome === actualHome && predictedAway === actualAway,
      result:
        this.resultSign(predictedHome, predictedAway) ===
        this.resultSign(actualHome, actualAway),
      total: predictedHome + predictedAway === actualHome + actualAway,
    };
  }

  private resultSign(home: number, away: number): "home" | "away" | "draw" {
    if (home > away) return "home";
    if (away > home) return "away";
    return "draw";
  }

  private eventKey(input: LiveEventInput): string {
    return (
      input.eventKey ??
      `${input.fixtureId ?? input.smFixtureId ?? "fixture"}:${input.eventType}:${
        input.smEventId ?? input.minute ?? "unknown"
      }`
    );
  }
}

function isLiveFeedRepositories(
  value: SupabaseClient<Database> | LiveFeedRepositories
): value is LiveFeedRepositories {
  return "liveFeedEvents" in value && "fixtures" in value && "matchEvents" in value;
}
