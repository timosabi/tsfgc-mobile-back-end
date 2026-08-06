import {
  SportMonksFixture,
  SportMonksEvent,
  FixtureInsert,
  MatchEventInsert,
  SportMonksParticipant,
} from "../../services/dto/types.js";
import type { Json } from "../supabase/types.js";

export class SportMonksTransformer {
  static transformFixture(sportMonksFixture: SportMonksFixture): FixtureInsert {
    const participants = sportMonksFixture.participants || [];
    const homeTeam = participants.find((p) => p.meta?.location === "home");
    const awayTeam = participants.find((p) => p.meta?.location === "away");

    const scores = sportMonksFixture.scores || [];
    const currentHomeScore = this.currentScoreFor(scores, homeTeam?.id);
    const currentAwayScore = this.currentScoreFor(scores, awayTeam?.id);

    const currentPeriod = sportMonksFixture.periods?.find((p) => p.ticking);
    const currentMinute = currentPeriod?.minutes || null;

    const [matchDate, rawTime = "00:00:00"] =
      sportMonksFixture.starting_at.split(" ");
    const matchTime = rawTime.slice(0, 8);
    const startingAt = `${matchDate}T${matchTime}Z`;

    const matchweek = this.toMatchweekLabel(sportMonksFixture);

    const status = this.mapFixtureStatus(
      sportMonksFixture.state?.developer_name,
      sportMonksFixture.state_id
    );

    const hasRedCard = sportMonksFixture.events
      ? this.hasRedCardInEvents(sportMonksFixture.events)
      : null;

    return {
      away_score: currentAwayScore,
      away_team: awayTeam?.name || "Unknown Away Team",
      current_minute: currentMinute,
      has_red_card: hasRedCard,
      home_score: currentHomeScore,
      home_team: homeTeam?.name || "Unknown Home Team",
      live_away_score: status === "live" ? currentAwayScore : null,
      live_home_score: status === "live" ? currentHomeScore : null,
      match_date: matchDate,
      match_time: matchTime,
      matchweek: matchweek,
      provider: "sportmonks",
      provider_payload: sportMonksFixture as unknown as Json,
      starting_at: startingAt,
      status: status,
      sm_fixture_id: sportMonksFixture.id,
      sm_league_id: sportMonksFixture.league_id,
      sm_season_id: sportMonksFixture.season_id,
      sm_round_id: sportMonksFixture.round_id,
    };
  }

  private static toMatchweekLabel(f: SportMonksFixture): string | null {
    const name = f.round?.name ?? "";
    const id = f.round_id;

    const numFromName = name.match(/\d+/)?.[0];

    const n =
      numFromName ??
      (typeof id === "number" && Number.isFinite(id) ? String(id) : null);

    if (n) return `Matchweek ${n}`;
    return name || null;
  }

  private static currentScoreFor(
    scores: SportMonksFixture["scores"],
    participantId?: number
  ): number | null {
    if (!scores?.length || !participantId) return null;

    const current = scores.find(
      (score) =>
        score.participant_id === participantId &&
        score.description === "CURRENT"
    );

    return current?.score?.goals ?? null;
  }

  static transformMatchEvent(
    sportMonksEvent: SportMonksEvent,
    participants: SportMonksParticipant[]
  ): MatchEventInsert {
    const team = participants.find(
      (p) => p.id === sportMonksEvent.participant_id
    );

    const eventType = this.mapEventType(sportMonksEvent.type_id);

    return {
      assist_player: sportMonksEvent.related_player_name || null,
      event_type: eventType,
      fixture_id: sportMonksEvent.fixture_id,
      minute: sportMonksEvent.minute + (sportMonksEvent.extra_minute || 0),
      player_name: sportMonksEvent.player_name,
      provider: "sportmonks",
      provider_payload: sportMonksEvent as unknown as Json,
      sm_event_id: sportMonksEvent.id,
      sm_fixture_id: sportMonksEvent.fixture_id,
      team: team?.name || "Unknown Team",
    };
  }

  static transformFixtures(
    sportMonksFixtures: SportMonksFixture[]
  ): FixtureInsert[] {
    if (!Array.isArray(sportMonksFixtures)) return [];
    return sportMonksFixtures.map((fixture) => this.transformFixture(fixture));
  }

  static transformMatchEvents(
    sportMonksEvents: SportMonksEvent[],
    participants: SportMonksParticipant[]
  ): MatchEventInsert[] {
    return sportMonksEvents.map((event) =>
      this.transformMatchEvent(event, participants)
    );
  }

  static mapFixtureStatus(sportMonksState?: string, stateId?: number): string {
    const statusByStateId: Record<number, string> = {
      1: "scheduled",
      2: "live",
      3: "live",
      4: "live",
      5: "finished",
      6: "live",
      7: "finished",
      8: "finished",
      9: "live",
      10: "postponed",
      11: "suspended",
      12: "cancelled",
      13: "suspended",
      14: "suspended",
      15: "cancelled",
      16: "postponed",
      17: "finished",
      18: "suspended",
      19: "suspended",
      20: "cancelled",
      21: "live",
      22: "live",
      25: "live",
      26: "scheduled",
    };

    if (stateId && statusByStateId[stateId]) return statusByStateId[stateId];

    const statusMap: Record<string, string> = {
      not_started: "scheduled",
      NOT_STARTED: "scheduled",
      NS: "scheduled",
      starting_soon: "scheduled",
      STARTING_SOON: "scheduled",
      TBA: "scheduled",

      first_half: "live",
      INPLAY_1ST_HALF: "live",
      half_time: "live",
      second_half: "live",
      INPLAY_2ND_HALF: "live",
      INPLAY_ET: "live",
      INPLAY_PENALTIES: "live",
      extra_time: "live",
      penalty_shootout: "live",
      LIVE: "live",
      HT: "live",
      ET: "live",
      BREAK: "live",
      PEN_LIVE: "live",

      finished: "finished",
      FULL_TIME: "finished",
      finished_after_extra_time: "finished",
      finished_after_penalty_shootout: "finished",
      postponed: "postponed",
      POSTPONED: "postponed",
      cancelled: "cancelled",
      CANCELLED: "cancelled",
      suspended: "suspended",
      SUSPENDED: "suspended",
      interrupted: "suspended",
      INTERRUPTED: "suspended",
      ABANDONED: "cancelled",
      FT: "finished",
      AET: "finished",
      FT_PEN: "finished",
    };

    return statusMap[sportMonksState || ""] || "scheduled";
  }

  private static mapEventType(typeId: number): string {
    const eventTypeMap: Record<number, string> = {
      10: "var_decision",
      14: "goal",
      15: "own_goal",
      16: "penalty_goal",
      17: "penalty_missed",
      18: "substitution",
      19: "yellow_card",
      20: "red_card",
      21: "red_card",
      22: "penalty_shootout_missed",
      23: "penalty_shootout_goal",
    };

    return eventTypeMap[typeId] || "unknown";
  }

  static extractTeams(participants: SportMonksParticipant[]): {
    homeTeam: SportMonksParticipant | null;
    awayTeam: SportMonksParticipant | null;
  } {
    const homeTeam =
      participants.find((p) => p.meta?.location === "home") || null;
    const awayTeam =
      participants.find((p) => p.meta?.location === "away") || null;

    return { homeTeam, awayTeam };
  }

  static hasRedCardInEvents(events: SportMonksEvent[]): boolean {
    return events.some(
      (event) => this.mapEventType(event.type_id) === "red_card"
    );
  }

  static calculateTotalGoalsFromEvents(events: SportMonksEvent[]): number {
    return events.filter((event) => {
      const eventType = this.mapEventType(event.type_id);
      return ["goal", "own_goal", "penalty_goal"].includes(eventType);
    }).length;
  }

  static groupFixturesByMatchweek(
    fixtures: SportMonksFixture[]
  ): Record<string, SportMonksFixture[]> {
    return fixtures.reduce((groups, fixture) => {
      const matchweek = fixture.round?.name || "Unknown";
      if (!groups[matchweek]) {
        groups[matchweek] = [];
      }
      groups[matchweek].push(fixture);
      return groups;
    }, {} as Record<string, SportMonksFixture[]>);
  }

  static filterFixturesByStatus(
    fixtures: SportMonksFixture[],
    status: "live" | "scheduled" | "finished"
  ): SportMonksFixture[] {
    return fixtures.filter((fixture) => {
      const mappedStatus = this.mapFixtureStatus(fixture.state?.developer_name);
      return mappedStatus === status;
    });
  }

  static getUpcomingFixtures(
    fixtures: SportMonksFixture[],
    days: number = 7
  ): SportMonksFixture[] {
    const now = new Date();
    const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    return fixtures
      .filter((fixture) => {
        const fixtureDate = new Date(fixture.starting_at);
        return fixtureDate > now && fixtureDate <= futureDate;
      })
      .sort(
        (a, b) =>
          new Date(a.starting_at).getTime() - new Date(b.starting_at).getTime()
      );
  }

  static validateFixture(fixture: FixtureInsert): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!fixture.home_team || fixture.home_team.trim().length === 0) {
      errors.push("Home team name is required");
    }

    if (!fixture.away_team || fixture.away_team.trim().length === 0) {
      errors.push("Away team name is required");
    }

    if (
      !fixture.match_date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fixture.match_date)
    ) {
      errors.push("Valid match date (YYYY-MM-DD) is required");
    }

    if (
      !fixture.match_time ||
      !/^\d{2}:\d{2}:\d{2}$/.test(fixture.match_time)
    ) {
      errors.push("Valid match time (HH:MM:SS) is required");
    }

    if (
      fixture.home_score !== undefined &&
      fixture.home_score !== null &&
      fixture.home_score < 0
    ) {
      errors.push("Home score cannot be negative");
    }

    if (
      fixture.away_score !== undefined &&
      fixture.away_score !== null &&
      fixture.away_score < 0
    ) {
      errors.push("Away score cannot be negative");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

export default SportMonksTransformer;
