import {
  BaseRepository,
  type RepositoryClient,
  type TableInsert,
  type TableRow,
} from "./base.js";

export type ActiveSubscriptionRef = Pick<
  TableRow<"friends_group_subscriptions">,
  "friends_group_id" | "provider_league_id" | "provider_season_id"
>;
export type ActiveSubscriptionCardRef = ActiveSubscriptionRef & {
  competition: Pick<
    TableRow<"football_competitions">,
    "id" | "name" | "country_name" | "logo_url" | "provider_league_id"
  > | null;
  season: Pick<
    TableRow<"football_seasons">,
    "id" | "name" | "provider_season_id"
  > | null;
};

export default class FriendsGroupSubscriptionsRepository extends BaseRepository<"friends_group_subscriptions"> {
  constructor(client: RepositoryClient) {
    super(client, "friends_group_subscriptions");
  }

  async findActiveByFriendsGroup(
    friendsGroupId: string
  ): Promise<ActiveSubscriptionRef | null> {
    const { data, error } = await this.table()
      .select("friends_group_id, provider_league_id, provider_season_id")
      .eq("friends_group_id", friendsGroupId)
      .eq("status", "active")
      .maybeSingle();

    this.throwOnError(
      error,
      "friends_group_subscriptions findActiveByFriendsGroup failed"
    );
    return (data ?? null) as ActiveSubscriptionRef | null;
  }

  async listActiveTargets(): Promise<ActiveSubscriptionRef[]> {
    const { data, error } = await this.table()
      .select("friends_group_id, provider_league_id, provider_season_id")
      .eq("status", "active");

    this.throwOnError(
      error,
      "friends_group_subscriptions listActiveTargets failed"
    );
    return (data ?? []) as ActiveSubscriptionRef[];
  }

  async listActiveWithCatalogByFriendsGroupIds(
    friendsGroupIds: string[]
  ): Promise<ActiveSubscriptionCardRef[]> {
    if (!friendsGroupIds.length) return [];

    const { data, error } = await this.table()
      .select(
        `
        friends_group_id,
        provider_league_id,
        provider_season_id,
        competition:football_competitions (
          id,
          name,
          country_name,
          logo_url,
          provider_league_id
        ),
        season:football_seasons (
          id,
          name,
          provider_season_id
        )
      `
      )
      .in("friends_group_id", friendsGroupIds)
      .eq("status", "active");

    this.throwOnError(
      error,
      "friends_group_subscriptions listActiveWithCatalogByFriendsGroupIds failed"
    );
    return (data ?? []) as unknown as ActiveSubscriptionCardRef[];
  }

  async findPendingOrActiveId(
    friendsGroupId: string
  ): Promise<Pick<TableRow<"friends_group_subscriptions">, "id"> | null> {
    const { data, error } = await this.table()
      .select("id")
      .eq("friends_group_id", friendsGroupId)
      .in("status", ["pending", "active"])
      .maybeSingle();

    this.throwOnError(
      error,
      "friends_group_subscriptions findPendingOrActiveId failed"
    );
    return (data ?? null) as Pick<TableRow<"friends_group_subscriptions">, "id"> | null;
  }

  async insertSubscription(
    row: TableInsert<"friends_group_subscriptions">
  ): Promise<TableRow<"friends_group_subscriptions">> {
    return this.insert(row);
  }

  async updateSubscriptionById(
    id: string,
    row: TableInsert<"friends_group_subscriptions">
  ): Promise<TableRow<"friends_group_subscriptions">> {
    const { data, error } = await this.table()
      .update(row as never)
      .eq("id", id)
      .select("*")
      .single();

    this.throwOnError(
      error,
      "friends_group_subscriptions updateSubscriptionById failed"
    );
    return data as TableRow<"friends_group_subscriptions">;
  }

  async findActiveWithCatalog(
    friendsGroupId: string
  ): Promise<TableRow<"friends_group_subscriptions"> | null> {
    const { data, error } = await this.table()
      .select(
        `
        *,
        competition:football_competitions(*),
        season:football_seasons(*)
      `
      )
      .eq("friends_group_id", friendsGroupId)
      .eq("status", "active")
      .maybeSingle();

    this.throwOnError(
      error,
      "friends_group_subscriptions findActiveWithCatalog failed"
    );
    return (data ?? null) as unknown as TableRow<"friends_group_subscriptions"> | null;
  }

  async findPendingByFriendsGroup(
    friendsGroupId: string
  ): Promise<TableRow<"friends_group_subscriptions"> | null> {
    const { data, error } = await this.table()
      .select("*")
      .eq("friends_group_id", friendsGroupId)
      .eq("status", "pending")
      .maybeSingle();

    this.throwOnError(
      error,
      "friends_group_subscriptions findPendingByFriendsGroup failed"
    );
    return (data ?? null) as TableRow<"friends_group_subscriptions"> | null;
  }

  async setPendingStatusForFriendsGroup(
    friendsGroupId: string,
    status: "active" | "rejected"
  ): Promise<TableRow<"friends_group_subscriptions"> | null> {
    const { data, error } = await this.table()
      .update({ status, updated_at: new Date().toISOString() })
      .eq("friends_group_id", friendsGroupId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    this.throwOnError(
      error,
      "friends_group_subscriptions setPendingStatusForFriendsGroup failed"
    );
    return (data ?? null) as TableRow<"friends_group_subscriptions"> | null;
  }

  async listIdsForFriendsGroup(
    friendsGroupId: string
  ): Promise<Array<Pick<TableRow<"friends_group_subscriptions">, "id">>> {
    const { data, error } = await this.table()
      .select("id")
      .eq("friends_group_id", friendsGroupId)
      .limit(1);

    this.throwOnError(
      error,
      "friends_group_subscriptions listIdsForFriendsGroup failed"
    );
    return (data ?? []) as Array<Pick<TableRow<"friends_group_subscriptions">, "id">>;
  }

  async listActiveByProviderLeague(
    providerLeagueId: number
  ): Promise<ActiveSubscriptionRef[]> {
    const { data, error } = await this.table()
      .select("friends_group_id, provider_league_id, provider_season_id")
      .eq("provider_league_id", providerLeagueId)
      .eq("status", "active");

    this.throwOnError(
      error,
      "friends_group_subscriptions listActiveByProviderLeague failed"
    );
    return (data ?? []) as ActiveSubscriptionRef[];
  }
}
