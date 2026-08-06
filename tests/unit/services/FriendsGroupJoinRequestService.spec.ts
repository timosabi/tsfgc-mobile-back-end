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
        | "updateRequest"
        | "updateStatus"
        | "upsertPendingRequest"
      >
    >([
      "findReviewRef",
      "findStatus",
      "listForGroup",
      "listPending",
      "updateRequest",
      "updateStatus",
      "upsertPendingRequest",
    ]),
  };

  return {
    repositories,
    service: new FriendsGroupJoinRequestService(
      repositories as unknown as ConstructorParameters<typeof FriendsGroupJoinRequestService>[0]
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
