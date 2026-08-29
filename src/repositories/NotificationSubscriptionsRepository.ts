import { BaseRepository, type RepositoryClient, type TableRow } from "./base.js";

export default class NotificationSubscriptionsRepository extends BaseRepository<"notification_subscriptions"> {
  constructor(client: RepositoryClient) {
    super(client, "notification_subscriptions");
  }

  async findActiveByUserId(
    userId: string
  ): Promise<TableRow<"notification_subscriptions">[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true);

    this.throwOnError(error, "notification_subscriptions findActiveByUserId failed");
    return (data ?? []) as TableRow<"notification_subscriptions">[];
  }

  async findActiveByUserIds(
    userIds: string[]
  ): Promise<TableRow<"notification_subscriptions">[]> {
    if (!userIds.length) return [];

    const { data, error } = await this.table()
      .select("*")
      .in("user_id", userIds)
      .eq("is_active", true);

    this.throwOnError(error, "notification_subscriptions findActiveByUserIds failed");
    return (data ?? []) as TableRow<"notification_subscriptions">[];
  }

  async upsertSubscription(row: {
    user_id: string;
    friends_group_id?: string | null;
    channel: string;
    endpoint: string;
    auth_secret?: string | null;
    p256dh_key?: string | null;
    device_label?: string | null;
  }): Promise<void> {
    await this.upsert(
      { ...row, is_active: true, updated_at: new Date().toISOString() } as never,
      { onConflict: "user_id,channel,endpoint" }
    );
  }

  async deactivateByEndpoint(userId: string, endpoint: string): Promise<void> {
    const { error } = await this.table()
      .update({ is_active: false, updated_at: new Date().toISOString() } as never)
      .eq("user_id", userId)
      .eq("endpoint", endpoint);

    this.throwOnError(error, "notification_subscriptions deactivateByEndpoint failed");
  }

  async deactivateById(id: string): Promise<void> {
    const { error } = await this.table()
      .update({ is_active: false, updated_at: new Date().toISOString() } as never)
      .eq("id", id);

    this.throwOnError(error, "notification_subscriptions deactivateById failed");
  }

  async deactivateByEndpoints(endpoints: string[]): Promise<void> {
    if (!endpoints.length) return;

    const { error } = await this.table()
      .update({ is_active: false, updated_at: new Date().toISOString() } as never)
      .in("endpoint", endpoints);

    this.throwOnError(error, "notification_subscriptions deactivateByEndpoints failed");
  }
}
