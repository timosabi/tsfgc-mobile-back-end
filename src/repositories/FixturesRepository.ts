import { BaseRepository, type RepositoryClient, type TableRow } from "./base.js";
import type { TableInsert, TableUpdate } from "./base.js";

export type MatchweekFixtureRow = Pick<
  TableRow<"fixtures">,
  | "id"
  | "home_team"
  | "away_team"
  | "home_score"
  | "away_score"
  | "has_red_card"
  | "status"
  | "match_date"
  | "match_time"
  | "starting_at"
  | "matchweek"
>;

export type FixtureScoreRow = Pick<
  TableRow<"fixtures">,
  "id" | "home_score" | "away_score" | "has_red_card"
>;

export type OverviewFixtureRow = Pick<
  TableRow<"fixtures">,
  | "id"
  | "sm_fixture_id"
  | "home_team"
  | "away_team"
  | "home_score"
  | "away_score"
  | "live_home_score"
  | "live_away_score"
  | "has_red_card"
  | "current_minute"
  | "status"
  | "match_date"
  | "match_time"
  | "starting_at"
  | "matchweek"
>;
export type LivePatch = {
  sm_fixture_id: number;
  live_home_score: number | null;
  live_away_score: number | null;
  status: string | null;
  current_minute: number | null;
};
export type LiveFeedFixtureRow = Pick<
  TableRow<"fixtures">,
  | "id"
  | "sm_fixture_id"
  | "sm_league_id"
  | "sm_season_id"
  | "home_team"
  | "away_team"
  | "home_score"
  | "away_score"
  | "live_home_score"
  | "live_away_score"
  | "has_red_card"
  | "matchweek"
>;

type SubscriptionFixtureParams = {
  providerLeagueId: number;
  providerSeasonId?: number | null;
  matchweek: string;
};

export default class FixturesRepository extends BaseRepository<"fixtures"> {
  constructor(client: RepositoryClient) {
    super(client, "fixtures");
  }

  async listMatchweekFixtures(
    params: SubscriptionFixtureParams
  ): Promise<MatchweekFixtureRow[]> {
    let query = this.table()
      .select(
        "id, home_team, away_team, home_score, away_score, has_red_card, status, match_date, match_time, starting_at, matchweek"
      )
      .eq("sm_league_id", params.providerLeagueId)
      .eq("matchweek", params.matchweek)
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true });

    if (params.providerSeasonId) {
      query = query.eq("sm_season_id", params.providerSeasonId);
    }

    const { data, error } = await query;
    this.throwOnError(error, "fixtures listMatchweekFixtures failed");
    return (data ?? []) as MatchweekFixtureRow[];
  }

  async listByMatchweekWithStatuses(
    matchweek: string,
    statuses: string[]
  ): Promise<TableRow<"fixtures">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("matchweek", matchweek)
      .in("status", statuses)
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true });

    this.throwOnError(error, "fixtures listByMatchweekWithStatuses failed");
    return (data ?? []) as TableRow<"fixtures">[];
  }

  async listAllOrdered(): Promise<TableRow<"fixtures">[]> {
    const { data, error } = await this.table()
      .select("*")
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true });

    this.throwOnError(error, "fixtures listAllOrdered failed");
    return (data ?? []) as TableRow<"fixtures">[];
  }

  async listForSubscription(params: {
    providerLeagueId: number;
    providerSeasonId?: number | null;
    matchweek?: string;
  }): Promise<TableRow<"fixtures">[]> {
    let query = this.table()
      .select("*")
      .eq("sm_league_id", params.providerLeagueId)
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true });

    if (params.providerSeasonId) query = query.eq("sm_season_id", params.providerSeasonId);
    if (params.matchweek) query = query.eq("matchweek", params.matchweek);

    const { data, error } = await query;
    this.throwOnError(error, "fixtures listForSubscription failed");
    return (data ?? []) as TableRow<"fixtures">[];
  }

  async findFixtureForSubscription(params: {
    fixtureId: number;
    providerLeagueId: number;
    providerSeasonId?: number | null;
  }): Promise<Pick<TableRow<"fixtures">, "id" | "sm_league_id" | "sm_season_id" | "status" | "starting_at" | "match_date" | "match_time"> | null> {
    let query = this.table()
      .select("id, sm_league_id, sm_season_id, status, starting_at, match_date, match_time")
      .eq("id", params.fixtureId)
      .eq("sm_league_id", params.providerLeagueId);

    if (params.providerSeasonId) query = query.eq("sm_season_id", params.providerSeasonId);

    const { data, error } = await query.maybeSingle();
    this.throwOnError(error, "fixtures findFixtureForSubscription failed");
    return (data ?? null) as Pick<TableRow<"fixtures">, "id" | "sm_league_id" | "sm_season_id" | "status" | "starting_at" | "match_date" | "match_time"> | null;
  }

  async listByStatus(status: string): Promise<TableRow<"fixtures">[]> {
    const { data, error } = await this.table().select("*").eq("status", status);
    this.throwOnError(error, "fixtures listByStatus failed");
    return (data ?? []) as TableRow<"fixtures">[];
  }

  async listScheduledFromDate(date: string): Promise<TableRow<"fixtures">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("status", "scheduled")
      .gte("match_date", date);

    this.throwOnError(error, "fixtures listScheduledFromDate failed");
    return (data ?? []) as TableRow<"fixtures">[];
  }

  async listLiveMatchweeks(limit?: number | null): Promise<Array<Pick<TableRow<"fixtures">, "matchweek">>> {
    let query = this.table().select("matchweek").eq("status", "live");
    if (typeof limit === "number") query = query.limit(limit);

    const { data, error } = await query;
    this.throwOnError(error, "fixtures listLiveMatchweeks failed");
    return (data ?? []) as Array<Pick<TableRow<"fixtures">, "matchweek">>;
  }

  async listLiveMatchweeksOrdered(): Promise<Array<Pick<TableRow<"fixtures">, "matchweek">>> {
    const { data, error } = await this.table()
      .select("matchweek")
      .eq("status", "live")
      .order("match_time", { ascending: true });

    this.throwOnError(error, "fixtures listLiveMatchweeksOrdered failed");
    return (data ?? []) as Array<Pick<TableRow<"fixtures">, "matchweek">>;
  }

  async listUpcomingMatchweeks(date: string): Promise<Array<Pick<TableRow<"fixtures">, "matchweek">>> {
    const { data, error } = await this.table()
      .select("matchweek")
      .eq("status", "scheduled")
      .gte("match_date", date)
      .order("match_date", { ascending: true });

    this.throwOnError(error, "fixtures listUpcomingMatchweeks failed");
    return (data ?? []) as Array<Pick<TableRow<"fixtures">, "matchweek">>;
  }

  async listNextUpcomingMatchweek(date: string): Promise<Array<Pick<TableRow<"fixtures">, "matchweek">>> {
    const { data, error } = await this.table()
      .select("matchweek")
      .eq("status", "scheduled")
      .gte("match_date", date)
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true })
      .limit(1);

    this.throwOnError(error, "fixtures listNextUpcomingMatchweek failed");
    return (data ?? []) as Array<Pick<TableRow<"fixtures">, "matchweek">>;
  }

  async listUpcomingToday(date: string, time: string): Promise<Array<Pick<TableRow<"fixtures">, "matchweek" | "match_time">>> {
    const { data, error } = await this.table()
      .select("matchweek, match_time")
      .eq("match_date", date)
      .eq("status", "scheduled")
      .gte("match_time", time)
      .order("match_time", { ascending: true });

    this.throwOnError(error, "fixtures listUpcomingToday failed");
    return (data ?? []) as Array<Pick<TableRow<"fixtures">, "matchweek" | "match_time">>;
  }

  async listFinishedIdsAndMatchweeks(): Promise<Array<Pick<TableRow<"fixtures">, "id" | "matchweek">>> {
    const { data, error } = await this.table()
      .select("id, matchweek")
      .eq("status", "finished");

    this.throwOnError(error, "fixtures listFinishedIdsAndMatchweeks failed");
    return (data ?? []) as Array<Pick<TableRow<"fixtures">, "id" | "matchweek">>;
  }

  async listFinishedMatchweeksOrdered(): Promise<Array<Pick<TableRow<"fixtures">, "matchweek">>> {
    const { data, error } = await this.table()
      .select("matchweek")
      .eq("status", "finished")
      .order("match_date", { ascending: false });

    this.throwOnError(error, "fixtures listFinishedMatchweeksOrdered failed");
    return (data ?? []) as Array<Pick<TableRow<"fixtures">, "matchweek">>;
  }

  async listLatestFinishedMatchweek(): Promise<Array<Pick<TableRow<"fixtures">, "matchweek">>> {
    const { data, error } = await this.table()
      .select("matchweek")
      .eq("status", "finished")
      .order("match_date", { ascending: false })
      .order("match_time", { ascending: false })
      .limit(1);

    this.throwOnError(error, "fixtures listLatestFinishedMatchweek failed");
    return (data ?? []) as Array<Pick<TableRow<"fixtures">, "matchweek">>;
  }

  async listIdsByMatchweek(matchweek: string): Promise<Array<Pick<TableRow<"fixtures">, "id">>> {
    const { data, error } = await this.table()
      .select("id")
      .eq("matchweek", matchweek);

    this.throwOnError(error, "fixtures listIdsByMatchweek failed");
    return (data ?? []) as Array<Pick<TableRow<"fixtures">, "id">>;
  }

  async countAvailable(date: string): Promise<number | null> {
    const { count, error } = await this.table()
      .select("*", { count: "exact", head: true })
      .in("status", ["scheduled", "live"])
      .gte("match_date", date);

    this.throwOnError(error, "fixtures countAvailable failed");
    return count ?? null;
  }

  async listGlobalUpcoming(params: {
    date: string;
    time: string;
    limit: number;
  }): Promise<TableRow<"fixtures">[]> {
    const { data, error } = await this.table()
      .select("*")
      .or(`match_date.gt.${params.date},and(match_date.eq.${params.date},match_time.gte.${params.time})`)
      .in("status", ["scheduled", "live"])
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true })
      .limit(params.limit);

    this.throwOnError(error, "fixtures listGlobalUpcoming failed");
    return (data ?? []) as TableRow<"fixtures">[];
  }

  async listWithActualResults(targetWeek: number): Promise<Array<Pick<TableRow<"fixtures">, "id" | "home_team" | "away_team" | "home_score" | "away_score" | "live_home_score" | "status" | "current_minute" | "matchweek">>> {
    const { data, error } = await this.table()
      .select(
        `
      id,
      home_team,
      away_team,
      home_score,
      away_score,
      live_home_score,
      status,
      current_minute,
      matchweek
    `
      )
      .eq("matchweek", `Matchweek ${targetWeek}`);

    this.throwOnError(error, "fixtures listWithActualResults failed");
    return (data ?? []) as Array<Pick<TableRow<"fixtures">, "id" | "home_team" | "away_team" | "home_score" | "away_score" | "live_home_score" | "status" | "current_minute" | "matchweek">>;
  }

  async findLiveScore(fixtureId: number): Promise<Pick<TableRow<"fixtures">, "live_home_score" | "live_away_score">> {
    const { data, error } = await this.table()
      .select("live_home_score, live_away_score")
      .eq("id", fixtureId)
      .single();

    this.throwOnError(error, "fixtures findLiveScore failed");
    return data as Pick<TableRow<"fixtures">, "live_home_score" | "live_away_score">;
  }

  async findFixtureMatchweek(fixtureId: number): Promise<Pick<TableRow<"fixtures">, "matchweek">> {
    const { data, error } = await this.table()
      .select("matchweek")
      .eq("id", fixtureId)
      .single();

    this.throwOnError(error, "fixtures findFixtureMatchweek failed");
    return data as Pick<TableRow<"fixtures">, "matchweek">;
  }

  async listAnyMatchweek(): Promise<Array<Pick<TableRow<"fixtures">, "matchweek">>> {
    const { data, error } = await this.table().select("matchweek").limit(1);
    this.throwOnError(error, "fixtures listAnyMatchweek failed");
    return (data ?? []) as Array<Pick<TableRow<"fixtures">, "matchweek">>;
  }

  async updateFixtureById(
    fixtureId: number,
    data: TableUpdate<"fixtures">
  ): Promise<void> {
    const { error } = await this.table().update(data as never).eq("id", fixtureId);
    this.throwOnError(error, "fixtures updateFixtureById failed");
  }

  async insertFixtures(payload: TableInsert<"fixtures"> | TableInsert<"fixtures">[]): Promise<void> {
    const { error } = await this.table().insert(payload as never);
    this.throwOnError(error, "fixtures insertFixtures failed");
  }

  async upsertBySportMonksFixtureId(
    rows: TableInsert<"fixtures">[],
    options: { batchSize?: number; returnRows?: boolean } = {}
  ): Promise<TableRow<"fixtures">[] | null> {
    const batchSize = options.batchSize ?? (rows.length || 1);
    const returned: TableRow<"fixtures">[] = [];

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const query = this.table().upsert(chunk as never, {
        onConflict: "sm_fixture_id",
        ignoreDuplicates: false,
      });

      if (!options.returnRows) {
        const { error } = await query;
        this.throwOnError(error, "fixtures upsertBySportMonksFixtureId failed");
      } else {
        const { data, error } = await query.select("*");
        this.throwOnError(error, "fixtures upsertBySportMonksFixtureId failed");
        returned.push(...((data ?? []) as TableRow<"fixtures">[]));
      }
    }

    return options.returnRows ? returned : null;
  }

  async patchLiveRows(patches: LivePatch[], batchSize = 100): Promise<void> {
    for (let i = 0; i < patches.length; i += batchSize) {
      const chunk = patches.slice(i, i + batchSize);
      for (const patch of chunk) {
        const update: TableUpdate<"fixtures"> = {
          live_home_score: patch.live_home_score,
          live_away_score: patch.live_away_score,
          current_minute: patch.current_minute,
        };
        if (patch.status !== null) update.status = patch.status;

        const { error } = await this.table()
          .update(update as never)
          .eq("sm_fixture_id", patch.sm_fixture_id);
        this.throwOnError(error, "fixtures patchLiveRows failed");
      }
    }
  }

  async listLiveOrdered(): Promise<TableRow<"fixtures">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("status", "live")
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true });

    this.throwOnError(error, "fixtures listLiveOrdered failed");
    return (data ?? []) as TableRow<"fixtures">[];
  }

  async findIdAndSportMonksFixtureId(
    fixtureId: number
  ): Promise<Pick<TableRow<"fixtures">, "id" | "sm_fixture_id"> | null> {
    const { data, error } = await this.table()
      .select("id, sm_fixture_id")
      .eq("id", fixtureId)
      .maybeSingle();

    this.throwOnError(error, "fixtures findIdAndSportMonksFixtureId failed");
    return (data ?? null) as Pick<TableRow<"fixtures">, "id" | "sm_fixture_id"> | null;
  }

  async findLiveSnapshot(
    fixtureId: number,
    strict = true
  ): Promise<Pick<TableRow<"fixtures">, "live_home_score" | "live_away_score" | "status" | "current_minute"> | null> {
    const query = this.table()
      .select("live_home_score, live_away_score, status, current_minute")
      .eq("id", fixtureId);

    const { data, error } = strict ? await query.single() : await query.maybeSingle();
    this.throwOnError(error, "fixtures findLiveSnapshot failed");
    return (data ?? null) as Pick<TableRow<"fixtures">, "live_home_score" | "live_away_score" | "status" | "current_minute"> | null;
  }

  async listLiveByMatchweek(matchweek: string): Promise<TableRow<"fixtures">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("matchweek", matchweek)
      .eq("status", "live");

    this.throwOnError(error, "fixtures listLiveByMatchweek failed");
    return (data ?? []) as TableRow<"fixtures">[];
  }

  async listByMatchweekOrdered(matchweek: string): Promise<TableRow<"fixtures">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("matchweek", matchweek)
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true });

    this.throwOnError(error, "fixtures listByMatchweekOrdered failed");
    return (data ?? []) as TableRow<"fixtures">[];
  }

  async listByMatchweek(matchweek: string): Promise<TableRow<"fixtures">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("matchweek", matchweek);

    this.throwOnError(error, "fixtures listByMatchweek failed");
    return (data ?? []) as TableRow<"fixtures">[];
  }

  async listTodayLive(date: string, ordered = false): Promise<TableRow<"fixtures">[]> {
    let query = this.table()
      .select("*")
      .eq("match_date", date)
      .eq("status", "live");

    if (ordered) query = query.order("match_time", { ascending: true });

    const { data, error } = await query;
    this.throwOnError(error, "fixtures listTodayLive failed");
    return (data ?? []) as TableRow<"fixtures">[];
  }

  async findLiveFeedFixture(input: {
    fixtureId?: number;
    smFixtureId?: number;
  }): Promise<LiveFeedFixtureRow | null> {
    let query = this.table().select(
      "id, sm_fixture_id, sm_league_id, sm_season_id, home_team, away_team, home_score, away_score, live_home_score, live_away_score, has_red_card, matchweek"
    );

    if (input.fixtureId) query = query.eq("id", input.fixtureId);
    else if (input.smFixtureId) query = query.eq("sm_fixture_id", input.smFixtureId);
    else return null;

    const { data, error } = await query.maybeSingle();
    this.throwOnError(error, "fixtures findLiveFeedFixture failed");
    return (data ?? null) as LiveFeedFixtureRow | null;
  }

  async listFinishedScoreFixtures(
    params: SubscriptionFixtureParams
  ): Promise<FixtureScoreRow[]> {
    let query = this.table()
      .select("id, home_score, away_score, has_red_card")
      .eq("sm_league_id", params.providerLeagueId)
      .eq("matchweek", params.matchweek)
      .eq("status", "finished")
      .not("home_score", "is", null)
      .not("away_score", "is", null);

    if (params.providerSeasonId) {
      query = query.eq("sm_season_id", params.providerSeasonId);
    }

    const { data, error } = await query;
    this.throwOnError(error, "fixtures listFinishedScoreFixtures failed");
    return (data ?? []) as FixtureScoreRow[];
  }

  async listOverviewFixturesForSubscription(params: {
    providerLeagueId: number;
    providerSeasonId?: number | null;
  }): Promise<OverviewFixtureRow[]> {
    let query = this.table()
      .select(
        "id, sm_fixture_id, home_team, away_team, home_score, away_score, live_home_score, live_away_score, has_red_card, current_minute, status, match_date, match_time, starting_at, matchweek"
      )
      .eq("sm_league_id", params.providerLeagueId)
      .not("matchweek", "is", null)
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true })
      .order("home_team", { ascending: true });

    if (params.providerSeasonId) {
      query = query.eq("sm_season_id", params.providerSeasonId);
    }

    const { data, error } = await query;
    this.throwOnError(error, "fixtures listOverviewFixturesForSubscription failed");
    return (data ?? []) as OverviewFixtureRow[];
  }

  async listFinishedMatchweeks(params: {
    providerLeagueId: number;
    providerSeasonId?: number | null;
  }): Promise<string[]> {
    let query = this.table()
      .select("matchweek, status")
      .eq("sm_league_id", params.providerLeagueId)
      .not("matchweek", "is", null);

    if (params.providerSeasonId) {
      query = query.eq("sm_season_id", params.providerSeasonId);
    }

    const { data, error } = await query;
    this.throwOnError(error, "fixtures listFinishedMatchweeks failed");

    // A matchweek only counts once EVERY fixture in it has finished -- not just
    // one. Bonus categories that depend on the whole week's final total (e.g.
    // total_goals_bonus) would otherwise get computed and persisted from a
    // partial, still-changing subset of fixtures.
    const statusesByMatchweek = new Map<string, string[]>();
    for (const fixture of (data ?? []) as Array<
      Pick<TableRow<"fixtures">, "matchweek" | "status">
    >) {
      if (!fixture.matchweek) continue;
      const statuses = statusesByMatchweek.get(fixture.matchweek) ?? [];
      statuses.push(fixture.status ?? "");
      statusesByMatchweek.set(fixture.matchweek, statuses);
    }

    return Array.from(statusesByMatchweek.entries())
      .filter(([, statuses]) => statuses.every((status) => status === "finished"))
      .map(([matchweek]) => matchweek);
  }
}
