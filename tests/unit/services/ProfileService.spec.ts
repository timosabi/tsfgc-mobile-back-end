import ProfileService from "../../../src/services/ProfileService.js";
import type { Database } from "../../../src/integrations/supabase/types.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

function createService() {
  const repositories = {
    profiles: createRepositoryMock<
      Pick<
        Repositories["profiles"],
        | "findProfileById"
        | "listAllProfiles"
        | "listByIds"
        | "listPreviewsByIds"
        | "updateLastActiveFriendsGroup"
        | "upsertProfile"
      >
    >([
      "findProfileById",
      "listAllProfiles",
      "listByIds",
      "listPreviewsByIds",
      "updateLastActiveFriendsGroup",
      "upsertProfile",
    ]),
  };

  return {
    repositories,
    service: new ProfileService(
      repositories as unknown as ConstructorParameters<typeof ProfileService>[0]
    ),
  };
}

describe("ProfileService", () => {
  it("returns an empty object when profile data is missing", async () => {
    const { repositories, service } = createService();
    repositories.profiles.findProfileById.mockResolvedValue(null);

    await expect(service.getProfileData("user-a")).resolves.toEqual({});
  });

  it("upserts only editable profile fields", async () => {
    const { repositories, service } = createService();
    repositories.profiles.upsertProfile.mockResolvedValue(profileRow("user-a"));

    await service.updateProfileData({
      userId: "user-a",
      data: {
        display_name: "Alex",
        favorite_team: "Arsenal",
      },
    });

    expect(repositories.profiles.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-a",
        display_name: "Alex",
        favorite_team: "Arsenal",
        updated_at: expect.any(String),
      })
    );
  });

  it("updates the last active friends group", async () => {
    const { repositories, service } = createService();

    await expect(service.upsertLastActiveLeague("user-a", "group-1")).resolves
      .toEqual({ message: "Updated successfully" });
    expect(repositories.profiles.updateLastActiveFriendsGroup).toHaveBeenCalledWith(
      "user-a",
      "group-1"
    );
  });
});

function profileRow(id: string): ProfileRow {
  return {
    id,
    display_name: "Alex",
    avatar_emoji: "A",
    color_class: "blue",
    favorite_team: "Arsenal",
    default_friends_group_id: null,
    last_active_friends_group_id: null,
    is_admin: false,
    points: 0,
    membership_status: "approved",
    membership_reviewed_at: null,
    membership_reviewed_by: null,
    membership_review_note: null,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  };
}
