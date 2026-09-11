import FriendsGroupJoinRequestService from "../../../src/services/FriendsGroupJoinRequestService.js";
import type { Database } from "../../../src/integrations/supabase/types.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

type JoinRequestRow =
  Database["public"]["Tables"]["friends_group_join_requests"]["Row"];

function createService() {
  const repositories = {
    friendsGroupJoinRequests: createRepositoryMock<
      Pick<
        Repositories["friendsGroupJoinRequests"],
        | "findReviewRef"
        | "findStatus"
        | "listForGroup"
        | "listPending"
        | "listPendingForGroups"
        | "updateRequest"
        | "updateStatus"
        | "upsertPendingRequest"
      >
    >([
      "findReviewRef",
      "findStatus",
      "listForGroup",
      "listPending",
      "listPendingForGroups",
      "updateRequest",
      "updateStatus",
      "upsertPendingRequest",
    ]),
    friendsGroupUsers: createRepositoryMock<
      Pick<Repositories["friendsGroupUsers"], "listOwnedGroupIdsForUser">
    >(["listOwnedGroupIdsForUser"]),
    profiles: createRepositoryMock<Pick<Repositories["profiles"], "listPreviewsByIds">>([
      "listPreviewsByIds",
    ]),
  };

  const adminAuthClient = { auth: { admin: { getUserById: jest.fn() } } };

  return {
    repositories,
    adminAuthClient,
    service: new FriendsGroupJoinRequestService(
      repositories as unknown as ConstructorParameters<typeof FriendsGroupJoinRequestService>[0],
      adminAuthClient
    ),
  };
}

describe("FriendsGroupJoinRequestService", () => {
  it("creates a pending join request", async () => {
    const { repositories, service } = createService();

    await service.insertRequest({
      friendsGroupId: "group-1",
      userId: "user-b",
      message: "Let me in",
      userDisplayName: "Bianca",
    });

    expect(repositories.friendsGroupJoinRequests.upsertPendingRequest)
      .toHaveBeenCalledWith({
        friendsGroupId: "group-1",
        userId: "user-b",
        message: "Let me in",
        userDisplayName: "Bianca",
      });
  });

  it("lists pending requests and updates owner review status", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupJoinRequests.listPending.mockResolvedValue([
      joinRequestRow("request-1"),
    ]);
    repositories.friendsGroupJoinRequests.updateStatus.mockResolvedValue({
      id: "request-1",
      friends_group_id: "group-1",
      user_id: "user-b",
      status: "approved",
    });

    await expect(service.getPendingRequest("group-1")).resolves.toHaveLength(1);
    await expect(
      service.updateRequestStatus({
        requestId: "request-1",
        status: "approved",
        processedBy: "user-a",
      })
    ).resolves.toMatchObject({ status: "approved" });
  });

  it("enriches pending requests for an owner with requester display name and email", async () => {
    const { repositories, adminAuthClient, service } = createService();
    repositories.friendsGroupUsers.listOwnedGroupIdsForUser.mockResolvedValue([
      "group-1",
    ]);
    repositories.friendsGroupJoinRequests.listPendingForGroups.mockResolvedValue([
      { ...joinRequestRow("request-1"), friends_groups: { name: "Los Muchachos", slug: "los-muchachos" } },
    ]);
    repositories.profiles.listPreviewsByIds.mockResolvedValue([
      { id: "user-b", display_name: "Bianca", avatar_emoji: null, color_class: null },
    ]);
    adminAuthClient.auth.admin.getUserById.mockResolvedValue({
      data: { user: { email: "bianca@example.com" } },
    });

    const result = await service.getAllPendingRequestsForOwner("owner-1");

    expect(repositories.profiles.listPreviewsByIds).toHaveBeenCalledWith(["user-b"]);
    expect(adminAuthClient.auth.admin.getUserById).toHaveBeenCalledWith("user-b");
    expect(result).toEqual([
      expect.objectContaining({
        id: "request-1",
        requester: { display_name: "Bianca", email: "bianca@example.com" },
      }),
    ]);
  });

  it("returns no requests without a profile/email lookup when the owner has no groups", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listOwnedGroupIdsForUser.mockResolvedValue([]);

    await expect(service.getAllPendingRequestsForOwner("owner-1")).resolves.toEqual([]);
    expect(repositories.friendsGroupJoinRequests.listPendingForGroups).not.toHaveBeenCalled();
  });
});

function joinRequestRow(id: string): JoinRequestRow {
  return {
    id,
    friends_group_id: "group-1",
    user_id: "user-b",
    status: "pending",
    message: null,
    user_display_name: "Bianca",
    processed_at: null,
    processed_by: null,
    requested_at: "2026-08-01T10:00:00Z",
  };
}
