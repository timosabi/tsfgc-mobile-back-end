import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../integrations/supabase/types.js";
import {
  LiveChatGenerator,
  MockLiveChatGenerator,
  DeterministicMessageGenerator,
  buildFactualMessage,
  buildOverturnedMessage,
  filterImpactsForMessage,
  type LiveChatContext,
  type PredictionImpact,
} from "./LiveChatGenerator.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type MatchweekOverviewService from "./MatchweekOverviewService.js";
import type { LiveFeedFixtureRow } from "../repositories/FixturesRepository.js";

// How long a goal/red card waits before its Impact (or "NO GOAL"/"CARD
// RESCINDED" overturn correction) message is written -- long enough to cover
// a slower VAR review. The Score Update itself is written immediately,
// unaffected by this delay.
export const VERIFICATION_DELAY_MS = 120_000;

type LiveEventInput = {
  eventType: "kickoff" | "goal" | "red_card" | "halftime" | "penalty" | "minute_85" | "fulltime";
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

type PendingVerification = {
  key: string;
  eventType: "goal" | "red_card";
  smFixtureId: number;
  fixtureId: number;
  detectedAt: number;
  groups: GroupRow[];
  input: LiveEventInput;
  fixture: FixtureRow;
};

const SUPPORTED_EVENT_TYPES = new Set([
  "kickoff",
  "goal",
  "red_card",
  "halftime",
  "penalty",
  "minute_85",
  "fulltime",
]);
const VERIFIABLE_EVENT_TYPES = new Set(["goal", "red_card"]);

export default class LiveFeedService {
  private readonly repositories: LiveFeedRepositories;
  // In-process pending-verification queue -- same "single instance, no
  // replicas" precedent as LiveEventsPollerService's firedSynthetic /
  // DeadlineReminderService's remindedKeys. Worst case on a restart: a
  // pending Score Update never gets its Impact/overturn follow-up, which is
  // harmless (the feed just has one fewer message), never a duplicate or a
  // crash.
  private readonly pendingVerifications = new Map<string, PendingVerification>();

  constructor(
    clientOrRepositories: SupabaseClient<Database> | LiveFeedRepositories,
    private impactGenerator: LiveChatGenerator = new MockLiveChatGenerator(),
    private matchweekOverview?: Pick<MatchweekOverviewService, "getMatchweekScores">,
    private scoreUpdateGenerator: LiveChatGenerator = new DeterministicMessageGenerator()
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
    if (!SUPPORTED_EVENT_TYPES.has(input.eventType)) {
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
    const eventKey = this.eventKey(input);

    // The factual "what happened" message never depends on any particular
    // group's predictions, so it's computed once and reused for every group
    // -- unlike the (group-specific) Impact message below. Goal/red_card
    // Score Updates go through the AI generator (varied "take the lead" /
    // "extend their lead" etc. phrasing); the ambient markers (kickoff,
    // halftime, etc.) stay purely deterministic -- there's no lead/trail
    // framing to vary for those.
    const factualContext = this.buildEventFactualContext(input, fixture);
    const isVerifiable = VERIFIABLE_EVENT_TYPES.has(input.eventType);
    const factualMessage = isVerifiable
      ? await this.scoreUpdateGenerator.generate(factualContext)
      : buildFactualMessage(factualContext);

    const rows = await Promise.all(
      groups.map((group) =>
        this.repositories.liveFeedEvents.upsertFeedEvent({
          friends_group_id: group.id,
          fixture_id: fixture.id,
          matchweek: fixture.matchweek,
          sm_fixture_id: fixture.sm_fixture_id,
          event_key: isVerifiable ? `${eventKey}:score` : eventKey,
          event_type: input.eventType,
          payload: {
            ...factualContext,
            stage: isVerifiable ? "score_update" : "ambient",
            smEventId: input.smEventId ?? null,
          } as Json,
          ai_message: factualMessage,
        })
      )
    );

    if (isVerifiable && groups.length) {
      this.pendingVerifications.set(eventKey, {
        key: eventKey,
        eventType: input.eventType as "goal" | "red_card",
        smFixtureId: fixture.sm_fixture_id,
        fixtureId: fixture.id,
        detectedAt: Date.now(),
        groups,
        input,
        fixture,
      });
    }

    return { created: rows.length, rows };
  }

  // Verifications for a given fixture whose delay has elapsed, as of `now`.
  // The poller calls this once per fixture per tick (it already has fresh
  // score/event data for that fixture this tick) and decides confirmed vs.
  // overturned itself, then reports back via resolveVerification.
  getDuePendingVerifications(smFixtureId: number, now = Date.now()): PendingVerification[] {
    return Array.from(this.pendingVerifications.values()).filter(
      (item) => item.smFixtureId === smFixtureId && now - item.detectedAt >= VERIFICATION_DELAY_MS
    );
  }

  // All pending verifications for a fixture, regardless of whether their
  // delay has elapsed -- used when a fixture drops off the live list
  // entirely before its verification became due (see
  // LiveEventsPollerService.finalizeDroppedOutFixtures): can't re-verify a
  // fixture we're no longer tracking, so it's finalized as confirmed rather
  // than left pending forever.
  getAllPendingVerifications(smFixtureId: number): PendingVerification[] {
    return Array.from(this.pendingVerifications.values()).filter(
      (item) => item.smFixtureId === smFixtureId
    );
  }

  async resolveVerification(key: string, confirmed: boolean): Promise<void> {
    const pending = this.pendingVerifications.get(key);
    if (!pending) return;
    this.pendingVerifications.delete(key);

    if (!confirmed) {
      const message = buildOverturnedMessage(pending.eventType);
      await Promise.all(
        pending.groups.map((group) =>
          this.repositories.liveFeedEvents.upsertFeedEvent({
            friends_group_id: group.id,
            fixture_id: pending.fixtureId,
            matchweek: pending.fixture.matchweek,
            sm_fixture_id: pending.smFixtureId,
            event_key: `${pending.key}:overturned`,
            event_type: pending.eventType,
            payload: { stage: "overturned" } as Json,
            ai_message: message,
          })
        )
      );
      return;
    }

    await Promise.all(
      pending.groups.map(async (group) => {
        const submittedUserIds = await this.getSubmittedUserIds(group.id, pending.fixture);
        const context = await this.buildGroupContext(
          pending.input,
          pending.fixture,
          group,
          submittedUserIds
        );
        const filteredImpacts = filterImpactsForMessage(context.impacts);
        // Nothing meaningful changed -- no row at all, not even an empty one.
        if (!filteredImpacts.length) return;

        const impactContext = { ...context, impacts: filteredImpacts };
        const aiMessage = await this.impactGenerator.generate(impactContext);

        await this.repositories.liveFeedEvents.upsertFeedEvent({
          friends_group_id: group.id,
          fixture_id: pending.fixtureId,
          matchweek: pending.fixture.matchweek,
          sm_fixture_id: pending.smFixtureId,
          event_key: `${pending.key}:impact`,
          event_type: pending.eventType,
          payload: { ...impactContext, stage: "impact" } as Json,
          ai_message: aiMessage,
        });
      })
    );
  }

  private buildEventFactualContext(
    input: LiveEventInput,
    fixture: FixtureRow
  ): LiveChatContext {
    const fixtureName = `${fixture.home_team} vs ${fixture.away_team}`;
    const shared = {
      groupName: "",
      eventType: input.eventType,
      fixtureName,
      homeTeam: fixture.home_team,
      awayTeam: fixture.away_team,
      matchweek: fixture.matchweek,
      minute: input.minute ?? null,
      player: input.playerName ?? null,
      assistedBy: input.assistedBy ?? null,
      team: input.team ?? null,
      isPenalty: Boolean(input.isPenalty),
      isOwnGoal: Boolean(input.isOwnGoal),
      impacts: [] as PredictionImpact[],
      reason: "match_event",
    };

    if (input.eventType === "goal") {
      // Same before/after resolution as buildGroupContext -- see the
      // comment there for why input.homeScore/awayScore (the per-event
      // SportMonks value) wins over fixture.live_*_score (Source A, which
      // can lag a tick behind the per-fixture events feed).
      const beforeHome =
        input.beforeHomeScore ?? fixture.live_home_score ?? fixture.home_score ?? 0;
      const beforeAway =
        input.beforeAwayScore ?? fixture.live_away_score ?? fixture.away_score ?? 0;
      const afterHome = input.homeScore ?? beforeHome;
      const afterAway = input.awayScore ?? beforeAway;

      return {
        ...shared,
        score: { home: afterHome, away: afterAway },
        previousScore: { home: beforeHome, away: beforeAway },
      };
    }

    return {
      ...shared,
      score: {
        home: fixture.live_home_score ?? fixture.home_score ?? input.homeScore ?? null,
        away: fixture.live_away_score ?? fixture.away_score ?? input.awayScore ?? null,
      },
    };
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
    // as the displayed `score` for goal events.
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
      previousScore: {
        home: beforeHome,
        away: beforeAway,
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
