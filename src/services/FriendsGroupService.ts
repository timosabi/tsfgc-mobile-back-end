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

  async getOwnedFriendsGroup(userId: string): Promise<Pick<FriendsGroupRow, "id" | "name" | "slug"> | null> {
    return this.repositories.friendsGroups.findOwnedByUser(userId);
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
}

function isFriendsGroupRepositories(
  value: SupabaseClient<Database> | FriendsGroupRepositories
): value is FriendsGroupRepositories {
  return "friendsGroups" in value;
}
