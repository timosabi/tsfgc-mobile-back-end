import {
  BaseRepository,
  type RepositoryClient,
  type TableInsert,
  type TableRow,
} from "./base.js";

export default class LiveFeedEventsRepository extends BaseRepository<"live_feed_events"> {
  constructor(client: RepositoryClient) {
    super(client, "live_feed_events");
  }

  async listByGroupMatchweekWithFixture(
    friendsGroupId: string,
    matchweek: string
  ): Promise<TableRow<"live_feed_events">[]> {
    const { data, error } = await this.table()
      .select("*, fixture:fixtures(id, matchweek, home_team, away_team)")
      .eq("friends_group_id", friendsGroupId)
      .eq("matchweek", matchweek)
      .order("created_at", { ascending: true });

    this.throwOnError(error, "live_feed_events listByGroupMatchweekWithFixture failed");
    return (data ?? []) as TableRow<"live_feed_events">[];
  }

  async listByGroupMatchweek(
    friendsGroupId: string,
    matchweek: string
  ): Promise<TableRow<"live_feed_events">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("friends_group_id", friendsGroupId)
      .eq("matchweek", matchweek)
      .order("created_at", { ascending: true });

    this.throwOnError(error, "live_feed_events listByGroupMatchweek failed");
    return (data ?? []) as TableRow<"live_feed_events">[];
  }

  async listFeed(params: {
    friendsGroupId: string;
    fixtureId?: number;
    matchweek?: string;
    limit: number;
  }): Promise<TableRow<"live_feed_events">[]> {
    let query = this.table()
      .select("*, fixture:fixtures(id, matchweek, home_team, away_team)")
      .eq("friends_group_id", params.friendsGroupId)
      .order("created_at", { ascending: true })
      .limit(Math.min(params.limit, 100));

    if (params.fixtureId) query = query.eq("fixture_id", params.fixtureId);
    if (params.matchweek) query = query.eq("matchweek", params.matchweek);

    const { data, error } = await query;
    this.throwOnError(error, "live_feed_events listFeed failed");
    return (data ?? []) as unknown as TableRow<"live_feed_events">[];
  }

  async upsertFeedEvent(
    row: TableInsert<"live_feed_events">
  ): Promise<TableRow<"live_feed_events">> {
    const { data, error } = await this.table()
      .upsert(row as never, {
        onConflict: "friends_group_id,event_key",
        ignoreDuplicates: false,
      })
      .select("*")
      .single();

    this.throwOnError(error, "live_feed_events upsertFeedEvent failed");
    return data as TableRow<"live_feed_events">;
  }
}
