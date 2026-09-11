import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";

type JoinRequestUpdate =
  Database["public"]["Tables"]["friends_group_join_requests"]["Update"];
type FriendsGroupJoinRequestRepositories = Pick<
  Repositories,
  "friendsGroupJoinRequests" | "friendsGroupUsers" | "profiles"
>;

// Narrow slice of the Supabase admin auth API this service needs, injected
// rather than importing the live supabaseService singleton directly -- that
// singleton throws at import time if Supabase env vars aren't set, which
// breaks unit tests that construct this service with mocked repositories.
export type AdminAuthClient = {
  auth: {
    admin: {
      getUserById(
        userId: string
      ): Promise<{ data: { user: { email?: string | null } | null } }>;
    };
  };
};

export default class FriendsGroupJoinRequestService {
  private readonly repositories: FriendsGroupJoinRequestRepositories;
  private readonly adminAuthClient?: AdminAuthClient;

  constructor(
    clientOrRepositories: SupabaseClient<Database> | FriendsGroupJoinRequestRepositories,
    adminAuthClient?: AdminAuthClient
  ) {
    this.repositories = isFriendsGroupJoinRequestRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
    this.adminAuthClient = adminAuthClient;
  }

  async getRequestStatus(userId: string, leagueId: string) {
    return this.repositories.friendsGroupJoinRequests.findStatus(userId, leagueId);
  }

  async getAllRequest(leagueId: string) {
    return this.repositories.friendsGroupJoinRequests.listForGroup(leagueId);
  }

  async getJoinRequest(requestId: string) {
    return this.repositories.friendsGroupJoinRequests.findReviewRef(requestId);
  }

  async insertRequest(payload: {
    friendsGroupId: string;
    userId: string;
    message?: string;
    userDisplayName?: string;
  }) {
    await this.repositories.friendsGroupJoinRequests.upsertPendingRequest(payload);
  }

  async getPendingRequest(leagueId: string) {
    return this.repositories.friendsGroupJoinRequests.listPending(leagueId);
  }

  async getAllPendingRequestsForOwner(userId: string) {
    const ownedGroupIds =
      await this.repositories.friendsGroupUsers.listOwnedGroupIdsForUser(userId);

    if (!ownedGroupIds.length) return [];

    const requests =
      await this.repositories.friendsGroupJoinRequests.listPendingForGroups(
        ownedGroupIds
      );

    if (!requests.length) return requests;

    const requesterIds = [...new Set(requests.map((request) => request.user_id))];

    const [profiles, emailsById] = await Promise.all([
      this.repositories.profiles.listPreviewsByIds(requesterIds),
      this.getEmailsByIds(requesterIds),
    ]);
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

    return requests.map((request) => ({
      ...request,
      requester: {
        display_name: profilesById.get(request.user_id)?.display_name ?? null,
        email: emailsById.get(request.user_id) ?? null,
      },
    }));
  }

  private async getEmailsByIds(userIds: string[]): Promise<Map<string, string | null>> {
    if (!this.adminAuthClient) {
      return new Map(userIds.map((id) => [id, null]));
    }

    const entries = await Promise.all(
      userIds.map(async (id) => {
        const { data } = await this.adminAuthClient!.auth.admin.getUserById(id);
        return [id, data.user?.email ?? null] as const;
      })
    );
    return new Map(entries);
  }

  async updateRequest(payload: { requestId: string; data: JoinRequestUpdate }) {
    await this.repositories.friendsGroupJoinRequests.updateRequest(payload);
  }

  async updateRequestStatus(payload: {
    requestId: string;
    status: "approved" | "rejected";
    processedBy: string;
  }) {
    return this.repositories.friendsGroupJoinRequests.updateStatus(payload);
  }
}

function isFriendsGroupJoinRequestRepositories(
  value: SupabaseClient<Database> | FriendsGroupJoinRequestRepositories
): value is FriendsGroupJoinRequestRepositories {
  return "friendsGroupJoinRequests" in value;
}
