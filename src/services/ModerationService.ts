import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import PushNotificationService from "./PushNotificationService.js";

type ModerationRepositories = Pick<
  Repositories,
  "contentReports" | "memberBlocks" | "profiles" | "notificationSubscriptions"
>;

export default class ModerationService {
  private readonly repositories: ModerationRepositories;
  private readonly pushNotifications: PushNotificationService;

  constructor(
    clientOrRepositories: SupabaseClient<Database> | ModerationRepositories,
    pushNotifications?: PushNotificationService
  ) {
    this.repositories = isModerationRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
    this.pushNotifications =
      pushNotifications ?? new PushNotificationService(this.repositories);
  }

  async reportDisplayName(params: {
    reporterUserId: string;
    reportedUserId: string;
    friendsGroupId: string;
  }) {
    const reportedProfile = await this.repositories.profiles.findDisplayName(
      params.reportedUserId
    );

    const report = await this.repositories.contentReports.create({
      reporter_user_id: params.reporterUserId,
      reported_user_id: params.reportedUserId,
      friends_group_id: params.friendsGroupId,
      reported_display_name: reportedProfile.display_name ?? "Unknown",
    });

    const adminIds = await this.repositories.profiles.listAdminIds();
    await this.pushNotifications.sendToUsers(adminIds, {
      title: "New content report",
      body: `A display name was reported: "${report.reported_display_name}"`,
      data: { type: "content_report", reportId: report.id },
    });

    return report;
  }

  async listPendingReports() {
    return this.repositories.contentReports.listPending();
  }

  async resolveReport(
    id: string,
    adminId: string,
    params: { action: "actioned" | "dismissed"; note?: string; lockOffender?: boolean }
  ) {
    const report = await this.repositories.contentReports.resolve(id, {
      status: params.action,
      reviewedBy: adminId,
      reviewNote: params.note,
    });

    if (params.action === "actioned" && params.lockOffender) {
      await this.repositories.profiles.updateMembershipStatus(report.reported_user_id, {
        status: "rejected",
        reviewedBy: adminId,
        reviewNote: params.note ?? "Account locked following a content report",
      });
    }

    return report;
  }

  async blockMember(userId: string, blockedUserId: string) {
    await this.repositories.memberBlocks.block(userId, blockedUserId);
  }

  async unblockMember(userId: string, blockedUserId: string) {
    await this.repositories.memberBlocks.unblock(userId, blockedUserId);
  }

  async listBlockedIds(userId: string) {
    return this.repositories.memberBlocks.listBlockedIds(userId);
  }
}

function isModerationRepositories(
  value: SupabaseClient<Database> | ModerationRepositories
): value is ModerationRepositories {
  return "contentReports" in value && "memberBlocks" in value;
}
