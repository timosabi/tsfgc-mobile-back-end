import {
  BaseRepository,
  type RepositoryClient,
  type TableRow,
  type TableUpdate,
} from "./base.js";

export type ProfilePreview = Pick<
  TableRow<"profiles">,
  "id" | "display_name" | "avatar_emoji" | "color_class"
>;

export default class ProfilesRepository extends BaseRepository<"profiles"> {
  constructor(client: RepositoryClient) {
    super(client, "profiles");
  }

  async listPreviewsByIds(userIds: string[]): Promise<ProfilePreview[]> {
    if (!userIds.length) return [];

    const { data, error } = await this.table()
      .select("id, display_name, avatar_emoji, color_class")
      .in("id", userIds);

    this.throwOnError(error, "profiles listPreviewsByIds failed");
    return (data ?? []) as ProfilePreview[];
  }

  async listAllProfiles(): Promise<TableRow<"profiles">[]> {
    const { data, error } = await this.table().select("*");
    this.throwOnError(error, "profiles listAllProfiles failed");
    return (data ?? []) as TableRow<"profiles">[];
  }

  async listByIds(userIds: string[]): Promise<TableRow<"profiles">[]> {
    if (!userIds.length) return [];

    const { data, error } = await this.table().select("*").in("id", userIds);
    this.throwOnError(error, "profiles listByIds failed");
    return (data ?? []) as TableRow<"profiles">[];
  }

  async findDisplayName(
    userId: string
  ): Promise<Pick<TableRow<"profiles">, "display_name">> {
    const { data, error } = await this.table()
      .select("display_name")
      .eq("id", userId)
      .single();

    this.throwOnError(error, "profiles findDisplayName failed");
    return data as Pick<TableRow<"profiles">, "display_name">;
  }

  async listNameAvatarByIds(
    userIds: string[]
  ): Promise<Array<Pick<TableRow<"profiles">, "id" | "display_name" | "avatar_emoji">>> {
    if (!userIds.length) return [];

    const { data, error } = await this.table()
      .select("id, display_name, avatar_emoji")
      .in("id", userIds);

    this.throwOnError(error, "profiles listNameAvatarByIds failed");
    return (data ?? []) as Array<Pick<TableRow<"profiles">, "id" | "display_name" | "avatar_emoji">>;
  }

  async findProfileById(userId: string): Promise<TableRow<"profiles"> | null> {
    const { data, error } = await this.table()
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    this.throwOnError(error, "profiles findProfileById failed");
    return (data ?? null) as TableRow<"profiles"> | null;
  }

  async listByMembershipStatus(
    status: string
  ): Promise<TableRow<"profiles">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("membership_status", status)
      .order("created_at", { ascending: true });

    this.throwOnError(error, "profiles listByMembershipStatus failed");
    return (data ?? []) as TableRow<"profiles">[];
  }

  async updateMembershipStatus(
    userId: string,
    params: { status: string; reviewedBy: string; reviewNote?: string }
  ): Promise<TableRow<"profiles">> {
    const { data, error } = await this.table()
      .update({
        membership_status: params.status,
        membership_reviewed_at: new Date().toISOString(),
        membership_reviewed_by: params.reviewedBy,
        membership_review_note: params.reviewNote ?? null,
      })
      .eq("id", userId)
      .select()
      .single();

    this.throwOnError(error, "profiles updateMembershipStatus failed");
    return data as TableRow<"profiles">;
  }

  async upsertProfile(
    row: TableUpdate<"profiles"> & { id: string }
  ): Promise<TableRow<"profiles">> {
    const { data, error } = await this.table()
      .upsert(row as never, { onConflict: "id" })
      .select()
      .single();

    this.throwOnError(error, "profiles upsertProfile failed");
    return data as TableRow<"profiles">;
  }

  async findLastActiveFriendsGroup(userId: string): Promise<unknown> {
    const { data, error } = await this.table()
      .select(
        `
        last_active_friends_group_id,
        last_active_friends_group:friends_groups!last_active_friends_group_id (
          id, name, slug, created_at, updated_at
        )
      `
      )
      .eq("id", userId)
      .maybeSingle();

    this.throwOnError(error, "profiles findLastActiveFriendsGroup failed");
    return data;
  }

  async updateLastActiveFriendsGroup(
    userId: string,
    friendsGroupId: string
  ): Promise<void> {
    const { error } = await this.table()
      .update({ last_active_friends_group_id: friendsGroupId })
      .eq("id", userId);

    this.throwOnError(error, "profiles updateLastActiveFriendsGroup failed");
  }

  async clearFriendsGroupRefsForUser(
    userId: string,
    friendsGroupId: string
  ): Promise<void> {
    const { error } = await this.table()
      .update({
        default_friends_group_id: null,
        last_active_friends_group_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .or(
        `default_friends_group_id.eq.${friendsGroupId},last_active_friends_group_id.eq.${friendsGroupId}`
      );

    this.throwOnError(error, "profiles clearFriendsGroupRefsForUser failed");
  }

  async clearFriendsGroupRefs(friendsGroupId: string): Promise<void> {
    const { error } = await this.table()
      .update({
        default_friends_group_id: null,
        last_active_friends_group_id: null,
        updated_at: new Date().toISOString(),
      })
      .or(
        `default_friends_group_id.eq.${friendsGroupId},last_active_friends_group_id.eq.${friendsGroupId}`
      );

    this.throwOnError(error, "profiles clearFriendsGroupRefs failed");
  }

  async listDisplayNamesByIds(
    userIds: string[]
  ): Promise<Array<Pick<TableRow<"profiles">, "id" | "display_name">>> {
    if (!userIds.length) return [];

    const { data, error } = await this.table()
      .select("id, display_name")
      .in("id", userIds);

    this.throwOnError(error, "profiles listDisplayNamesByIds failed");
    return (data ?? []) as Array<Pick<TableRow<"profiles">, "id" | "display_name">>;
  }
}
