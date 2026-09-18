import ModerationService from "../../../src/services/ModerationService.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

function createService() {
  const repositories = {
    contentReports: createRepositoryMock<
      Pick<Repositories["contentReports"], "create" | "listPending" | "resolve">
    >(["create", "listPending", "resolve"]),
    memberBlocks: createRepositoryMock<
      Pick<Repositories["memberBlocks"], "block" | "unblock" | "listBlockedIds">
    >(["block", "unblock", "listBlockedIds"]),
    profiles: createRepositoryMock<
      Pick<
        Repositories["profiles"],
        "findDisplayName" | "listAdminIds" | "updateMembershipStatus"
      >
    >(["findDisplayName", "listAdminIds", "updateMembershipStatus"]),
  };
  const pushNotifications = { sendToUsers: jest.fn().mockResolvedValue({ sent: 1, skipped: false }) };

  repositories.profiles.findDisplayName.mockResolvedValue({ display_name: "Bellend Bob" });
  repositories.profiles.listAdminIds.mockResolvedValue(["admin-1"]);

  const service = new ModerationService(
    repositories as unknown as ConstructorParameters<typeof ModerationService>[0],
    pushNotifications as never
  );

  return { repositories, pushNotifications, service };
}

describe("ModerationService", () => {
  it("reports a display name, snapshotting it and notifying admins", async () => {
    const { repositories, pushNotifications, service } = createService();
    repositories.contentReports.create.mockResolvedValue({
      id: "report-1",
      reporter_user_id: "user-a",
      reported_user_id: "user-b",
      friends_group_id: "group-1",
      reported_display_name: "Bellend Bob",
      status: "pending",
      created_at: "2026-09-18T00:00:00Z",
      reviewed_at: null,
      reviewed_by: null,
      review_note: null,
    });

    const result = await service.reportDisplayName({
      reporterUserId: "user-a",
      reportedUserId: "user-b",
      friendsGroupId: "group-1",
    });

    expect(repositories.contentReports.create).toHaveBeenCalledWith({
      reporter_user_id: "user-a",
      reported_user_id: "user-b",
      friends_group_id: "group-1",
      reported_display_name: "Bellend Bob",
    });
    expect(pushNotifications.sendToUsers).toHaveBeenCalledWith(
      ["admin-1"],
      expect.objectContaining({ title: "New content report" })
    );
    expect(result.id).toBe("report-1");
  });

  it("locks the reported account when a report is actioned with lockOffender", async () => {
    const { repositories, service } = createService();
    repositories.contentReports.resolve.mockResolvedValue({
      id: "report-1",
      reporter_user_id: "user-a",
      reported_user_id: "user-b",
      friends_group_id: "group-1",
      reported_display_name: "Bellend Bob",
      status: "actioned",
      created_at: "2026-09-18T00:00:00Z",
      reviewed_at: "2026-09-18T01:00:00Z",
      reviewed_by: "admin-1",
      review_note: null,
    });

    await service.resolveReport("report-1", "admin-1", {
      action: "actioned",
      lockOffender: true,
    });

    expect(repositories.profiles.updateMembershipStatus).toHaveBeenCalledWith(
      "user-b",
      expect.objectContaining({ status: "rejected", reviewedBy: "admin-1" })
    );
  });

  it("does not touch membership status when a report is dismissed", async () => {
    const { repositories, service } = createService();
    repositories.contentReports.resolve.mockResolvedValue({
      id: "report-1",
      reporter_user_id: "user-a",
      reported_user_id: "user-b",
      friends_group_id: "group-1",
      reported_display_name: "Bellend Bob",
      status: "dismissed",
      created_at: "2026-09-18T00:00:00Z",
      reviewed_at: "2026-09-18T01:00:00Z",
      reviewed_by: "admin-1",
      review_note: null,
    });

    await service.resolveReport("report-1", "admin-1", { action: "dismissed" });

    expect(repositories.profiles.updateMembershipStatus).not.toHaveBeenCalled();
  });

  it("does not lock the account when actioned without lockOffender", async () => {
    const { repositories, service } = createService();
    repositories.contentReports.resolve.mockResolvedValue({
      id: "report-1",
      reporter_user_id: "user-a",
      reported_user_id: "user-b",
      friends_group_id: "group-1",
      reported_display_name: "Bellend Bob",
      status: "actioned",
      created_at: "2026-09-18T00:00:00Z",
      reviewed_at: "2026-09-18T01:00:00Z",
      reviewed_by: "admin-1",
      review_note: null,
    });

    await service.resolveReport("report-1", "admin-1", { action: "actioned" });

    expect(repositories.profiles.updateMembershipStatus).not.toHaveBeenCalled();
  });

  it("blocks, unblocks, and lists blocked member ids", async () => {
    const { repositories, service } = createService();
    repositories.memberBlocks.listBlockedIds.mockResolvedValue(["user-c"]);

    await service.blockMember("user-a", "user-b");
    expect(repositories.memberBlocks.block).toHaveBeenCalledWith("user-a", "user-b");

    await service.unblockMember("user-a", "user-b");
    expect(repositories.memberBlocks.unblock).toHaveBeenCalledWith("user-a", "user-b");

    await expect(service.listBlockedIds("user-a")).resolves.toEqual(["user-c"]);
  });
});
