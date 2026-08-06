import { BaseRepository, type RepositoryClient, type TableRow } from "./base.js";

export default class FootballSeasonsRepository extends BaseRepository<"football_seasons"> {
  constructor(client: RepositoryClient) {
    super(client, "football_seasons");
  }

  async upsertSeason(payload: {
    competitionId: string;
    providerSeasonId: number;
    name?: string | null;
  }): Promise<Pick<TableRow<"football_seasons">, "id">> {
    const { data, error } = await this.table()
      .upsert(
        {
          competition_id: payload.competitionId,
          provider: "sportmonks",
          provider_season_id: payload.providerSeasonId,
          name: payload.name ?? null,
          is_current: true,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "provider,provider_season_id", ignoreDuplicates: false }
      )
      .select("id")
      .single();

    this.throwOnError(error, "football_seasons upsertSeason failed");
    return data as Pick<TableRow<"football_seasons">, "id">;
  }
}
