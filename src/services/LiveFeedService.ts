import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../integrations/supabase/types.js";
import {
  LiveChatGenerator,
  MockLiveChatGenerator,
  type PredictionChangeType,
  type PredictionImpact,
} from "./LiveChatGenerator.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type PushNotificationService from "./PushNotificationService.js";
import type { LiveFeedFixtureRow } from "../repositories/FixturesRepository.js";

type LiveEventInput = {
  eventType: "goal" | "red_card" | "halftime" | "penalty" | "minute_85" | "fulltime";
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
    private chatGenerator: LiveChatGenerator = new MockLiveChatGenerator(),
    private pushNotifications?: PushNotificationService
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
    if (
      !["goal", "red_card", "halftime", "penalty", "minute_85", "fulltime"].includes(
        input.eventType
      )
    ) {
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

    // Canary: Source A (fixture.live_*_score, from the periodic bulk /livescores
    // poll) and input.*Score (for goals: SportMonks' own per-event result, see
    // parseEventResult; otherwise the same Source A value) should usually agree.
    // A mismatch here doesn't affect what gets displayed for goal events (see
    // buildGroupContext, which prefers the per-event value as more precise) or
    // what gets persisted (patchFixture always writes Source A), but is worth
    // knowing about: it means Source A is lagging behind the per-fixture events
    // feed for this instant, or (for non-goal events, which don't have their own
    // per-event score) the own-goal-crediting replay has diverged.
    if (
      input.homeScore != null &&
      input.awayScore != null &&
      fixture.live_home_score != null &&
      fixture.live_away_score != null &&
      (input.homeScore !== fixture.live_home_score ||
        input.awayScore !== fixture.live_away_score)
    ) {
      console.warn("[LiveFeed] Source A/B score mismatch", {
        fixtureId: fixture.id,
        smFixtureId: fixture.sm_fixture_id,
        sourceA: { home: fixture.live_home_score, away: fixture.live_away_score },
        sourceBReplay: { home: input.homeScore, away: input.awayScore },
      });
    }

    await this.storeMatchEvent(input, fixture);
    await this.patchFixture(input, fixture);

    const groups = await this.getSubscribedGroups(fixture);

    const rows = await Promise.all(
      groups.map(async (group) => {
        const submittedUserIds = await this.getSubmittedUserIds(group.id, fixture);
        const context = await this.buildGroupContext(
          input,
          fixture,
          group,
          submittedUserIds
        );
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
            // Sourced from the already-corrected context.score (Source A) rather than
            // input.homeScore/awayScore directly, so the persisted payload never
            // disagrees with the AI-generated text sitting next to it.
            homeScore: context.score?.home ?? input.homeScore ?? null,
            awayScore: context.score?.away ?? input.awayScore ?? null,
          },
        };

        const feedRow = await this.repositories.liveFeedEvents.upsertFeedEvent({
          friends_group_id: group.id,
          fixture_id: fixture.id,
          matchweek: fixture.matchweek,
          sm_fixture_id: fixture.sm_fixture_id,
          event_key: eventKey,
          event_type: input.eventType,
          payload: payload as Json,
          ai_message: aiMessage,
        });

        // Push notifications only for the events users would actually want an
        // OS-level alert for -- not halftime/85'/fulltime markers, which are
        // ambient and already visible in the live feed if the app is open.
        if (
          this.pushNotifications &&
          (input.eventType === "goal" || input.eventType === "red_card")
        ) {
          await this.pushNotifications.sendToUsers(submittedUserIds, {
            title: context.fixtureName,
            body: aiMessage,
            data: {
              type: input.eventType,
              friendsGroupId: group.id,
              matchweek: String(fixture.matchweek ?? ""),
            },
          });
        }

        return feedRow;
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
    group: GroupRow,
    submittedUserIds: string[]
  ) {
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
        homeTeam: fixture.home_team,
        awayTeam: fixture.away_team,
        matchweek: fixture.matchweek,
        minute: input.minute ?? null,
        score: {
          home: fixture.live_home_score ?? fixture.home_score ?? input.homeScore ?? null,
          away: fixture.live_away_score ?? fixture.away_score ?? input.awayScore ?? null,
        },
        ...eventDetail,
        impacts: [] as PredictionImpact[],
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
      const impacts: PredictionImpact[] = submittedUserIds.map((userId) => ({
        name: profileById.get(userId) ?? "Player",
        change: yes.has(userId) ? "red_card_correct" : "red_card_wrong",
      }));

      return {
        groupName: group.name,
        eventType: input.eventType,
        fixtureName,
        homeTeam: fixture.home_team,
        awayTeam: fixture.away_team,
        matchweek: fixture.matchweek,
        minute: input.minute ?? null,
        score: {
          home: fixture.live_home_score ?? fixture.home_score ?? null,
          away: fixture.live_away_score ?? fixture.away_score ?? null,
        },
        ...eventDetail,
        impacts,
        reason: "red_card_prediction_changed",
      };
    }

    const predictions = await this.getScorePredictions(
      group.id,
      fixture.id,
      submittedUserIds
    );
    // beforeHome/beforeAway are used both for the per-goal prediction diff below
    // (which specific goal flipped which prediction) and, via afterHome/afterAway,
    // as the displayed `score` for goal events -- for a goal, input.homeScore/
    // awayScore is the score SportMonks attached directly to that event (see
    // LiveEventsPollerService.parseEventResult), which is more precise for "the
    // score as of this event" than fixture.live_*_score: that DB column is only
    // as fresh as the last bulk /livescores poll, which can genuinely lag behind
    // the per-fixture events feed by a tick. fixture.live_*_score is still the
    // fallback for event types that don't carry their own score (red_card etc.).
    const beforeHome =
      input.beforeHomeScore ?? fixture.live_home_score ?? fixture.home_score ?? 0;
    const beforeAway =
      input.beforeAwayScore ?? fixture.live_away_score ?? fixture.away_score ?? 0;
    const afterHome = input.homeScore ?? beforeHome;
    const afterAway = input.awayScore ?? beforeAway;
    const impacts: PredictionImpact[] = [];

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

      const change = this.mostSignificantChange(before, after);
      if (!change) continue;

      impacts.push({
        name: profileById.get(prediction.user_id) ?? "Player",
        change,
        predictedHome: prediction.home_score_prediction,
        predictedAway: prediction.away_score_prediction,
      });
    }

    return {
      groupName: group.name,
      eventType: input.eventType,
      fixtureName,
      homeTeam: fixture.home_team,
      awayTeam: fixture.away_team,
      matchweek: fixture.matchweek,
      minute: input.minute ?? null,
      score: {
        home: afterHome,
        away: afterAway,
      },
      ...eventDetail,
      impacts,
      reason: "score_prediction_changed",
    };
  }

  // Exact implies result and total, so a goal that flips all three for the same
  // user only gets reported once, as whichever change is most specific -- this
  // keeps the chat message from listing redundant outcomes for one prediction.
  private mostSignificantChange(
    before: PredictionState,
    after: PredictionState
  ): PredictionChangeType | null {
    if (!before.exact && after.exact) return "exact_gained";
    if (before.exact && !after.exact) return "exact_lost";
    if (!before.result && after.result) return "result_gained";
    if (before.result && !after.result) return "result_lost";
    if (!before.total && after.total) return "total_gained";
    if (before.total && !after.total) return "total_lost";
    return null;
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

  // Score columns are intentionally NOT written here. They're owned exclusively
  // by the bulk /livescores poll (LiveEventsPollerService.poll -> patchLiveRows),
  // which is the provider-authoritative aggregate. This per-event replay used to
  // also write live_home_score/live_away_score/home_score/away_score, racing
  // against that authoritative write within the same poll tick and occasionally
  // persisting a transiently wrong score (see live-score race condition fix).
  private async patchFixture(
    input: LiveEventInput,
    fixture: FixtureRow
  ): Promise<void> {
    const patch: FixturePatch = {};

    if (input.eventType === "red_card") patch.has_red_card = true;

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
