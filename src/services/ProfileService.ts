import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
type EditableProfileFields = Pick<
  ProfileUpdate,
  | "display_name"
  | "avatar_emoji"
  | "color_class"
  | "favorite_team"
  | "default_friends_group_id"
  | "last_active_friends_group_id"
>;

type UpdateProfilePayload = {
  userId: string;
  data?: Partial<EditableProfileFields>;
};
type ProfileRepositories = Pick<Repositories, "profiles">;

export default class ProfileService {
  private readonly repositories: ProfileRepositories;

  constructor(clientOrRepositories: SupabaseClient<Database> | ProfileRepositories) {
    this.repositories = isProfileRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async getUsers(): Promise<ProfileRow[]> {
    return this.repositories.profiles.listAllProfiles();
  }

  async getUsersByLeaguesIds(leagueUserIds: string[]): Promise<ProfileRow[]> {
    return this.repositories.profiles.listByIds(leagueUserIds);
  }

  async getProfilesByUserIds(userIds: string[]) {
    return this.repositories.profiles.listPreviewsByIds(userIds);
  }

  async getUserName(userId: string) {
    return this.repositories.profiles.findDisplayName(userId);
  }

  async getProfileDataFromUsers(userIds: string[]) {
    return this.repositories.profiles.listNameAvatarByIds(userIds);
  }

  async getProfileData(userId: string) {
    return (await this.repositories.profiles.findProfileById(userId)) ?? {};
  }

  async updateProfileData(payload: UpdateProfilePayload) {
    const allowed: Array<keyof EditableProfileFields> = [
      "display_name",
      "avatar_emoji",
      "color_class",
      "favorite_team",
      "default_friends_group_id",
      "last_active_friends_group_id",
    ];
    const updates: Partial<EditableProfileFields> = {};
    for (const k of allowed) {
      if (payload.data?.[k] !== undefined) updates[k] = payload.data[k];
    }

    return this.repositories.profiles.upsertProfile({
      id: payload.userId,
      ...updates,
      updated_at: new Date().toISOString(),
    });
  }

  async getLastActiveLeague(userId: string) {
    return this.repositories.profiles.findLastActiveFriendsGroup(userId);
  }

  async upsertLastActiveLeague(userId: string, leagueId: string) {
    await this.repositories.profiles.updateLastActiveFriendsGroup(userId, leagueId);
    return { message: "Updated successfully" };
  }
}

function isProfileRepositories(
  value: SupabaseClient<Database> | ProfileRepositories
): value is ProfileRepositories {
  return "profiles" in value;
}
