import {
  SportMonksConfig,
  SportMonksApiResponse,
  SportMonksFixture,
  SportMonksError,
  SportMonksRateLimitError,
  SportMonksEvent,
  SportMonksLeague,
} from "../../services/dto/types.js";
import SportMonksTransformer from "./transformer.js";

type RequestParams = Record<string, string | number | boolean | undefined | null>;

export class SportMonksClient {
  private static readonly MAX_PER_PAGE = 50;
  private readonly config: Required<SportMonksConfig>;
  private requestQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;
  private rateLimitReset = 0;
  private requestCount = 0;
  private windowStart = Date.now();

  constructor(config: SportMonksConfig) {
    this.config = {
      apiUrl: config.apiUrl,
      token: config.token,
      timeout: config.timeout ?? 30000,
      retries: config.retries ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      rateLimit: config.rateLimit ?? { requests: 3000, window: 3600 },
    };
  }

  private async makeRequest<T>(
    endpoint: string,
    params: RequestParams = {}
  ): Promise<SportMonksApiResponse<T>> {
    return new Promise((resolve, reject) => {
      const requestFn = async () => {
        try {
          await this.checkRateLimit();
          const result = await this.executeRequest<T>(endpoint, params);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      this.requestQueue.push(requestFn);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        try {
          await request();
        } catch (error) {
          console.error("Request failed:", error);
        }

        await this.delay(100);
      }
    }

    this.isProcessingQueue = false;
  }

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const windowElapsed = now - this.windowStart;

    if (windowElapsed >= this.config.rateLimit.window * 1000) {
      this.requestCount = 0;
      this.windowStart = now;
    }

    if (this.requestCount >= this.config.rateLimit.requests) {
      const waitTime = this.config.rateLimit.window * 1000 - windowElapsed;
      throw new SportMonksRateLimitError(
        `Rate limit exceeded. Reset in ${Math.ceil(waitTime / 1000)} seconds`,
        now + waitTime
      );
    }

    if (this.rateLimitReset > now) {
      const waitTime = this.rateLimitReset - now;
      await this.delay(waitTime);
    }
  }

  private async executeRequest<T>(
    endpoint: string,
    params: RequestParams
  ): Promise<SportMonksApiResponse<T>> {
    const url = new URL(`${this.config.apiUrl}${endpoint}`);

    url.searchParams.set("api_token", this.config.token);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    let lastError: Error;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        this.requestCount++;

        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeout
        );

        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        this.updateRateLimitFromHeaders(response.headers);

        if (!response.ok) {
          const errorText = await response.text();
          throw new SportMonksError(
            `API request failed: ${response.status} ${response.statusText}`,
            response.status,
            errorText
          );
        }

        const data = await response.json();
        return data as SportMonksApiResponse<T>;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (
          error instanceof SportMonksError &&
          error.statusCode &&
          error.statusCode < 500
        ) {
          throw error;
        }

        if (error instanceof SportMonksRateLimitError) {
          throw error;
        }

        if (attempt < this.config.retries) {
          await this.delay(this.config.retryDelay * Math.pow(2, attempt));
        }
      }
    }

    throw lastError!;
  }

  private updateRateLimitFromHeaders(headers: Headers): void {
    const resetHeader = headers.get("x-ratelimit-resets-in-seconds");
    if (resetHeader) {
      const resetSeconds = parseInt(resetHeader, 10);
      this.rateLimitReset = Date.now() + resetSeconds * 1000;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private perPage(value?: number): number | undefined {
    if (!value) return undefined;
    return Math.min(value, SportMonksClient.MAX_PER_PAGE);
  }

  private fixtureLeagueFilter(leagueIds?: number[]): string | undefined {
    if (!leagueIds?.length) return undefined;
    return `fixtureLeagues:${leagueIds.join(",")}`;
  }

  async getFixtures(options: {
    startDate?: string;
    endDate?: string;
    leagueIds?: number[];
    includes?: string[];
    page?: number;
    perPage?: number;
  }) {
    const params: RequestParams = {};
    const leagueFilter = this.fixtureLeagueFilter(options.leagueIds);
    if (leagueFilter) params.filters = leagueFilter;
    if (options.includes?.length) params.include = options.includes.join(";");
    if (options.page) params.page = options.page;
    if (options.perPage) params.per_page = this.perPage(options.perPage);

    if (options.startDate && options.endDate) {
      return this.getFixturesBetween(
        options.startDate,
        options.endDate,
        options.includes ?? [],
        options.perPage ?? SportMonksClient.MAX_PER_PAGE,
        options.page,
        options.leagueIds
      );
    }

    return this.makeRequest<SportMonksFixture[]>("/fixtures", params);
  }

  async getLiveFixtures(
    options: {
      leagueIds?: number[];
      includes?: string[];
    } = {}
  ): Promise<SportMonksApiResponse<SportMonksFixture[]>> {
    const params: RequestParams = {};

    const leagueFilter = this.fixtureLeagueFilter(options.leagueIds);
    if (leagueFilter) params.filters = leagueFilter;
    if (options.includes?.length) params.include = options.includes.join(";");

    return this.makeRequest<SportMonksFixture[]>("/livescores/inplay", params);
  }

  async getFixtureById(
    fixtureId: number,
    includes: string[] = []
  ): Promise<SportMonksApiResponse<SportMonksFixture>> {
    const params: RequestParams = {};
    if (includes.length) params.include = includes.join(";");

    return this.makeRequest<SportMonksFixture>(
      `/fixtures/${fixtureId}`,
      params
    );
  }

  getFixturesByRound(
    roundId: number,
    include: string[] = [],
    perPage = 100,
    page?: number
  ) {
    const p: RequestParams = { per_page: this.perPage(perPage) };
    if (page) p.page = page;
    if (include.length) p.include = include.join(";");
    return this.request<SportMonksFixture[]>(`/rounds/${roundId}/fixtures`, p);
  }

  async getFixtureEvents(
    fixtureId: number
  ): Promise<SportMonksApiResponse<SportMonksEvent[]>> {
    return this.makeRequest<SportMonksEvent[]>(`/fixtures/${fixtureId}/events`);
  }

  async getFixturesByTeam(
    teamId: number,
    options: {
      startDate?: string;
      endDate?: string;
      includes?: string[];
    } = {}
  ): Promise<SportMonksApiResponse<SportMonksFixture[]>> {
    const params: RequestParams = {};

    if (options.startDate) params.starting_at = `>=${options.startDate}`;
    if (options.endDate) params.starting_at = `<=${options.endDate}`;
    if (options.includes?.length) params.include = options.includes.join(";");

    return this.makeRequest<SportMonksFixture[]>(
      `/teams/${teamId}/fixtures`,
      params
    );
  }

  async getFixturesByLeagueSeason(
    leagueId: number,
    _seasonId: number,
    includes: string[] = [],
    page?: number,
    perPage = SportMonksClient.MAX_PER_PAGE
  ): Promise<SportMonksApiResponse<SportMonksFixture[]>> {
    const params: RequestParams = {};
    if (includes.length) params.include = includes.join(";");
    params.per_page = this.perPage(perPage);
    if (page) params.page = page;
    params.filters = this.fixtureLeagueFilter([leagueId]);

    return this.makeRequest<SportMonksFixture[]>("/fixtures", params);
  }

  async getScheduleBySeason(seasonId: number) {
    return this.makeRequest<unknown[]>(`/schedules/seasons/${seasonId}`);
  }

  async getLeagueById(
    leagueId: number,
    includes: string[] = []
  ): Promise<SportMonksApiResponse<SportMonksLeague>> {
    const params: RequestParams = {};
    if (includes.length) params.include = includes.join(";");

    return this.makeRequest(`/leagues/${leagueId}`, params);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest("/test");
      return true;
    } catch (error) {
      console.error("SportMonks API health check failed:", error);
      return false;
    }
  }

  async request<T>(
    endpoint: string,
    params: RequestParams = {}
  ): Promise<SportMonksApiResponse<T>> {
    return this.makeRequest<T>(endpoint, params);
  }

  async getFixturesByDate(
    date: string,
    includes: string[] = []
  ): Promise<SportMonksApiResponse<SportMonksFixture[]>> {
    const params: RequestParams = {};
    if (includes.length) params.include = includes.join(";");

    return this.makeRequest<SportMonksFixture[]>(
      `/fixtures/date/${date}`,
      params
    );
  }

  async getUpcomingFixtures(days = 7, leagueIds?: number[]) {
    try {
      const end = new Date();
      end.setDate(end.getDate() + days);

      const { data } = await this.getFixturesBetween(
        new Date().toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
        ["participants", "scores", "periods", "state", "round", "events"],
        SportMonksClient.MAX_PER_PAGE,
        undefined,
        leagueIds
      );

      const transformed = SportMonksTransformer.transformFixtures(data);

      return transformed.sort(
        (a, b) =>
          new Date(`${a.match_date}T${a.match_time}`).getTime() -
          new Date(`${b.match_date}T${b.match_time}`).getTime()
      );
    } catch (e) {
      throw new SportMonksError(
        `Failed to fetch upcoming fixtures: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }

  async searchFixtures(
    query: string,
    includes: string[] = []
  ): Promise<SportMonksApiResponse<SportMonksFixture[]>> {
    return this.makeRequest<SportMonksFixture[]>(
      `/fixtures/search/${encodeURIComponent(query)}`,
      includes.length ? { include: includes.join(";") } : {}
    );
  }

  async getHeadToHeadFixtures(
    team1Id: number,
    team2Id: number,
    includes: string[] = []
  ): Promise<SportMonksApiResponse<SportMonksFixture[]>> {
    return this.makeRequest<SportMonksFixture[]>(
      `/fixtures/head-to-head/${team1Id}/${team2Id}`,
      includes.length ? { include: includes.join(";") } : {}
    );
  }

  async getAllLivescores(
    includes: string[] = []
  ): Promise<SportMonksApiResponse<SportMonksFixture[]>> {
    const params: RequestParams = {};
    if (includes.length) params.include = includes.join(";");
    return this.makeRequest<SportMonksFixture[]>("/livescores", params);
  }

  async getInplayLivescores(
    includes: string[] = [],
    leagueIds?: number[]
  ): Promise<SportMonksApiResponse<SportMonksFixture[]>> {
    const params: RequestParams = {};
    if (includes.length) params.include = includes.join(";");
    const leagueFilter = this.fixtureLeagueFilter(leagueIds);
    if (leagueFilter) params.filters = leagueFilter;
    return this.makeRequest<SportMonksFixture[]>("/livescores/inplay", params);
  }

  async getLatestLivescores(
    includes: string[] = []
  ): Promise<SportMonksApiResponse<SportMonksFixture[]>> {
    const params: RequestParams = {};
    if (includes.length) params.include = includes.join(";");
    return this.makeRequest<SportMonksFixture[]>("/livescores/latest", params);
  }

  async getFixturesByIds(
    fixtureIds: number[],
    includes: string[] = []
  ): Promise<SportMonksApiResponse<SportMonksFixture[]>> {
    return this.makeRequest<SportMonksFixture[]>(
      `/fixtures/multi/${fixtureIds.join(",")}`,
      includes.length ? { include: includes.join(";") } : {}
    );
  }

  getRateLimitStatus(): {
    requestsRemaining: number;
    windowResetAt: Date;
    isLimited: boolean;
  } {
    const now = Date.now();
    const windowElapsed = now - this.windowStart;
    const requestsRemaining = Math.max(
      0,
      this.config.rateLimit.requests - this.requestCount
    );
    const windowResetAt = new Date(
      this.windowStart + this.config.rateLimit.window * 1000
    );

    return {
      requestsRemaining,
      windowResetAt,
      isLimited: requestsRemaining === 0 || this.rateLimitReset > now,
    };
  }
  getFixturesBetween(
    startISO: string,
    endISO: string,
    include: string[] = [],
    perPage = SportMonksClient.MAX_PER_PAGE,
    page?: number,
    leagueIds?: number[]
  ) {
    const p: RequestParams = { per_page: this.perPage(perPage) };
    if (page) p.page = page;
    if (include.length) p.include = include.join(";");
    const leagueFilter = this.fixtureLeagueFilter(leagueIds);
    if (leagueFilter) p.filters = leagueFilter;
    return this.request<SportMonksFixture[]>(
      `/fixtures/between/${startISO}/${endISO}`,
      p
    );
  }

  getLivescoresInplay(include: string[] = []) {
    const p: RequestParams = {};
    if (include.length) p.include = include.join(";");
    return this.request<SportMonksFixture[]>(`/livescores/inplay`, p);
  }
}

export default SportMonksClient;
