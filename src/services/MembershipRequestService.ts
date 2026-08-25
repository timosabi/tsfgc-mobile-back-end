import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";

type MembershipRequestRepositories = Pick<Repositories, "profiles">;

export default class MembershipRequestService {
  private readonly repositories: MembershipRequestRepositories;

  constructor(
    clientOrRepositories: SupabaseClient<Database> | MembershipRequestRepositories
  ) {
    this.repositories = isMembershipRequestRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async listPending() {
    return this.repositories.profiles.listByMembershipStatus("pending");
  }

  async approve(userId: string, reviewerId: string, note?: string) {
    return this.repositories.profiles.updateMembershipStatus(userId, {
      status: "approved",
      reviewedBy: reviewerId,
      reviewNote: note,
    });
  }

  async reject(userId: string, reviewerId: string, note?: string) {
    return this.repositories.profiles.updateMembershipStatus(userId, {
      status: "rejected",
      reviewedBy: reviewerId,
      reviewNote: note,
    });
  }
}

function isMembershipRequestRepositories(
  value: SupabaseClient<Database> | MembershipRequestRepositories
): value is MembershipRequestRepositories {
  return "profiles" in value;
}
