import FriendsGroupService from "../../../src/services/FriendsGroupService.js";
import type { Database } from "../../../src/integrations/supabase/types.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

type FriendsGroupRow = Database["public"]["Tables"]["friends_groups"]["Row"];

function createService() {
  const repositories = {
    friendsGroups: createRepositoryMock<
      Pick<
        Repositories["friendsGroups"],
        | "createFriendsGroup"
        | "findByInviteToken"
        | "findById"
        | "slugMatches"
      >
    >([
      "createFriendsGroup",
      "findByInviteToken",
      "findById",
      "slugMatches",
    ]),
  };

  return {
    repositories,
    service: new FriendsGroupService(
      repositories as unknown as ConstructorParameters<typeof FriendsGroupService>[0]
    ),
  };
}

describe("FriendsGroupService", () => {
  it("creates and fetches friends groups through repositories", async () => {
    const { repositories, service } = createService();
    const row = friendsGroupRow("group-1");
    repositories.friendsGroups.createFriendsGroup.mockResolvedValue(row);
    repositories.friendsGroups.findByInviteToken.mockResolvedValue(row);

    await expect(
      service.createFriendsGroup({
        name: "Los Muchachos",
        slug: "los-muchachos",
        created_by: "user-a",
      })
    ).resolves.toMatchObject({ id: "group-1" });
    await expect(service.getFriendsGroupByInviteToken("invite-1")).resolves
      .toMatchObject({ slug: "los-muchachos" });
  });

  it("reads slug availability through repositories", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroups.slugMatches.mockResolvedValue([{ id: "group-1" }]);

    await expect(service.isSlugAvailable("los-muchachos")).resolves.toBe(false);

    repositories.friendsGroups.slugMatches.mockResolvedValue([]);
    await expect(service.isSlugAvailable("fresh-slug")).resolves.toBe(true);
  });
});

function friendsGroupRow(
  id: string,
  overrides: Partial<FriendsGroupRow> = {}
): FriendsGroupRow {
  return {
    id,
    name: "Los Muchachos",
    slug: "los-muchachos",
    created_by: "user-a",
    invite_token: "invite-1",
    is_open: true,
    status: "pending",
    review_note: null,
    reviewed_at: null,
    reviewed_by: null,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}
