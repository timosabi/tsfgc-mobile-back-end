import type { SportMonksHydrationService } from "../integrations/sportmonks/hydration-service.js";
import type { SportMonksLiveService } from "../integrations/sportmonks/live-service.js";
import type SportMonksService from "../integrations/sportmonks/service.js";
import type WeeklyScoreService from "./WeeklyScoreService.js";
import type LiveFeedService from "./LiveFeedService.js";
import type { Database } from "../integrations/supabase/types.js";

type FixtureRow = Database["public"]["Tables"]["fixtures"]["Row"];

const GOAL_EVENT_TYPES = new Set(["goal", "own_goal", "penalty_goal"]);
const HALFTIME_KEY_OFFSET = 901;
const MINUTE_85_KEY_OFFSET = 902;

export default class LiveEventsPollerService {
  private readonly previouslyLive = new Set<number>();
  private readonly firedSynthetic = new Set<number>();

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

  async poll(): Promise<{ liveCount: number }> {
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
  }

  private async processFixture(fixture: FixtureRow): Promise<void> {
    const homeScore = fixture.live_home_score ?? fixture.home_score;
    const awayScore = fixture.live_away_score ?? fixture.away_score;

    const { events } = await this.deps.sportMonks.getFixtureById(
      fixture.sm_fixture_id,
      true
    );

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

        await this.deps.liveFeed.processEvent({
          eventType,
          smFixtureId: fixture.sm_fixture_id,
          smEventId: event.sm_event_id,
          minute: event.minute,
          team: event.team,
          playerName: event.player_name,
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

    await this.processSyntheticEvents(fixture, homeScore, awayScore);
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
    fixture: FixtureRow,
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
  }

  private async fireSynthetic(
    fixture: FixtureRow,
    eventType: "halftime" | "minute_85",
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

  private isHalftime(fixture: FixtureRow): boolean {
    const payload = fixture.provider_payload as {
      state?: { developer_name?: string };
    } | null;
    return payload?.state?.developer_name === "HT";
  }
}
