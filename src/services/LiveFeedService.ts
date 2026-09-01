import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../integrations/supabase/types.js";
import {
  LiveChatGenerator,
  MockLiveChatGenerator,
  type PredictionImpact,
} from "./LiveChatGenerator.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type PushNotificationService from "./PushNotificationService.js";
import type MatchweekOverviewService from "./MatchweekOverviewService.js";
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
    private pushNotifications?: PushNotificationService,
    private matchweekOverview?: Pick<MatchweekOverviewService, "getMatchweekScores">
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
      // Only mention people who got THIS fixture's red card right -- someone
      // whose single matchweek red-card pick was for a different fixture
      // entirely isn't meaningfully "wrong" just because a card happened here.
      const [yesUserIds, rankByUserId] = await Promise.all([
        this.getRedCardYesUserIds(group.id, fixture.id, submittedUserIds),
        this.getMatchweekRanks(fixture, group.id),
      ]);
      const impacts: PredictionImpact[] = yesUserIds.map((userId) => ({
        name: profileById.get(userId) ?? "Player",
        change: "red_card_correct",
        rankDisplay: rankByUserId.get(userId) ?? null,
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

    // ranksBefore/ranksAfter are both computed against explicit score
    // overrides (rather than trusting fixture.live_*_score to already reflect
    // "after") so the rank-movement diff below can't be thrown off by the
    // bulk /livescores poll writing in between these two calls.
    const [predictions, ranksBefore, ranksAfter] = await Promise.all([
      this.getScorePredictions(group.id, fixture.id, submittedUserIds),
      this.getMatchweekRanksDetailed(fixture, group.id, {
        fixtureId: fixture.id,
        homeScore: beforeHome,
        awayScore: beforeAway,
      }),
      this.getMatchweekRanksDetailed(fixture, group.id, {
        fixtureId: fixture.id,
        homeScore: afterHome,
        awayScore: afterAway,
      }),
    ]);
    const impacts: PredictionImpact[] = [];

    for (const prediction of predictions) {
      // An exact-score flip is the most specific, most compelling outcome --
      // report it and move on, rather than also reporting the (necessarily
      // also-true) result-correctness flip for the same person this tick.
      const wasExact =
        prediction.home_score_prediction === beforeHome &&
        prediction.away_score_prediction === beforeAway;
      const isExact =
        prediction.home_score_prediction === afterHome &&
        prediction.away_score_prediction === afterAway;
      if (wasExact !== isExact) {
        impacts.push({
          name: profileById.get(prediction.user_id) ?? "Player",
          change: isExact ? "exact_gained" : "exact_lost",
          rankDisplay: ranksAfter.get(prediction.user_id)?.rankDisplay ?? null,
        });
        continue;
      }

      // Otherwise, a plain result (win/draw/loss) flip is still worth a
      // mention -- e.g. a goal that turns a draw into a home win instantly
      // makes everyone who predicted any home-win scoreline "right", even if
      // none of them have the exact score.
      const wasCorrectResult =
        this.resultSign(prediction.home_score_prediction, prediction.away_score_prediction) ===
        this.resultSign(beforeHome, beforeAway);
      const isCorrectResult =
        this.resultSign(prediction.home_score_prediction, prediction.away_score_prediction) ===
        this.resultSign(afterHome, afterAway);
      if (wasCorrectResult === isCorrectResult) continue;

      const beforeRank = ranksBefore.get(prediction.user_id)?.rank ?? null;
      const afterRank = ranksAfter.get(prediction.user_id)?.rank ?? null;
      const rankMovement: "up" | "down" | "none" =
        beforeRank == null || afterRank == null || beforeRank === afterRank
          ? "none"
          : afterRank < beforeRank
            ? "up"
            : "down";

      impacts.push({
        name: profileById.get(prediction.user_id) ?? "Player",
        change: isCorrectResult ? "result_gained" : "result_lost",
        rankMovement,
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

  // Never throws -- a failure here (stale/missing subscription, matchweek
  // not resolvable, etc.) degrades to "no rank mentions" rather than
  // breaking live-feed generation for the event, same as the Source A/B
  // canary above.
  private async getMatchweekRanks(
    fixture: FixtureRow,
    friendsGroupId: string
  ): Promise<Map<string, string | null>> {
    const detailed = await this.getMatchweekRanksDetailed(fixture, friendsGroupId);
    const ranks = new Map<string, string | null>();
    for (const [userId, info] of detailed) ranks.set(userId, info.rankDisplay);
    return ranks;
  }

  // Same graceful-degradation contract as getMatchweekRanks, but also
  // exposes the raw numeric rank (for before/after movement comparisons) and
  // accepts an optional score override so a caller can ask for ranks as of a
  // hypothetical score rather than whatever's currently persisted.
  private async getMatchweekRanksDetailed(
    fixture: FixtureRow,
    friendsGroupId: string,
    fixtureScoreOverride?: { fixtureId: number; homeScore: number; awayScore: number }
  ): Promise<Map<string, { rank: number | null; rankDisplay: string | null }>> {
    const ranks = new Map<string, { rank: number | null; rankDisplay: string | null }>();
    if (!this.matchweekOverview || !fixture.matchweek) return ranks;

    try {
      const { rows } = await this.matchweekOverview.getMatchweekScores({
        friendsGroupId,
        matchweek: fixture.matchweek,
        fixtureScoreOverride,
      });
      for (const row of rows) {
        ranks.set(row.user_id, {
          rank: row.rank ?? null,
          rankDisplay: this.formatRankDisplay(row.rank_display),
        });
      }
    } catch (error) {
      console.warn(
        "[LiveFeed] Failed to load matchweek ranks, omitting from commentary",
        { friendsGroupId, matchweek: fixture.matchweek, error }
      );
    }

    return ranks;
  }

  private resultSign(home: number, away: number): "home" | "away" | "draw" {
    if (home > away) return "home";
    if (away > home) return "away";
    return "draw";
  }

  // Converts MatchweekOverviewService's raw rank_display ("#1", "=2") into a
  // plain-language phrase ("1st", "tied for 2nd") once, here, so every
  // consumer (Claude's prompt, the Mock fallback) gets consistent wording
  // without needing to parse "#"/"=" itself.
  private formatRankDisplay(rankDisplay: string | null | undefined): string | null {
    if (!rankDisplay) return null;

    const tied = rankDisplay.startsWith("=");
    const rankNumber = Number(rankDisplay.slice(1));
    if (!Number.isFinite(rankNumber)) return null;

    const mod100 = rankNumber % 100;
    const suffix =
      mod100 >= 11 && mod100 <= 13
        ? "th"
        : { 1: "st", 2: "nd", 3: "rd" }[rankNumber % 10] ?? "th";
    const ordinal = `${rankNumber}${suffix}`;

    return tied ? `tied for ${ordinal}` : ordinal;
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
