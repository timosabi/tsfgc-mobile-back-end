import {
  BaseRepository,
  type RepositoryClient,
  type TableUpdate,
  type TableRow,
} from "./base.js";

export default class FriendsGroupJoinRequestsRepository extends BaseRepository<"friends_group_join_requests"> {
  constructor(client: RepositoryClient) {
    super(client, "friends_group_join_requests");
  }

  async findStatus(
    userId: string,
    friendsGroupId: string
  ): Promise<Pick<TableRow<"friends_group_join_requests">, "status"> | null> {
    const { data, error } = await this.table()
      .select("status")
      .eq("friends_group_id", friendsGroupId)
      .eq("user_id", userId)
      .maybeSingle();

    this.throwOnError(error, "friends_group_join_requests findStatus failed");
    return (data ?? null) as Pick<TableRow<"friends_group_join_requests">, "status"> | null;
  }

  async listForGroup(friendsGroupId: string): Promise<TableRow<"friends_group_join_requests">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("friends_group_id", friendsGroupId)
      .order("requested_at", { ascending: false });

    this.throwOnError(error, "friends_group_join_requests listForGroup failed");
    return (data ?? []) as TableRow<"friends_group_join_requests">[];
  }

  async findReviewRef(
    requestId: string
  ): Promise<Pick<TableRow<"friends_group_join_requests">, "id" | "friends_group_id" | "user_id" | "status">> {
    const { data, error } = await this.table()
      .select("id, friends_group_id, user_id, status")
      .eq("id", requestId)
      .single();

    this.throwOnError(error, "friends_group_join_requests findReviewRef failed");
    return data as Pick<TableRow<"friends_group_join_requests">, "id" | "friends_group_id" | "user_id" | "status">;
  }

  async upsertPendingRequest(payload: {
    friendsGroupId: string;
    userId: string;
    message?: string;
    userDisplayName?: string;
  }): Promise<void> {
    const { error } = await this.table().upsert(
      {
        friends_group_id: payload.friendsGroupId,
        user_id: payload.userId,
        message: payload.message,
        user_display_name: payload.userDisplayName,
        status: "pending",
        processed_at: null,
        processed_by: null,
      } as never,
      { onConflict: "friends_group_id,user_id", ignoreDuplicates: false }
    );

    this.throwOnError(error, "friends_group_join_requests upsertPendingRequest failed");
  }

  async listPending(
    friendsGroupId: string
  ): Promise<TableRow<"friends_group_join_requests">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("friends_group_id", friendsGroupId)
      .eq("status", "pending")
      .order("requested_at", { ascending: true });

    this.throwOnError(error, "friends_group_join_requests listPending failed");
    return (data ?? []) as TableRow<"friends_group_join_requests">[];
  }

  async listPendingForGroups(
    friendsGroupIds: string[]
  ): Promise<Array<TableRow<"friends_group_join_requests"> & { friends_groups: { name: string; slug: string } | null }>> {
    if (!friendsGroupIds.length) return [];

    const { data, error } = await this.table()
      .select("*, friends_groups(name, slug)")
      .in("friends_group_id", friendsGroupIds)
      .eq("status", "pending")
      .order("requested_at", { ascending: true });

    this.throwOnError(error, "friends_group_join_requests listPendingForGroups failed");
    return (data ?? []) as Array<
      TableRow<"friends_group_join_requests"> & { friends_groups: { name: string; slug: string } | null }
    >;
  }

  async updateRequest(payload: {
    requestId: string;
    data: TableUpdate<"friends_group_join_requests">;
  }): Promise<void> {
    const { error } = await this.table()
      .update(payload.data as never)
      .eq("id", payload.requestId);

    this.throwOnError(error, "friends_group_join_requests updateRequest failed");
  }

  async updateStatus(payload: {
    requestId: string;
    status: "approved" | "rejected";
    processedBy: string;
  }): Promise<Pick<TableRow<"friends_group_join_requests">, "id" | "friends_group_id" | "user_id" | "status">> {
    const { data, error } = await this.table()
      .update({
        status: payload.status,
        processed_by: payload.processedBy,
        processed_at: new Date().toISOString(),
      })
      .eq("id", payload.requestId)
      .select("id, friends_group_id, user_id, status")
      .single();

    this.throwOnError(error, "friends_group_join_requests updateStatus failed");
    return data as Pick<TableRow<"friends_group_join_requests">, "id" | "friends_group_id" | "user_id" | "status">;
  }
}
