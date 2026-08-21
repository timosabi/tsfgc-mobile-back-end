import {
  FixtureInsert,
  MatchEventInsert,
  SportMonksApiResponse,
  SportMonksConfig,
  SportMonksError,
  SportMonksFixture,
  SportMonksLeague,
  SportMonksSeason,
} from "../../services/dto/types.js";
import SportMonksClient from "./client.js";
import SportMonksTransformer from "./transformer.js";

type RateLimitStatus = ReturnType<SportMonksClient["getRateLimitStatus"]>;
type FixtureFetchParams = {
  startDate?: string;
  endDate?: string;
  leagueIds?: number[];
  includes?: string[];
  page?: number;
  perPage?: number;
};
type ScheduleRound = {
  id: number;
  sport_id?: number;
  league_id?: number | null;
  season_id?: number | null;
  stage_id?: number | null;
  name?: string;
  finished?: boolean;
  is_current?: boolean;
  starting_at?: string;
  ending_at?: string;
  games_in_current_week?: boolean;
  fixtures?: SportMonksFixture[];
};
type ScheduleStage = {
  id: number;
  sport_id?: number;
  league_id?: number | null;
  season_id?: number | null;
  type_id?: number;
  name?: string;
  sort_order?: number;
  finished?: boolean;
  is_current?: boolean;
  starting_at?: string;
  ending_at?: string;
  games_in_current_week?: boolean;
  rounds?: ScheduleRound[];
};

export class SportMonksService {
  private client: SportMonksClient;
  private cache = new Map<string, { data: unknown; expires: number }>();
  private readonly DEFAULT_CACHE_TTL = 60000; // 1 minute for live data
  private readonly STATIC_CACHE_TTL = 300000; // 5 minutes for static data

  constructor(config: SportMonksConfig) {
    this.client = new SportMonksClient(config);
  }

  async getAllFixtures(
    matchweek: string,
    leagueIds?: number[]
  ): Promise<FixtureInsert[]> {
    try {
      const response = await this.client.getFixtures({
        leagueIds,
        includes: ["participants", "scores", "state", "round", "events"],
        perPage: 50,
      });

      const filtered = response.data.filter((f) => {
        const name = f.round?.name ?? "";
        return name === matchweek || name.includes(matchweek);
      });

      const fixtures = SportMonksTransformer.transformFixtures(filtered);

      return fixtures.filter((fx) => {
        const v = SportMonksTransformer.validateFixture(fx);
        if (!v.isValid) console.warn("Invalid fixture data:", v.errors);
        return v.isValid;
      });
    } catch (err) {
      throw new SportMonksError(
        `Failed to fetch fixtures for matchweek ${matchweek}: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
  }

  async getFixturesByDateRange(
    startDate: string,
    endDate: string
  ): Promise<FixtureInsert[]> {
    try {
      const response = await this.client.getFixtures({
        startDate,
        endDate,
        includes: ["participants", "scores", "state", "round", "events"],
        perPage: 50,
      });

      const transformedFixtures = SportMonksTransformer.transformFixtures(
        response.data
      );

      return transformedFixtures;
    } catch (error) {
      console.error("Error fetching fixtures by date range:", error);
      throw new SportMonksError(
        `Failed to fetch fixtures: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async getFixturesByDate(date: string): Promise<FixtureInsert[]> {
    return this.getFixturesByDateRange(date, date);
  }

  async getLeagueWithCurrentSeason(leagueId: number): Promise<{
    league: SportMonksLeague;
    currentSeason: SportMonksSeason | null;
  }> {
    try {
      const response = await this.client.getLeagueById(leagueId, [
        "currentSeason",
      ]);
      const league = response.data;
      const currentSeason = league.currentseason ?? null;

      return { league, currentSeason };
    } catch (error) {
      console.error(`Error fetching league ${leagueId} current season:`, error);
      throw new SportMonksError(
        `Failed to fetch league current season: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async getScheduledFixtures(days: number = 30): Promise<FixtureInsert[]> {
    try {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(startDate.getDate() + days);

      const response = await this.client.getFixtures({
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        includes: ["participants", "scores", "state", "round", "events"],
      });

      const scheduledFixtures = response.data.filter((fixture) => {
        const status = SportMonksTransformer.mapFixtureStatus(
          fixture.state?.developer_name
        );
        return status === "scheduled";
      });

      return SportMonksTransformer.transformFixtures(scheduledFixtures);
    } catch (error) {
      console.error("Error fetching scheduled fixtures:", error);
      throw new SportMonksError(
        `Failed to fetch scheduled fixtures: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async getFinishedFixtures(
    days: number = 7,
    leagueIds?: number[]
  ): Promise<FixtureInsert[]> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - days);

      const response = await this.client.getFixtures({
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        includes: ["participants", "scores", "state", "round", "events"],
        leagueIds,
      });

      const finishedFixtures = response.data.filter((fixture) => {
        const status = SportMonksTransformer.mapFixtureStatus(
          fixture.state?.developer_name
        );
        return status === "finished";
      });

      return SportMonksTransformer.transformFixtures(finishedFixtures);
    } catch (error) {
      console.error("Error fetching finished fixtures:", error);
      throw new SportMonksError(
        `Failed to fetch finished fixtures: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async getLiveMatches(): Promise<FixtureInsert[]> {
    try {
      const response = await this.client.getLiveFixtures({
        includes: ["participants", "scores", "state", "round", "events"],
      });

      const transformedFixtures = SportMonksTransformer.transformFixtures(
        response.data
      );

      return transformedFixtures;
    } catch (error) {
      console.error("Error fetching live matches:", error);
      throw new SportMonksError(
        `Failed to fetch live matches: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async getLatestUpdatedFixtures(): Promise<FixtureInsert[]> {
    try {
      // Use the livescores/latest endpoint for fixtures updated in last 10 seconds
      const response = await this.client.getLatestLivescores([
        "participants",
        "scores",
        "state",
        "round",
        "events",
      ]);

      return SportMonksTransformer.transformFixtures(response.data);
    } catch (error) {
      console.error("Error fetching latest updated fixtures:", error);
      throw new SportMonksError(
        `Failed to fetch latest fixtures: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get fixtures by league ID
   */
  async getFixturesByLeague(
    leagueId: string,
    seasonId?: string
  ): Promise<FixtureInsert[]> {
    try {
      const numericLeagueId = parseInt(leagueId);
      let response: SportMonksApiResponse<SportMonksFixture[]>;

      if (seasonId) {
        const numericSeasonId = parseInt(seasonId);
        const fixtures = await this.getFixturesFromSeasonSchedule(
          numericLeagueId,
          numericSeasonId
        );

        return SportMonksTransformer.transformFixtures(
          fixtures.filter(
            (fixture) =>
              fixture.league_id === numericLeagueId &&
              fixture.season_id === numericSeasonId
          )
        );
      } else {
        // Get current season fixtures for the league
        response = await this.client.getFixtures({
          leagueIds: [numericLeagueId],
          includes: ["participants", "scores", "state", "round", "events"],
          perPage: 50,
        });
      }

      const transformedFixtures = SportMonksTransformer.transformFixtures(response.data);

      return transformedFixtures;
    } catch (error) {
      console.error(`Error fetching fixtures for league ${leagueId}:`, error);
      throw new SportMonksError(
        `Failed to fetch league fixtures: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get fixtures with red cards (for red card predictions)
   */
  async getFixturesWithRedCards(days: number = 7): Promise<FixtureInsert[]> {
    try {
      const fixtures = await this.getFinishedFixtures(days);

      // Filter fixtures that have red cards
      return fixtures.filter((fixture) => fixture.has_red_card === true);
    } catch (error) {
      console.error("Error fetching fixtures with red cards:", error);
      throw new SportMonksError(
        `Failed to fetch fixtures with red cards: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Check whether fixtures have started for a league
   */
  async checkIfFixturesStarted(leagueId: string): Promise<boolean> {
    try {
      const liveFixtures = await this.getLiveMatches();
      return liveFixtures.some(
        (fixture) => String(fixture.sm_league_id) === leagueId
      );
    } catch (error) {
      console.error("Error checking if fixtures started:", error);
      return false;
    }
  }

  /**
   * Get live fixtures with real-time data
   */
  async getLiveFixtures(leagueIds?: number[]): Promise<FixtureInsert[]> {
    try {
      const response = await this.client.getLiveFixtures({
        leagueIds,
        includes: ["participants", "scores", "periods", "state", "round", "events"],
      });

      const transformedFixtures = SportMonksTransformer.transformFixtures(
        response.data
      );

      return transformedFixtures;
    } catch (error) {
      console.error("Error fetching live fixtures:", error);
      throw new SportMonksError(
        `Failed to fetch live fixtures: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  async getUpcomingFixtures(
    days: number = 7,
    leagueIds?: number[]
  ): Promise<FixtureInsert[]> {
    try {
      const end = new Date();
      end.setDate(end.getDate() + days);
      const raw = await this.fetchAllFixtures({
        startDate: new Date().toISOString().split("T")[0],
        endDate: end.toISOString().split("T")[0],
        leagueIds,
        includes: ["participants", "scores", "periods", "state", "round", "events"],
        perPage: 50,
      });

      const mapped = SportMonksTransformer.transformFixtures(raw);
      return mapped
        .filter((f) => f.status === "scheduled" || f.status === "live")
        .sort(
          (a, b) =>
            new Date(`${a.match_date}T${a.match_time}`).getTime() -
            new Date(`${b.match_date}T${b.match_time}`).getTime()
        );
    } catch (err) {
      throw new SportMonksError(
        `Failed to fetch upcoming fixtures: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get fixture details by ID with events
   */
  async getFixtureById(
    fixtureId: number,
    includeEvents: boolean = false
  ): Promise<{
    fixture: FixtureInsert;
    events?: MatchEventInsert[];
  }> {
    try {
      const includes = ["participants", "scores", "periods", "state", "round"];
      if (includeEvents) includes.push("events");

      const fixtureResponse = await this.client.getFixtureById(
        fixtureId,
        includes
      );

      const fixture = SportMonksTransformer.transformFixture(
        fixtureResponse.data
      );

      let events: MatchEventInsert[] | undefined;
      if (includeEvents && fixtureResponse.data.participants) {
        events = SportMonksTransformer.transformMatchEvents(
          fixtureResponse.data.events ?? [],
          fixtureResponse.data.participants
        );
      }

      return { fixture, events };
    } catch (error) {
      console.error("Error fetching fixture by ID:", fixtureId, error);
      throw new SportMonksError(
        `Failed to fetch fixture ${fixtureId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get fixtures by team with optional date range
   */
  async getFixturesByTeam(
    teamId: number,
    options: {
      startDate?: string;
      endDate?: string;
      includeEvents?: boolean;
    } = {}
  ): Promise<FixtureInsert[]> {
    try {
      const response = await this.client.getFixturesByTeam(teamId, {
        startDate: options.startDate,
        endDate: options.endDate,
        includes: ["participants", "scores", "state", "round", "events"],
      });

      return SportMonksTransformer.transformFixtures(response.data);
    } catch (error) {
      console.error("Error fetching fixtures by team:", teamId, error);
      throw new SportMonksError(
        `Failed to fetch fixtures for team ${teamId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get fixtures grouped by matchweek/round
   */
  async getFixturesGroupedByMatchweek(
    leagueId?: number
  ): Promise<Record<string, FixtureInsert[]>> {
    try {
      const response = await this.client.getFixtures({
        leagueIds: leagueId ? [leagueId] : undefined,
        includes: ["participants", "scores", "state", "round", "events"],
        perPage: 50,
      });

      const groupedFixtures = SportMonksTransformer.groupFixturesByMatchweek(
        response.data
      );

      // Transform each group
      const result: Record<string, FixtureInsert[]> = {};
      for (const [matchweek, fixtures] of Object.entries(groupedFixtures)) {
        result[matchweek] = SportMonksTransformer.transformFixtures(fixtures);
      }

      return result;
    } catch (error) {
      console.error("Error fetching fixtures grouped by matchweek:", error);
      throw new SportMonksError(
        `Failed to fetch grouped fixtures: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Health check for the service
   */
  async healthCheck(): Promise<{
    isHealthy: boolean;
    rateLimitStatus: RateLimitStatus;
  }> {
    try {
      const isHealthy = await this.client.healthCheck();
      const rateLimitStatus = this.client.getRateLimitStatus();

      return { isHealthy, rateLimitStatus };
    } catch (error) {
      console.error("SportMonks service health check failed:", error);
      return {
        isHealthy: false,
        rateLimitStatus: this.client.getRateLimitStatus(),
      };
    }
  }

  async getTodayLiveFixturesWithFallback(
    leagueIds?: number[]
  ): Promise<FixtureInsert[]> {
    const includes = [
      "participants",
      "scores",
      "periods",
      "state",
      "round",
      "events",
    ];

    try {
      const liveRes = await this.client.getInplayLivescores(
        includes,
        leagueIds
      );
      const liveRaw = this.responseDataArray<SportMonksFixture>(liveRes);

      if (liveRaw.length > 0) {
        const live = SportMonksTransformer.transformFixtures(liveRaw).filter(
          (f) => f.status === "live"
        );
        if (live.length > 0) return live;
      }
    } catch (e) {
      console.warn("[TodayLive] livescores/inplay failed, using fallback:", e);
    }

    const today = new Date().toISOString().split("T")[0];
    try {
      const res = await this.client.getFixtures({
        startDate: today,
        endDate: today,
        leagueIds,
        includes,
        perPage: 50,
      });

      const raw = this.responseDataArray<SportMonksFixture>(res);

      const mapped = SportMonksTransformer.transformFixtures(raw);
      return mapped.filter((f) => f.status === "live");
    } catch (err) {
      throw new SportMonksError(
        `Failed to fetch today's fixtures (fallback): ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
  }

  async getTodaysFixtures(leagueIds?: number[]): Promise<FixtureInsert[]> {
    const today = new Date().toISOString().split("T")[0];
    try {
      const res = await this.client.getFixtures({
        startDate: today,
        endDate: today,
        leagueIds,
        includes: ["participants", "scores", "state", "round", "events"],
        perPage: 50,
      });

      const raw = this.responseDataArray<SportMonksFixture>(res);

      return SportMonksTransformer.transformFixtures(raw);
    } catch (e) {
      throw new SportMonksError(
        `Failed to fetch today's fixtures: ${
          e instanceof Error ? e.message : "Unknown error"
        }`
      );
    }
  }

  private async fetchAllFixtures(
    params: FixtureFetchParams
  ): Promise<SportMonksFixture[]> {
    const perPage = Math.min(params.perPage ?? 50, 50);
    let page = 1;
    const all: SportMonksFixture[] = [];

    for (;;) {
      const res = await this.client.getFixtures({ ...params, perPage, page });
      all.push(...res.data);
      if (!res.data.length || res.data.length < perPage) break;
      page += 1;
    }
    return all;
  }

  private async fetchAllFixturesByLeagueSeason(
    leagueId: number,
    seasonId: number,
    includes: string[]
  ): Promise<SportMonksFixture[]> {
    const perPage = 50;
    let page = 1;
    const all: SportMonksFixture[] = [];

    for (;;) {
      const res = await this.client.getFixturesByLeagueSeason(
        leagueId,
        seasonId,
        includes,
        page,
        perPage
      );
      all.push(...res.data);
      if (!res.pagination?.has_more && res.data.length < perPage) break;
      page += 1;
    }

    return all;
  }

  private async getFixturesFromSeasonSchedule(
    leagueId: number,
    seasonId: number
  ): Promise<SportMonksFixture[]> {
    const response = await this.client.getScheduleBySeason(seasonId);
    const stages = Array.isArray(response.data)
      ? (response.data as ScheduleStage[])
      : [];
    const fixtures: SportMonksFixture[] = [];

    for (const stage of stages) {
      for (const round of stage.rounds ?? []) {
        const roundPayload = {
          id: round.id,
          sport_id: round.sport_id,
          league_id: round.league_id ?? leagueId,
          season_id: round.season_id ?? seasonId,
          stage_id: round.stage_id ?? stage.id,
          name: round.name,
          finished: round.finished,
          is_current: round.is_current,
          starting_at: round.starting_at,
          ending_at: round.ending_at,
          games_in_current_week: round.games_in_current_week,
        };

        const stagePayload = {
          id: stage.id,
          sport_id: stage.sport_id,
          league_id: stage.league_id ?? leagueId,
          season_id: stage.season_id ?? seasonId,
          type_id: stage.type_id,
          name: stage.name,
          sort_order: stage.sort_order,
          finished: stage.finished,
          is_current: stage.is_current,
          starting_at: stage.starting_at,
          ending_at: stage.ending_at,
          games_in_current_week: stage.games_in_current_week,
        };

        for (const fixture of round.fixtures ?? []) {
          fixtures.push({
            ...fixture,
            league_id: fixture.league_id ?? leagueId,
            season_id: fixture.season_id ?? seasonId,
            round_id: fixture.round_id ?? round.id,
            round: fixture.round ?? roundPayload,
            stage: fixture.stage ?? stagePayload,
          } as SportMonksFixture);
        }
      }
    }

    return fixtures;
  }

  clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  private getFromCache<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data as T;
    }
    this.cache.delete(key);
    return null;
  }

  private setCache<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      expires: Date.now() + ttl,
    });
  }

  getCacheStats(): {
    size: number;
    keys: string[];
  } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  private responseDataArray<T>(response: SportMonksApiResponse<T[]>): T[] {
    if (Array.isArray(response.data)) return response.data;

    const nested = response.data as { data?: unknown };
    return Array.isArray(nested.data) ? (nested.data as T[]) : [];
  }
}

export default SportMonksService;
