import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";

type FriendsGroupInsert =
  Database["public"]["Tables"]["friends_groups"]["Insert"];
type FriendsGroupRow = Database["public"]["Tables"]["friends_groups"]["Row"];
type FriendsGroupRepositories = Pick<
  Repositories,
  "friendsGroups"
>;

export default class FriendsGroupService {
  private readonly repositories: FriendsGroupRepositories;

  constructor(clientOrRepositories: SupabaseClient<Database> | FriendsGroupRepositories) {
    this.repositories = isFriendsGroupRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async getFriendsGroupRecord(friendsGroupId: string) {
    return this.repositories.friendsGroups.findById(friendsGroupId);
  }

  async getFriendsGroupByInviteToken(inviteToken: string): Promise<FriendsGroupRow | null> {
    return this.repositories.friendsGroups.findByInviteToken(inviteToken);
  }

  async isSlugAvailable(slug: string) {
    const matches = await this.repositories.friendsGroups.slugMatches(slug);
    return matches.length === 0;
  }

  async createFriendsGroup(payload: FriendsGroupInsert) {
    return this.repositories.friendsGroups.createFriendsGroup(payload);
  }

  async listAllGroupsForAdmin() {
    const groups = await this.repositories.friendsGroups.listAllApproved();

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      slug: group.slug,
      accessType: group.is_open ? "open" : "private",
      invite_token: group.invite_token,
    }));
  }
}

function isFriendsGroupRepositories(
  value: SupabaseClient<Database> | FriendsGroupRepositories
): value is FriendsGroupRepositories {
  return "friendsGroups" in value;
}
