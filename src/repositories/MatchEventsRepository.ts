import {
  BaseRepository,
  type RepositoryClient,
  type TableInsert,
  type TableRow,
} from "./base.js";

export default class MatchEventsRepository extends BaseRepository<"match_events"> {
  constructor(client: RepositoryClient) {
    super(client, "match_events");
  }

  async listByFixture(fixtureId: number): Promise<TableRow<"match_events">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("fixture_id", fixtureId)
      .order("minute", { ascending: true });

    this.throwOnError(error, "match_events listByFixture failed");
    return (data ?? []) as TableRow<"match_events">[];
  }

  async listGoalEvents(fixtureId: number): Promise<TableRow<"match_events">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("fixture_id", fixtureId)
      .eq("event_type", "goal");

    this.throwOnError(error, "match_events listGoalEvents failed");
    return (data ?? []) as TableRow<"match_events">[];
  }

  async insertEvent(payload: TableInsert<"match_events">): Promise<unknown> {
    const { data, error } = await this.table().insert(payload as never);
    this.throwOnError(error, "match_events insertEvent failed");
    return data;
  }

  async listRedCardIds(
    fixtureId: number
  ): Promise<Array<Pick<TableRow<"match_events">, "id">>> {
    const { data, error } = await this.table()
      .select("id")
      .eq("fixture_id", fixtureId)
      .eq("event_type", "red_card")
      .limit(1);

    this.throwOnError(error, "match_events listRedCardIds failed");
    return (data ?? []) as Array<Pick<TableRow<"match_events">, "id">>;
  }

  async findBySmEventId(
    smEventId: number
  ): Promise<Pick<TableRow<"match_events">, "id"> | null> {
    const { data, error } = await this.table()
      .select("id")
      .eq("sm_event_id", smEventId)
      .maybeSingle();

    this.throwOnError(error, "match_events findBySmEventId failed");
    return (data ?? null) as Pick<TableRow<"match_events">, "id"> | null;
  }

  async upsertProviderEvent(
    row: TableInsert<"match_events">,
    hasSportMonksEventId: boolean
  ): Promise<void> {
    const query = hasSportMonksEventId
      ? this.table().upsert(row as never, {
          onConflict: "sm_event_id",
          ignoreDuplicates: false,
        })
      : this.table().insert(row as never);

    const { error } = await query;
    this.throwOnError(error, "match_events upsertProviderEvent failed");
  }
}
