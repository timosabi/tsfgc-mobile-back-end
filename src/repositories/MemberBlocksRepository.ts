import { BaseRepository, type RepositoryClient } from "./base.js";

export default class MemberBlocksRepository extends BaseRepository<"member_blocks"> {
  constructor(client: RepositoryClient) {
    super(client, "member_blocks");
  }

  // Idempotent -- blocking someone twice is a no-op, not an error.
  async block(userId: string, blockedUserId: string): Promise<void> {
    await this.upsert(
      { user_id: userId, blocked_user_id: blockedUserId },
      { onConflict: "user_id,blocked_user_id", ignoreDuplicates: true }
    );
  }

  async unblock(userId: string, blockedUserId: string): Promise<void> {
    const { error } = await this.table()
      .delete()
      .eq("user_id", userId)
      .eq("blocked_user_id", blockedUserId);

    this.throwOnError(error, "member_blocks unblock failed");
  }

  async listBlockedIds(userId: string): Promise<string[]> {
    const { data, error } = await this.table()
      .select("blocked_user_id")
      .eq("user_id", userId);

    this.throwOnError(error, "member_blocks listBlockedIds failed");
    return (data ?? []).map((row) => row.blocked_user_id);
  }
}
