import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import { AppError } from "../middleware/errorHandler.js";

type AccountDeletionRepositories = Pick<
  Repositories,
  | "predictions"
  | "redCardPredictions"
  | "userSubmissions"
  | "weeklyScores"
  | "notificationSubscriptions"
  | "friendsGroupJoinRequests"
  | "friendsGroupUsers"
  | "friendsGroups"
  | "profiles"
>;

export default class AccountDeletionService {
  private readonly repositories: AccountDeletionRepositories;

  constructor(clientOrRepositories: SupabaseClient<Database> | AccountDeletionRepositories) {
    this.repositories = isAccountDeletionRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  // friends_groups.id cascades via FK for its own delete, but none of the
  // user_id/created_by columns across the schema are real foreign keys, so
  // deleting a profile leaves every table below manually cleaned up here --
  // leaf data first, the identity row (profiles) last, so a partial failure
  // never leaves the profile gone while related data still lingers.
  async deleteAccount(userId: string): Promise<{ status: "deleted" }> {
    const ownedActiveGroups =
      await this.repositories.friendsGroups.findActiveOwnedByUserId(userId);
    if (ownedActiveGroups.length > 0) {
      throw new AppError(
        `You still own ${ownedActiveGroups.length} group(s). Transfer ownership or delete them before deleting your account.`,
        409
      );
    }

    await this.repositories.predictions.deleteByUserId(userId);
    await this.repositories.redCardPredictions.deleteByUserId(userId);
    await this.repositories.userSubmissions.deleteByUserId(userId);
    await this.repositories.weeklyScores.deleteByUserId(userId);
    await this.repositories.notificationSubscriptions.deleteByUserId(userId);
    await this.repositories.friendsGroupJoinRequests.deleteByUserId(userId);
    await this.repositories.friendsGroupUsers.deleteByUserId(userId);
    await this.repositories.profiles.deleteById(userId);

    return { status: "deleted" };
  }
}

function isAccountDeletionRepositories(
  value: SupabaseClient<Database> | AccountDeletionRepositories
): value is AccountDeletionRepositories {
  return (
    "predictions" in value &&
    "redCardPredictions" in value &&
    "userSubmissions" in value &&
    "weeklyScores" in value &&
    "notificationSubscriptions" in value &&
    "friendsGroupJoinRequests" in value &&
    "friendsGroupUsers" in value &&
    "friendsGroups" in value &&
    "profiles" in value
  );
}
