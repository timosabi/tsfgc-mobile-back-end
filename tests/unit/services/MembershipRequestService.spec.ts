import MembershipRequestService from "../../../src/services/MembershipRequestService.js";
import type { Database } from "../../../src/integrations/supabase/types.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

function createService() {
  const repositories = {
    profiles: createRepositoryMock<
      Pick<Repositories["profiles"], "listByMembershipStatus" | "updateMembershipStatus">
    >(["listByMembershipStatus", "updateMembershipStatus"]),
  };

  return {
    repositories,
    service: new MembershipRequestService(
      repositories as unknown as ConstructorParameters<typeof MembershipRequestService>[0]
    ),
  };
}

describe("MembershipRequestService", () => {
  it("lists pending membership requests", async () => {
    const { repositories, service } = createService();
    repositories.profiles.listByMembershipStatus.mockResolvedValue([
      profileRow("user-b"),
    ]);

    await expect(service.listPending()).resolves.toHaveLength(1);
    expect(repositories.profiles.listByMembershipStatus).toHaveBeenCalledWith(
      "pending"
    );
  });

  it("approves a membership request", async () => {
    const { repositories, service } = createService();
    repositories.profiles.updateMembershipStatus.mockResolvedValue(
      profileRow("user-b", "approved")
    );

    await expect(
      service.approve("user-b", "admin-1", "welcome aboard")
    ).resolves.toMatchObject({ membership_status: "approved" });
    expect(repositories.profiles.updateMembershipStatus).toHaveBeenCalledWith(
      "user-b",
      { status: "approved", reviewedBy: "admin-1", reviewNote: "welcome aboard" }
    );
  });

  it("rejects a membership request", async () => {
    const { repositories, service } = createService();
    repositories.profiles.updateMembershipStatus.mockResolvedValue(
      profileRow("user-b", "rejected")
    );

    await expect(service.reject("user-b", "admin-1")).resolves.toMatchObject({
      membership_status: "rejected",
    });
    expect(repositories.profiles.updateMembershipStatus).toHaveBeenCalledWith(
      "user-b",
      { status: "rejected", reviewedBy: "admin-1", reviewNote: undefined }
    );
  });
});

function profileRow(id: string, membershipStatus = "pending"): ProfileRow {
  return {
    id,
    display_name: "Bianca",
    avatar_emoji: null,
    color_class: null,
    favorite_team: null,
    default_friends_group_id: null,
    last_active_friends_group_id: null,
    is_admin: false,
    points: 0,
    membership_status: membershipStatus,
    membership_reviewed_at: null,
    membership_reviewed_by: null,
    membership_review_note: null,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  };
}
