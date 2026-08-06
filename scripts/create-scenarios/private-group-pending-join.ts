import "dotenv/config";
import { supabaseService } from "../../src/integrations/supabase/supabaseClient.js";
import { createSportMonksServices } from "../../src/integrations/sportmonks/index.js";
import AuthService from "../../src/services/AuthService.js";
import FriendsGroupJoinRequestService from "../../src/services/FriendsGroupJoinRequestService.js";
import FriendsGroupService from "../../src/services/FriendsGroupService.js";
import FriendsGroupSubscriptionService from "../../src/services/FriendsGroupSubscriptionService.js";
import FriendsGroupUsersService from "../../src/services/FriendsGroupUsersService.js";
import type { Database } from "../../src/integrations/supabase/types.js";
import {
  assertLocalSupabaseUrl,
  assertSupabaseApiReachable,
  printDevScenarioErrorAndExit,
} from "./lib/dev-scenario-utils.js";

type DevUser = {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "member" | "pending-member";
  description: string;
};

const scenarioName = "private-group-pending-join";
const password = "Password123!";
const runId = new Date()
  .toISOString()
  .replace(/\D/g, "")
  .slice(0, 14);
const suffix = `${runId}-${Math.random().toString(36).slice(2, 8)}`;

assertLocalSupabaseUrl(process.env.LOVABLE_SUPABASE_URL);
process.env.SPORTMONKS_USE_MOCK = "true";
process.env.CRON_ENABLED = "false";
await assertSupabaseApiReachable(process.env.LOVABLE_SUPABASE_URL).catch(
  printDevScenarioErrorAndExit
);

const auth = new AuthService(supabaseService);
const friendsGroupService = new FriendsGroupService(supabaseService);
const friendsGroupUsers = new FriendsGroupUsersService(supabaseService);
const joinRequests = new FriendsGroupJoinRequestService(supabaseService);
const subscriptions = new FriendsGroupSubscriptionService(supabaseService);
const { hydration } = createSportMonksServices(supabaseService);

const users = {
  owner: await createDevUser(
    "owner",
    "Private Group Owner",
    "Owns private group and can approve pending member"
  ),
  member: await createDevUser(
    "member",
    "Private Group Member",
    "Already accepted member in private group"
  ),
  pending: await createDevUser(
    "pending-member",
    "Pending Member",
    "Has pending join request waiting for owner approval"
  ),
};

const group = await friendsGroupService.createFriendsGroup({
  name: `Dev Seed Private ${suffix}`,
  slug: `dev-seed-private-${suffix}`,
  created_by: users.owner.id,
  is_open: false,
  status: "approved",
});

await friendsGroupUsers.joinFriendsGroup({
  friendsGroupId: group.id,
  userId: users.owner.id,
  role: "owner",
});
await friendsGroupUsers.joinFriendsGroup({
  friendsGroupId: group.id,
  userId: users.member.id,
  role: "member",
});

const subscriptionResult = await subscriptions.subscribe({
  friendsGroupId: group.id,
  createdBy: users.owner.id,
  providerLeagueId: 8,
  providerSeasonId: 25583,
  competitionName: "Premier League",
  countryName: "England",
  seasonName: "2025/2026",
  logoUrl: "https://cdn.sportmonks.com/images/soccer/leagues/8/8.png",
  status: "active",
});

const hydrationResult = await hydration.hydrateLeagueSeason(8, 25583);

await joinRequests.insertRequest({
  friendsGroupId: group.id,
  userId: users.pending.id,
  userDisplayName: users.pending.displayName,
  message: "Dev seed pending join request",
});

const pendingRequest = await findPendingJoinRequest(group.id, users.pending.id);

printScenario({
  users: [users.owner, users.member, users.pending],
  friendsGroupId: group.id,
  friendsGroupName: group.name,
  slug: group.slug,
  inviteToken: group.invite_token,
  joinLink: `/join/${group.invite_token}`,
  pendingJoinRequestId: pendingRequest.id,
  subscriptionStatus: subscriptionResult.subscription.status,
  fixturesSynced: hydrationResult.fixturesSynced,
});

async function createDevUser(
  role: DevUser["role"],
  name: string,
  description: string
): Promise<DevUser> {
  const displayName = `Dev Seed ${role} - ${name} - ${suffix}`;
  const email = `dev-seed-${role}-${suffix}@example.com`;
  const { data, error } = await supabaseService.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });

  if (error) throw new Error(`Create ${role} user failed: ${error.message}`);
  if (!data.user) throw new Error(`Create ${role} user failed: missing user`);

  await auth.upsertProfileForUser({
    userId: data.user.id,
    email,
    displayName,
  });

  return {
    id: data.user.id,
    email,
    displayName,
    role,
    description,
  };
}

async function findPendingJoinRequest(friendsGroupId: string, userId: string) {
  const { data, error } = await supabaseService
    .from("friends_group_join_requests")
    .select("id, status")
    .eq("friends_group_id", friendsGroupId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .single();

  if (error) throw new Error(`Read pending join request failed: ${error.message}`);
  return data as Pick<
    Database["public"]["Tables"]["friends_group_join_requests"]["Row"],
    "id" | "status"
  >;
}

function printScenario(params: {
  users: DevUser[];
  friendsGroupId: string;
  friendsGroupName: string;
  slug: string;
  inviteToken: string;
  joinLink: string;
  pendingJoinRequestId: string;
  subscriptionStatus: string;
  fixturesSynced: number;
}) {
  console.log("");
  console.log("============================================================");
  console.log(`DEV SCENARIO: ${scenarioName}`);
  console.log("============================================================");
  console.log(`Run id: ${suffix}`);
  console.log(`Shared password for every user: ${password}`);
  console.log("");
  console.log("COPY/PASTE LOGIN USERS");
  console.log("------------------------------------------------------------");
  for (const user of params.users) {
    console.log(`${user.role.toUpperCase()}`);
    console.log(`name: ${user.displayName}`);
    console.log(`email: ${user.email}`);
    console.log(`password: ${password}`);
    console.log(`userId: ${user.id}`);
    console.log(`state: ${user.description}`);
    console.log("");
  }
  console.log("PRIVATE GROUP");
  console.log("------------------------------------------------------------");
  console.log(`name: ${params.friendsGroupName}`);
  console.log(`slug: ${params.slug}`);
  console.log(`friendsGroupId: ${params.friendsGroupId}`);
  console.log(`inviteToken: ${params.inviteToken}`);
  console.log(`joinLink: ${params.joinLink}`);
  console.log(`pendingJoinRequestId: ${params.pendingJoinRequestId}`);
  console.log(`subscriptionStatus: ${params.subscriptionStatus}`);
  console.log(`fixturesSynced: ${params.fixturesSynced}`);
  console.log("");
  console.log("QUICK TEST FLOW");
  console.log("------------------------------------------------------------");
  console.log("- owner logs in and sees private group");
  console.log("- member logs in and sees same group as member");
  console.log("- pending user logs in and has pending join request");
  console.log("- owner approves pending request from FE");
  console.log("- rerun script to create fresh users/group/request");
  console.log("============================================================");
  console.log("");
}
