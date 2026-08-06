import {
  BaseRepository,
  type RepositoryClient,
  type TableInsert,
  type TableRow,
} from "./base.js";

export type FriendsGroupOverviewRow = Pick<
  TableRow<"friends_groups">,
  "id" | "name" | "slug" | "is_open" | "status" | "created_by"
>;
type OwnedFriendsGroupRef = Pick<TableRow<"friends_groups">, "id" | "name" | "slug">;

export default class FriendsGroupsRepository extends BaseRepository<"friends_groups"> {
  constructor(client: RepositoryClient) {
    super(client, "friends_groups");
  }

  async findOverviewById(id: string): Promise<FriendsGroupOverviewRow | null> {
    const { data, error } = await this.table()
      .select("id, name, slug, is_open, status, created_by")
      .eq("id", id)
      .maybeSingle();

    this.throwOnError(error, "friends_groups findOverviewById failed");
    return (data ?? null) as FriendsGroupOverviewRow | null;
  }

  async findOwnedByUser(
    userId: string
  ): Promise<OwnedFriendsGroupRef | null> {
    const { data, error } = await this.table()
      .select("id, name, slug")
      .eq("created_by", userId)
      .in("status", ["pending", "approved"])
      .maybeSingle();

    this.throwOnError(error, "friends_groups findOwnedByUser failed");
    return (data ?? null) as OwnedFriendsGroupRef | null;
  }

  async findByInviteToken(
    inviteToken: string
  ): Promise<TableRow<"friends_groups"> | null> {
    const { data, error } = await this.table()
      .select("*")
      .eq("invite_token", inviteToken)
      .maybeSingle();

    this.throwOnError(error, "friends_groups findByInviteToken failed");
    return (data ?? null) as TableRow<"friends_groups"> | null;
  }

  async slugMatches(slug: string): Promise<Array<Pick<TableRow<"friends_groups">, "id">>> {
    const { data, error } = await this.table()
      .select("id")
      .eq("slug", slug)
      .limit(1);

    this.throwOnError(error, "friends_groups slugMatches failed");
    return (data ?? []) as Array<Pick<TableRow<"friends_groups">, "id">>;
  }

  async createFriendsGroup(
    payload: TableInsert<"friends_groups">
  ): Promise<TableRow<"friends_groups">> {
    return this.insert(payload);
  }

  async archiveById(id: string): Promise<TableRow<"friends_groups">> {
    return this.updateById(id, {
      status: "archived",
      updated_at: new Date().toISOString(),
    });
  }

  async transferOwnership(payload: {
    friendsGroupId: string;
    currentOwnerId: string;
    newOwnerId: string;
  }): Promise<void> {
    const { error } = await this.supabase.rpc(
      "transfer_friends_group_ownership",
      {
        p_friends_group_id: payload.friendsGroupId,
        p_current_owner_id: payload.currentOwnerId,
        p_new_owner_id: payload.newOwnerId,
      }
    );

    this.throwOnError(error, "friends_groups transferOwnership failed");
  }

  async listApprovedNamesByIds(
    ids: string[]
  ): Promise<Array<Pick<TableRow<"friends_groups">, "id" | "name">>> {
    if (!ids.length) return [];

    const { data, error } = await this.table()
      .select("id, name")
      .in("id", ids)
      .eq("status", "approved");

    this.throwOnError(error, "friends_groups listApprovedNamesByIds failed");
    return (data ?? []) as Array<Pick<TableRow<"friends_groups">, "id" | "name">>;
  }
}
