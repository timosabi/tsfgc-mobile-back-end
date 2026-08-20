import { BaseRepository, type RepositoryClient, type TableRow } from "./base.js";

export type FriendsGroupMemberRef = Pick<
  TableRow<"friends_group_users">,
  "user_id" | "joined_at" | "role"
>;
export type FriendsGroupMembership = Pick<
  TableRow<"friends_group_users">,
  "id" | "user_id" | "friends_group_id" | "role" | "joined_at"
>;
export type UserFriendsGroupRow = {
  role: "owner" | "member";
  joined_at: string;
  friends_group: {
    id: string;
    name: string;
    slug: string;
    created_by: string;
    invite_token: string;
    is_open: boolean;
    status: string;
    created_at: string;
    updated_at: string;
  };
};

export default class FriendsGroupUsersRepository extends BaseRepository<"friends_group_users"> {
  constructor(client: RepositoryClient) {
    super(client, "friends_group_users");
  }

  async listMembers(friendsGroupId: string): Promise<FriendsGroupMemberRef[]> {
    const { data, error } = await this.table()
      .select("user_id, joined_at, role")
      .eq("friends_group_id", friendsGroupId)
      .order("joined_at", { ascending: true });

    this.throwOnError(error, "friends_group_users listMembers failed");
    return (data ?? []) as FriendsGroupMemberRef[];
  }

  async findMembershipId(
    friendsGroupId: string,
    userId: string,
    options: { strict?: boolean } = {}
  ): Promise<Pick<TableRow<"friends_group_users">, "id"> | null> {
    const query = this.table()
      .select("id")
      .eq("friends_group_id", friendsGroupId)
      .eq("user_id", userId);

    const { data, error } = options.strict
      ? await query.single()
      : await query.maybeSingle();

    this.throwOnError(error, "friends_group_users findMembershipId failed");
    return (data ?? null) as Pick<TableRow<"friends_group_users">, "id"> | null;
  }

  async findMembership(
    friendsGroupId: string,
    userId: string
  ): Promise<FriendsGroupMembership | null> {
    const { data, error } = await this.table()
      .select("id, user_id, friends_group_id, role, joined_at")
      .eq("friends_group_id", friendsGroupId)
      .eq("user_id", userId)
      .maybeSingle();

    this.throwOnError(error, "friends_group_users findMembership failed");
    return (data ?? null) as FriendsGroupMembership | null;
  }

  async listForUser(userId: string): Promise<UserFriendsGroupRow[]> {
    const { data, error } = await this.table()
      .select(
        `
      role,
      joined_at,
      friends_group:friends_groups!inner (
        id,
        name,
        slug,
        created_by,
        invite_token,
        is_open,
        status,
        created_at,
        updated_at
      )
    `
      )
      .eq("user_id", userId)
      .eq("friends_group.status", "approved");

    this.throwOnError(error, "friends_group_users listForUser failed");
    return (data ?? []) as unknown as UserFriendsGroupRow[];
  }

  async upsertMembership(payload: {
    friendsGroupId: string;
    userId: string;
    role?: "owner" | "member";
  }): Promise<void> {
    const { error } = await this.table().upsert(
      {
        friends_group_id: payload.friendsGroupId,
        user_id: payload.userId,
        role: payload.role ?? "member",
      } as never,
      { onConflict: "friends_group_id,user_id", ignoreDuplicates: true }
    );

    this.throwOnError(error, "friends_group_users upsertMembership failed");
  }

  async countMembers(friendsGroupId: string): Promise<number | null> {
    const { count, error } = await this.table()
      .select("*", { count: "exact", head: true })
      .eq("friends_group_id", friendsGroupId);

    this.throwOnError(error, "friends_group_users countMembers failed");
    return count ?? null;
  }

  async removeMembership(userId: string, friendsGroupId: string): Promise<void> {
    const { error } = await this.table()
      .delete()
      .eq("friends_group_id", friendsGroupId)
      .eq("user_id", userId);

    this.throwOnError(error, "friends_group_users removeMembership failed");
  }

  async listGroupRefsForUser(
    userId: string
  ): Promise<Array<Pick<TableRow<"friends_group_users">, "friends_group_id">>> {
    const { data, error } = await this.table()
      .select("friends_group_id")
      .eq("user_id", userId);

    this.throwOnError(error, "friends_group_users listGroupRefsForUser failed");
    return (data ?? []) as Array<Pick<TableRow<"friends_group_users">, "friends_group_id">>;
  }

  async listOwnedGroupIdsForUser(userId: string): Promise<string[]> {
    const { data, error } = await this.table()
      .select("friends_group_id")
      .eq("user_id", userId)
      .eq("role", "owner");

    this.throwOnError(error, "friends_group_users listOwnedGroupIdsForUser failed");
    return (data ?? []).map((row) => row.friends_group_id as string);
  }
}
