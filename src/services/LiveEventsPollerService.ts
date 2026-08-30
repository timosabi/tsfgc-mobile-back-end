import type { SportMonksHydrationService } from "../integrations/sportmonks/hydration-service.js";
import type { SportMonksLiveService } from "../integrations/sportmonks/live-service.js";
import type SportMonksService from "../integrations/sportmonks/service.js";
import type WeeklyScoreService from "./WeeklyScoreService.js";
import type LiveFeedService from "./LiveFeedService.js";
import type { Database } from "../integrations/supabase/types.js";
import type { FixtureInsert } from "./dto/types.js";

type FixtureRow = Database["public"]["Tables"]["fixtures"]["Row"];
type FreshFixtureState = Pick<
  FixtureInsert,
  "sm_fixture_id" | "current_minute" | "provider_payload"
>;

const GOAL_EVENT_TYPES = new Set(["goal", "own_goal", "penalty_goal"]);
const HALFTIME_KEY_OFFSET = 901;
const MINUTE_85_KEY_OFFSET = 902;
const FULLTIME_KEY_OFFSET = 903;
const FULLTIME_STATES = new Set(["FT", "AET", "FT_PEN"]);

export default class LiveEventsPollerService {
  private readonly previouslyLive = new Set<number>();
  private readonly firedSynthetic = new Set<number>();
  private isPolling = false;

  constructor(
    private readonly deps: {
      sportMonks: Pick<SportMonksService, "getFixtureById">;
      live: SportMonksLiveService;
      hydration: SportMonksHydrationService;
      weeklyScore: WeeklyScoreService;
      liveFeed: LiveFeedService;
      leagueIds: number[];
    }
  ) {}

  async poll(): Promise<{ liveCount: number; skipped?: boolean }> {
    if (this.isPolling) {
      console.warn("[LivePoller] Skipping tick: previous poll() still in progress");
      return { liveCount: 0, skipped: true };
    }

    this.isPolling = true;
    const startedAt = Date.now();

    try {
      const liveFixtures = await this.deps.live.getLiveFixtures(
        this.deps.leagueIds
      );
      const liveIds = new Set(liveFixtures.map((f) => f.sm_fixture_id));

      await this.finalizeDroppedOutFixtures(liveIds);
      this.previouslyLive.clear();
      liveIds.forEach((id) => this.previouslyLive.add(id));

      for (const fixture of liveFixtures) {
        await this.processFixture(fixture);
      }

      return { liveCount: liveFixtures.length };
    } finally {
      this.isPolling = false;
      console.log(`[LivePoller] tick finished in ${Date.now() - startedAt}ms`);
    }
  }

  private async finalizeDroppedOutFixtures(liveIds: Set<number>): Promise<void> {
    const droppedOut = Array.from(this.previouslyLive).filter(
      (id) => !liveIds.has(id)
    );
    if (!droppedOut.length) return;

    console.log(
      `[LivePoller] ${droppedOut.length} fixture(s) dropped off the live list, fast-finalizing`
    );
    await this.deps.hydration.hydrateFinishedFixtures(1, this.deps.leagueIds);
    await this.deps.weeklyScore.calculateAllFinished();

    // A fixture that drops off the live list before we ever observe state=FT
    // while still polling it normally (processFixture/processSyntheticEvents)
    // would otherwise never get its "fulltime" commentary event -- the score
    // gets finalized above, but nothing ever announces it. Fire it here as a
    // fallback; fireSynthetic's own dedup (plus processEvent's sm_event_id
    // dedup) makes this a no-op if the normal path already fired it.
    for (const smFixtureId of droppedOut) {
      await this.fireSynthetic(
        { sm_fixture_id: smFixtureId, current_minute: null, provider_payload: null },
        "fulltime",
        FULLTIME_KEY_OFFSET,
        null,
        null
      );
    }
  }

  private async processFixture(fixture: FixtureRow): Promise<void> {
    const homeScore = fixture.live_home_score ?? fixture.home_score;
    const awayScore = fixture.live_away_score ?? fixture.away_score;

    const { fixture: freshFixture, events } =
      await this.deps.sportMonks.getFixtureById(fixture.sm_fixture_id, true);

    // Replay goals in chronological order every tick so each one gets an accurate
    // before/after score for prediction-impact diffing. `fixture.live_home_score`
    // already reflects the CURRENT (post-goal) total by the time we get here — it's
    // patched by the live-fixtures fetch earlier in poll() — so it can't be used as
    // "the score right before this specific goal." Already-processed goals just
    // replay harmlessly thanks to processEvent's dedup.
    const orderedEvents = [...(events ?? [])].sort((a, b) => a.minute - b.minute);
    let runningHome = 0;
    let runningAway = 0;

    for (const event of orderedEvents) {
      const eventType = this.mapEventType(event.event_type);
      if (!eventType) continue;

      if (eventType === "goal") {
        const beforeHomeScore = runningHome;
        const beforeAwayScore = runningAway;

        if (this.goalCreditedToHome(event, fixture)) {
          runningHome += 1;
        } else {
          runningAway += 1;
        }

        // SportMonks embeds the authoritative resulting score directly on the
        // event itself (payload.result, e.g. "3-1"). Prefer it over our own
        // increment whenever present -- it's immune both to our own-goal
        // crediting logic above (goalCreditedToHome has been wrong before)
        // and to the separately-polled bulk /livescores feed (Source A)
        // lagging behind the per-fixture events feed for this instant.
        const authoritative = this.parseEventResult(event.provider_payload);
        if (authoritative) {
          runningHome = authoritative.home;
          runningAway = authoritative.away;
        }

        await this.deps.liveFeed.processEvent({
          eventType,
          smFixtureId: fixture.sm_fixture_id,
          smEventId: event.sm_event_id,
          minute: event.minute,
          team: event.team,
          playerName: event.player_name,
          assistedBy: event.assist_player ?? null,
          isPenalty: event.event_type === "penalty_goal",
          isOwnGoal: event.event_type === "own_goal",
          homeScore: runningHome,
          awayScore: runningAway,
          beforeHomeScore,
          beforeAwayScore,
          providerPayload: event.provider_payload,
        });
        continue;
      }

      await this.deps.liveFeed.processEvent({
        eventType,
        smFixtureId: fixture.sm_fixture_id,
        smEventId: event.sm_event_id,
        minute: event.minute,
        team: event.team,
        playerName: event.player_name,
        homeScore,
        awayScore,
        providerPayload: event.provider_payload,
      });
    }

    await this.processSyntheticEvents(freshFixture, homeScore, awayScore);
  }

  private parseEventResult(
    payload: unknown
  ): { home: number; away: number } | null {
    if (!payload || typeof payload !== "object") return null;

    const result = (payload as { result?: unknown }).result;
    if (typeof result !== "string") return null;

    const match = result.match(/^(\d+)-(\d+)$/);
    if (!match) return null;

    return { home: Number(match[1]), away: Number(match[2]) };
  }

  private goalCreditedToHome(
    event: { event_type: string; team: string },
    fixture: FixtureRow
  ): boolean {
    const scorerIsHomeTeam = event.team === fixture.home_team;
    // Own goals count for the side opposing whichever team the scoring player belongs to.
    return event.event_type === "own_goal" ? !scorerIsHomeTeam : scorerIsHomeTeam;
  }

  private async processSyntheticEvents(
    fixture: FreshFixtureState,
    homeScore: number | null,
    awayScore: number | null
  ): Promise<void> {
    if (this.isHalftime(fixture)) {
      await this.fireSynthetic(
        fixture,
        "halftime",
        HALFTIME_KEY_OFFSET,
        homeScore,
        awayScore
      );
    }

    if ((fixture.current_minute ?? 0) >= 85) {
      await this.fireSynthetic(
        fixture,
        "minute_85",
        MINUTE_85_KEY_OFFSET,
        homeScore,
        awayScore
      );
    }

    if (this.isFulltime(fixture)) {
      await this.fireSynthetic(
        fixture,
        "fulltime",
        FULLTIME_KEY_OFFSET,
        homeScore,
        awayScore
      );
    }
  }

  private async fireSynthetic(
    fixture: FreshFixtureState,
    eventType: "halftime" | "minute_85" | "fulltime",
    keyOffset: number,
    homeScore: number | null,
    awayScore: number | null
  ): Promise<void> {
    const smEventId = fixture.sm_fixture_id * 1000 + keyOffset;
    if (this.firedSynthetic.has(smEventId)) return;

    const result = await this.deps.liveFeed.processEvent({
      eventType,
      smFixtureId: fixture.sm_fixture_id,
      smEventId,
      minute: fixture.current_minute,
      homeScore,
      awayScore,
    });

    if (!("skipped" in result) || !result.skipped) {
      this.firedSynthetic.add(smEventId);
    } else if (result.reason === "already_processed") {
      this.firedSynthetic.add(smEventId);
    }
  }

  private mapEventType(rawType: string): "goal" | "red_card" | null {
    if (GOAL_EVENT_TYPES.has(rawType)) return "goal";
    if (rawType === "red_card") return "red_card";
    return null;
  }

  private isHalftime(fixture: FreshFixtureState): boolean {
    const payload = fixture.provider_payload as {
      state?: { developer_name?: string };
    } | null;
    return payload?.state?.developer_name === "HT";
  }

  private isFulltime(fixture: FreshFixtureState): boolean {
    const payload = fixture.provider_payload as {
      state?: { developer_name?: string };
    } | null;
    const developerName = payload?.state?.developer_name;
    return developerName ? FULLTIME_STATES.has(developerName) : false;
  }
}
