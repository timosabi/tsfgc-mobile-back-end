import {
  BaseRepository,
  type RepositoryClient,
  type TableRow,
} from "./base.js";

export type CompetitionRef = Pick<
  TableRow<"football_competitions">,
  "id" | "provider_league_id" | "name"
>;
export type CompetitionWithSeasons = TableRow<"football_competitions"> & {
  seasons?: TableRow<"football_seasons">[];
};

export default class FootballCompetitionsRepository extends BaseRepository<"football_competitions"> {
  constructor(client: RepositoryClient) {
    super(client, "football_competitions");
  }

  async upsertCompetition(payload: {
    providerLeagueId: number;
    name: string;
    countryName?: string | null;
    logoUrl?: string | null;
    currentProviderSeasonId?: number | null;
  }): Promise<CompetitionRef> {
    const row = {
      provider: "sportmonks",
      provider_league_id: payload.providerLeagueId,
      name: payload.name,
      country_name: payload.countryName ?? null,
      logo_url: payload.logoUrl ?? null,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>;
    if (payload.currentProviderSeasonId) {
      row.current_provider_season_id = payload.currentProviderSeasonId;
    }

    const { data, error } = await this.table()
      .upsert(
        row as never,
        { onConflict: "provider,provider_league_id", ignoreDuplicates: false }
      )
      .select("id, provider_league_id, name")
      .single();

    this.throwOnError(error, "football_competitions upsertCompetition failed");
    return data as CompetitionRef;
  }

  async listWithSeasons(): Promise<CompetitionWithSeasons[]> {
    const { data, error } = await this.table()
      .select(
        `
        *,
        seasons:football_seasons(*)
      `
      )
      .order("name", { ascending: true });

    this.throwOnError(error, "football_competitions listWithSeasons failed");
    return (data ?? []) as unknown as CompetitionWithSeasons[];
  }

  async findByProviderLeagueId(
    providerLeagueId: number
  ): Promise<CompetitionWithSeasons | null> {
    const { data, error } = await this.table()
      .select(
        `
        *,
        seasons:football_seasons(*)
      `
      )
      .eq("provider", "sportmonks")
      .eq("provider_league_id", providerLeagueId)
      .maybeSingle();

    this.throwOnError(error, "football_competitions findByProviderLeagueId failed");
    return (data ?? null) as unknown as CompetitionWithSeasons | null;
  }
}
