import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";

type JoinRequestUpdate =
  Database["public"]["Tables"]["friends_group_join_requests"]["Update"];
type FriendsGroupJoinRequestRepositories = Pick<
  Repositories,
  "friendsGroupJoinRequests" | "friendsGroupUsers"
>;

export default class FriendsGroupJoinRequestService {
  private readonly repositories: FriendsGroupJoinRequestRepositories;

  constructor(
    clientOrRepositories: SupabaseClient<Database> | FriendsGroupJoinRequestRepositories
  ) {
    this.repositories = isFriendsGroupJoinRequestRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
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

    return this.repositories.friendsGroupJoinRequests.listPendingForGroups(
      ownedGroupIds
    );
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
