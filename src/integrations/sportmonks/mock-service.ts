import {
  FixtureInsert,
  MatchEventInsert,
  SportMonksConfig,
} from "../../services/dto/types.js";
import SportMonksService from "./service.js";

type MockFixtureOptions = {
  smFixtureId: number;
  leagueId: number;
  seasonId: number;
  roundId: number;
  matchweek: string;
  homeTeam: string;
  awayTeam: string;
  daysFromNow: number;
  status: "scheduled" | "live" | "finished";
  homeScore?: number | null;
  awayScore?: number | null;
  hasRedCard?: boolean | null;
  currentMinute?: number | null;
};

export default class SportMonksMockService extends SportMonksService {
  constructor(config?: Partial<SportMonksConfig>) {
    super({
      apiUrl: config?.apiUrl ?? "mock://sportmonks",
      token: config?.token ?? "mock",
      timeout: config?.timeout,
      retries: config?.retries,
      retryDelay: config?.retryDelay,
      rateLimit: config?.rateLimit,
    });
  }

  async getAllFixtures(matchweek: string, leagueIds?: number[]) {
    return this.filterLeague(this.baseLeagueFixtures(), leagueIds).filter(
      (fixture) => fixture.matchweek === matchweek
    );
  }

  async getFixturesByDateRange(startDate: string, endDate: string) {
    return this.baseLeagueFixtures().filter(
      (fixture) =>
        fixture.match_date >= startDate && fixture.match_date <= endDate
    );
  }

  async getFixturesByDate(date: string) {
    return this.getFixturesByDateRange(date, date);
  }

  async getLeagueWithCurrentSeason(leagueId: number) {
    const catalog = new Map([
      [
        501,
        {
          name: "Premiership",
          countryName: "Scotland",
          imagePath: "https://cdn.sportmonks.com/images/soccer/leagues/501.png",
          seasonId: 25598,
          seasonName: "2025/2026",
        },
      ],
      [
        271,
        {
          name: "Superliga",
          countryName: "Denmark",
          imagePath: "https://cdn.sportmonks.com/images/soccer/leagues/271.png",
          seasonId: 25599,
          seasonName: "2025/2026",
        },
      ],
    ]);
    const row = catalog.get(leagueId) ?? {
      name: `Mock League ${leagueId}`,
      countryName: "Mock",
      imagePath: "",
      seasonId: 25000 + leagueId,
      seasonName: "2025/2026",
    };

    return {
      league: {
        id: leagueId,
        sport_id: 1,
        country_id: 0,
        name: row.name,
        active: true,
        short_code: "",
        image_path: row.imagePath,
        type: "league",
        sub_type: "domestic",
        last_played_at: "",
        category: 0,
        has_jerseys: false,
      },
      currentSeason: {
        id: row.seasonId,
        league_id: leagueId,
        name: row.seasonName,
        is_current: true,
      },
    };
  }

  async getScheduledFixtures(days = 30) {
    const maxDate = this.dateFromNow(days);
    return this.baseLeagueFixtures().filter(
      (fixture) =>
        fixture.status === "scheduled" && fixture.match_date <= maxDate
    );
  }

  async getFinishedFixtures(days = 7, leagueIds?: number[]) {
    return this.filterLeague(this.finishedRefreshFixtures(), leagueIds).filter(
      (fixture) => fixture.status === "finished"
    );
  }

  async getLiveMatches() {
    return this.getLiveFixtures();
  }

  async getLatestUpdatedFixtures() {
    return this.getLiveFixtures();
  }

  async getFixturesByLeague(leagueId: string, seasonId?: string) {
    const numericLeagueId = Number(leagueId);
    const numericSeasonId = seasonId ? Number(seasonId) : undefined;

    return this.baseLeagueFixtures().filter(
      (fixture) =>
        fixture.sm_league_id === numericLeagueId &&
        (!numericSeasonId || fixture.sm_season_id === numericSeasonId)
    );
  }

  async getFixturesWithRedCards(days = 7) {
    const fixtures = await this.getFinishedFixtures(days);
    return fixtures.filter((fixture) => fixture.has_red_card === true);
  }

  async checkIfFixturesStarted(leagueId: string) {
    const live = await this.getLiveFixtures([Number(leagueId)]);
    return live.length > 0;
  }

  async getLiveFixtures(leagueIds?: number[]) {
    return this.filterLeague(this.liveFixtures(), leagueIds);
  }

  async getUpcomingFixtures(days = 7, leagueIds?: number[]) {
    const maxDate = this.dateFromNow(days);
    return this.filterLeague(this.baseLeagueFixtures(), leagueIds)
      .filter(
        (fixture) =>
          fixture.status !== "finished" && fixture.match_date <= maxDate
      )
      .sort((a, b) => `${a.match_date}${a.match_time}`.localeCompare(`${b.match_date}${b.match_time}`));
  }

  async getFixtureById(fixtureId: number): Promise<{
    fixture: FixtureInsert;
    events?: MatchEventInsert[];
  }> {
    const fixture =
      this.baseLeagueFixtures().find((f) => f.sm_fixture_id === fixtureId) ??
      this.finishedRefreshFixtures().find((f) => f.sm_fixture_id === fixtureId) ??
      this.liveFixtures().find((f) => f.sm_fixture_id === fixtureId);

    if (!fixture) {
      throw new Error(`Mock fixture ${fixtureId} not found`);
    }

    return {
      fixture,
      events: fixture.has_red_card
        ? [
            {
              event_type: "red_card",
              minute: 72,
              player_name: "Mock Defender",
              team: fixture.home_team,
              provider: "sportmonks-mock",
              sm_event_id: fixture.sm_fixture_id * 10 + 1,
              sm_fixture_id: fixture.sm_fixture_id,
            },
          ]
        : [],
    };
  }

  async getFixturesByTeam() {
    return this.baseLeagueFixtures();
  }

  async getFixturesGroupedByMatchweek(leagueId?: number) {
    const groups: Record<string, FixtureInsert[]> = {};
    for (const fixture of this.filterLeague(
      this.baseLeagueFixtures(),
      leagueId ? [leagueId] : undefined
    )) {
      const key = fixture.matchweek ?? "Unknown";
      groups[key] = groups[key] ?? [];
      groups[key].push(fixture);
    }
    return groups;
  }

  async healthCheck() {
    return {
      isHealthy: true,
      rateLimitStatus: {
        requestsRemaining: 999999,
        windowResetAt: new Date(Date.now() + 3600000),
        isLimited: false,
      },
    };
  }

  async getTodayLiveFixturesWithFallback(leagueIds?: number[]) {
    return this.getLiveFixtures(leagueIds);
  }

  async getTodaysFixtures(leagueIds?: number[]) {
    return this.filterLeague(this.liveFixtures(), leagueIds);
  }

  private baseLeagueFixtures(): FixtureInsert[] {
    const leagueId = 8;
    const seasonId = 28083;

    return [
      this.fixture({
        smFixtureId: 900001,
        leagueId,
        seasonId,
        roundId: 101,
        matchweek: "Matchweek 1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        daysFromNow: -8,
        status: "finished",
        homeScore: 2,
        awayScore: 1,
        hasRedCard: true,
      }),
      this.fixture({
        smFixtureId: 900002,
        leagueId,
        seasonId,
        roundId: 101,
        matchweek: "Matchweek 1",
        homeTeam: "Liverpool",
        awayTeam: "Manchester City",
        daysFromNow: -8,
        status: "finished",
        homeScore: 1,
        awayScore: 1,
        hasRedCard: false,
      }),
      this.fixture({
        smFixtureId: 900003,
        leagueId,
        seasonId,
        roundId: 102,
        matchweek: "Matchweek 2",
        homeTeam: "Arsenal",
        awayTeam: "Liverpool",
        daysFromNow: 5,
        status: "scheduled",
      }),
      this.fixture({
        smFixtureId: 900004,
        leagueId,
        seasonId,
        roundId: 102,
        matchweek: "Matchweek 2",
        homeTeam: "Chelsea",
        awayTeam: "Manchester City",
        daysFromNow: 5,
        status: "scheduled",
      }),
      this.fixture({
        smFixtureId: 900005,
        leagueId,
        seasonId,
        roundId: 103,
        matchweek: "Matchweek 3",
        homeTeam: "Arsenal",
        awayTeam: "Manchester City",
        daysFromNow: 12,
        status: "scheduled",
      }),
      this.fixture({
        smFixtureId: 900006,
        leagueId,
        seasonId,
        roundId: 103,
        matchweek: "Matchweek 3",
        homeTeam: "Chelsea",
        awayTeam: "Liverpool",
        daysFromNow: 12,
        status: "scheduled",
      }),
    ];
  }

  private finishedRefreshFixtures(): FixtureInsert[] {
    return [
      ...this.baseLeagueFixtures().filter((fixture) => fixture.status === "finished"),
      this.fixture({
        smFixtureId: 900003,
        leagueId: 8,
        seasonId: 28083,
        roundId: 102,
        matchweek: "Matchweek 2",
        homeTeam: "Arsenal",
        awayTeam: "Liverpool",
        daysFromNow: -1,
        status: "finished",
        homeScore: 2,
        awayScore: 1,
        hasRedCard: true,
      }),
      this.fixture({
        smFixtureId: 900004,
        leagueId: 8,
        seasonId: 28083,
        roundId: 102,
        matchweek: "Matchweek 2",
        homeTeam: "Chelsea",
        awayTeam: "Manchester City",
        daysFromNow: -1,
        status: "finished",
        homeScore: 0,
        awayScore: 2,
        hasRedCard: false,
      }),
    ];
  }

  private liveFixtures(): FixtureInsert[] {
    return [
      this.fixture({
        smFixtureId: 900004,
        leagueId: 8,
        seasonId: 28083,
        roundId: 102,
        matchweek: "Matchweek 2",
        homeTeam: "Chelsea",
        awayTeam: "Manchester City",
        daysFromNow: 0,
        status: "live",
        homeScore: 0,
        awayScore: 1,
        hasRedCard: false,
        currentMinute: 63,
      }),
    ];
  }

  private fixture(options: MockFixtureOptions): FixtureInsert {
    const matchDate = this.dateFromNow(options.daysFromNow);
    const matchTime = "15:00:00";
    const scoreKnown = options.status !== "scheduled";
    const homeScore = scoreKnown ? options.homeScore ?? 0 : null;
    const awayScore = scoreKnown ? options.awayScore ?? 0 : null;

    return {
      provider: "sportmonks-mock",
      sm_fixture_id: options.smFixtureId,
      sm_league_id: options.leagueId,
      sm_season_id: options.seasonId,
      sm_round_id: options.roundId,
      home_team: options.homeTeam,
      away_team: options.awayTeam,
      home_score: homeScore,
      away_score: awayScore,
      live_home_score: options.status === "live" ? homeScore : null,
      live_away_score: options.status === "live" ? awayScore : null,
      has_red_card: scoreKnown ? options.hasRedCard ?? false : null,
      current_minute: options.currentMinute ?? null,
      match_date: matchDate,
      match_time: matchTime,
      starting_at: `${matchDate}T${matchTime}Z`,
      matchweek: options.matchweek,
      status: options.status,
      provider_payload: {
        mock: true,
        status: options.status,
      },
    };
  }

  private filterLeague(fixtures: FixtureInsert[], leagueIds?: number[]) {
    if (!leagueIds?.length) return fixtures;
    return fixtures.filter((fixture) => leagueIds.includes(fixture.sm_league_id));
  }

  private dateFromNow(days: number) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
}
