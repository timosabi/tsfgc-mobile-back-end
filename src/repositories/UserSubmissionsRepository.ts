import {
  BaseRepository,
  type RepositoryClient,
  type TableInsert,
  type TableRow,
} from "./base.js";

export type SubmittedUserRef = Pick<
  TableRow<"user_submissions">,
  "user_id" | "submitted_at"
>;
export type SubmittedUserIdRef = Pick<TableRow<"user_submissions">, "user_id">;

export default class UserSubmissionsRepository extends BaseRepository<"user_submissions"> {
  constructor(client: RepositoryClient) {
    super(client, "user_submissions");
  }

  async findByUserGroupMatchweek(
    userId: string,
    friendsGroupId: string,
    matchweek: string
  ): Promise<TableRow<"user_submissions"> | null> {
    const { data, error } = await this.table()
      .select("*")
      .eq("user_id", userId)
      .eq("friends_group_id", friendsGroupId)
      .eq("matchweek", matchweek)
      .maybeSingle();

    this.throwOnError(error, "user_submissions findByUserGroupMatchweek failed");
    return (data ?? null) as TableRow<"user_submissions"> | null;
  }

  async listSubmittedUsers(
    friendsGroupId: string,
    matchweek: string
  ): Promise<SubmittedUserRef[]> {
    const { data, error } = await this.table()
      .select("user_id, submitted_at")
      .eq("friends_group_id", friendsGroupId)
      .eq("matchweek", matchweek);

    this.throwOnError(error, "user_submissions listSubmittedUsers failed");
    return (data ?? []) as SubmittedUserRef[];
  }

  async listSubmittedUserIds(
    friendsGroupId: string,
    matchweek: string
  ): Promise<SubmittedUserIdRef[]> {
    const { data, error } = await this.table()
      .select("user_id")
      .eq("friends_group_id", friendsGroupId)
      .eq("matchweek", matchweek);

    this.throwOnError(error, "user_submissions listSubmittedUserIds failed");
    return (data ?? []) as SubmittedUserIdRef[];
  }

  async upsertSubmission(row: TableInsert<"user_submissions">): Promise<void> {
    await this.upsert(row, {
      onConflict: "user_id,friends_group_id,matchweek",
      ignoreDuplicates: false,
    });
  }

  async deleteByUserGroupMatchweek(
    userId: string,
    friendsGroupId: string,
    matchweek: string
  ): Promise<void> {
    const { error } = await this.table()
      .delete()
      .eq("user_id", userId)
      .eq("friends_group_id", friendsGroupId)
      .eq("matchweek", matchweek);

    this.throwOnError(error, "user_submissions deleteByUserGroupMatchweek failed");
  }
}
