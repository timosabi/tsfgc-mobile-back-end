import { BaseRepository, type RepositoryClient } from "./base.js";

export default class DeadlineReminderLogRepository extends BaseRepository<"deadline_reminder_log"> {
  constructor(client: RepositoryClient) {
    super(client, "deadline_reminder_log");
  }

  // Atomically claims a reminder key: returns true the first time a given
  // key is claimed (the caller should send the reminder), false if it was
  // already claimed -- by this process or an earlier one, before a restart
  // would otherwise have wiped an in-memory dedup set.
  async tryClaim(reminderKey: string): Promise<boolean> {
    const { data, error } = await this.table()
      .upsert({ reminder_key: reminderKey } as never, {
        onConflict: "reminder_key",
        ignoreDuplicates: true,
      })
      .select("id")
      .maybeSingle();
    this.throwOnError(error, "deadline_reminder_log tryClaim failed");
    return data !== null;
  }
}
