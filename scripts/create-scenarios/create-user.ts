import "dotenv/config";
import { argv, env } from "node:process";
import { supabaseService } from "../../src/integrations/supabase/supabaseClient.js";
import { createSportMonksServices } from "../../src/integrations/sportmonks/index.js";
import AuthService from "../../src/services/AuthService.js";
import FriendsGroupService from "../../src/services/FriendsGroupService.js";
import FriendsGroupSubscriptionService from "../../src/services/FriendsGroupSubscriptionService.js";
import FriendsGroupUsersService from "../../src/services/FriendsGroupUsersService.js";
import type { Database } from "../../src/integrations/supabase/types.js";
import {
  askRadioChoice,
  assertLocalSupabaseUrl,
  assertSupabaseApiReachable,
  createCliPrompts,
  printDevScenarioErrorAndExit,
} from "./lib/dev-scenario-utils.js";

type UserScenarioRole = "standalone" | "owner" | "member";
type FriendsGroupSummary = Pick<
  Database["public"]["Tables"]["friends_groups"]["Row"],
  "id" | "name" | "slug" | "invite_token" | "is_open" | "status" | "created_at"
>;
type CreatedDevUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserScenarioRole;
};
type CreatedOwnerGroup = {
  id: string;
  name: string;
  slug: string;
  inviteToken: string;
  joinLink: string;
  subscriptionStatus: string;
  fixturesSynced: number;
};

const scenarioName = "create-user";
const password = "Password123!";
const runId = new Date()
  .toISOString()
  .replace(/\D/g, "")
  .slice(0, 14);
const suffix = `${runId}-${Math.random().toString(36).slice(2, 8)}`;

assertLocalSupabaseUrl(env.LOVABLE_SUPABASE_URL);
env.SPORTMONKS_USE_MOCK = "true";
env.CRON_ENABLED = "false";
await assertSupabaseApiReachable(env.LOVABLE_SUPABASE_URL).catch(
  printDevScenarioErrorAndExit
);

const rl = createCliPrompts();
const auth = new AuthService(supabaseService);
const friendsGroupService = new FriendsGroupService(supabaseService);
const friendsGroupUsers = new FriendsGroupUsersService(supabaseService);
const subscriptions = new FriendsGroupSubscriptionService(supabaseService);
const { hydration } = createSportMonksServices(supabaseService);

try {
  const role = await chooseRole();
  const user = await createDevUser(role);
  const groupResult =
    role === "owner"
      ? await createOwnerGroup(user.id)
      : role === "member"
        ? await addUserToSelectedGroup(user.id)
        : null;

  printScenario({ user, groupResult });
} finally {
  rl.close();
}

async function chooseRole(): Promise<UserScenarioRole> {
  const roleArg = readArg("role");
  if (isUserScenarioRole(roleArg)) return roleArg;

  console.log("");
  console.log("Create User Scenario");
  console.log("------------------------------------------------------------");

  return askRadioChoice({
    rl,
    argName: "role",
    label: "User type",
    choices: ["standalone", "owner", "member"] as const,
    defaultValue: "standalone",
    formatChoice: (role) => {
      if (role === "standalone") return "standalone - brand new user, no group assigned";
      if (role === "owner") return "owner - brand new user owning a new private group";
      return "member - brand new user added to an existing group";
    },
  });
}

async function createDevUser(role: UserScenarioRole): Promise<CreatedDevUser> {
  const labelByRole: Record<UserScenarioRole, string> = {
    standalone: "Brand New User",
    owner: "Group Owner",
    member: "Group Member",
  };
  const displayName = `Dev Seed ${role} - ${labelByRole[role]} - ${suffix}`;
  const email = `dev-seed-${role}-user-${suffix}@example.com`;
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

  return { id: data.user.id, email, displayName, role };
}

async function createOwnerGroup(userId: string): Promise<CreatedOwnerGroup> {
  const group = await friendsGroupService.createFriendsGroup({
    name: `Dev Seed Owner Group ${suffix}`,
    slug: `dev-seed-owner-group-${suffix}`,
    created_by: userId,
    is_open: false,
    status: "approved",
  });

  await friendsGroupUsers.joinFriendsGroup({
    friendsGroupId: group.id,
    userId,
    role: "owner",
  });

  const subscriptionResult = await subscriptions.subscribe({
    friendsGroupId: group.id,
    createdBy: userId,
    providerLeagueId: 8,
    providerSeasonId: 25583,
    competitionName: "Premier League",
    countryName: "England",
    seasonName: "2025/2026",
    logoUrl: "https://cdn.sportmonks.com/images/soccer/leagues/8/8.png",
    status: "active",
  });

  const hydrationResult = await hydration.hydrateLeagueSeason(8, 25583);

  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    inviteToken: group.invite_token,
    joinLink: `/join/${group.invite_token}`,
    subscriptionStatus: subscriptionResult.subscription.status,
    fixturesSynced: hydrationResult.fixturesSynced,
  };
}

async function addUserToSelectedGroup(
  userId: string
): Promise<FriendsGroupSummary> {
  const group = await selectFriendsGroup();
  await friendsGroupUsers.joinFriendsGroup({
    friendsGroupId: group.id,
    userId,
    role: "member",
  });
  return group;
}

async function selectFriendsGroup(): Promise<FriendsGroupSummary> {
  const friendsGroupId = readArg("friendsGroupId");
  if (friendsGroupId) {
    const group = await getFriendsGroupById(friendsGroupId);
    if (!group) throw new Error(`No friends group found for id: ${friendsGroupId}`);
    return group;
  }

  const inviteToken = readArg("inviteToken");
  if (inviteToken) {
    const group = await getFriendsGroupByInviteToken(inviteToken);
    if (!group) throw new Error(`No friends group found for invite token: ${inviteToken}`);
    return group;
  }

  const groups = await listRecentFriendsGroups();
  if (groups.length === 0) {
    throw new Error(
      "No approved friends groups found. Create one first with role=owner or run seed:scenario:private-group-pending-join."
    );
  }

  const choices = groups.map((group) => group.id);
  const selectedGroupId = await askRadioChoice({
    rl,
    argName: "selectedFriendsGroupId",
    label: "Existing friends group",
    choices,
    defaultValue: choices[0],
    formatChoice: (groupId, index) => {
      const group = groups[index];
      const access = group.is_open ? "open" : "private";
      return `${group.name} | ${access} | ${group.slug} | ${groupId}`;
    },
  });
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  if (!selectedGroup) {
    throw new Error(`Invalid friends group selection: ${selectedGroupId}`);
  }
  return selectedGroup;
}

async function listRecentFriendsGroups(): Promise<FriendsGroupSummary[]> {
  const { data, error } = await supabaseService
    .from("friends_groups")
    .select("id, name, slug, invite_token, is_open, status, created_at")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(`List friends groups failed: ${error.message}`);
  return data ?? [];
}

async function getFriendsGroupById(
  friendsGroupId: string
): Promise<FriendsGroupSummary | null> {
  const { data, error } = await supabaseService
    .from("friends_groups")
    .select("id, name, slug, invite_token, is_open, status, created_at")
    .eq("id", friendsGroupId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Read friends group failed: ${error.message}`);
  }
  return data;
}

async function getFriendsGroupByInviteToken(
  inviteToken: string
): Promise<FriendsGroupSummary | null> {
  const { data, error } = await supabaseService
    .from("friends_groups")
    .select("id, name, slug, invite_token, is_open, status, created_at")
    .eq("invite_token", inviteToken)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Read friends group by invite token failed: ${error.message}`);
  }
  return data;
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const raw = argv.find((arg) => arg.startsWith(prefix));
  return raw?.slice(prefix.length).trim() || undefined;
}

function isUserScenarioRole(value: string | undefined): value is UserScenarioRole {
  return value === "standalone" || value === "owner" || value === "member";
}

function printScenario(params: {
  user: CreatedDevUser;
  groupResult: CreatedOwnerGroup | FriendsGroupSummary | null;
}) {
  console.log("");
  console.log("============================================================");
  console.log(`DEV SCENARIO: ${scenarioName}`);
  console.log("============================================================");
  console.log(`Run id: ${suffix}`);
  console.log(`Selected user type: ${params.user.role}`);
  console.log(`Shared password: ${password}`);
  console.log("");
  console.log("COPY/PASTE LOGIN USER");
  console.log("------------------------------------------------------------");
  console.log(`name: ${params.user.displayName}`);
  console.log(`email: ${params.user.email}`);
  console.log(`password: ${password}`);
  console.log(`userId: ${params.user.id}`);
  console.log("");

  if (!params.groupResult) {
    console.log("GROUP STATE");
    console.log("------------------------------------------------------------");
    console.log("This user has no friends group assigned yet.");
    console.log("Use this login to test onboarding, empty dashboard, or group creation.");
  } else if ("fixturesSynced" in params.groupResult) {
    console.log("OWNER GROUP CREATED");
    console.log("------------------------------------------------------------");
    console.log(`name: ${params.groupResult.name}`);
    console.log(`slug: ${params.groupResult.slug}`);
    console.log(`friendsGroupId: ${params.groupResult.id}`);
    console.log(`inviteToken: ${params.groupResult.inviteToken}`);
    console.log(`joinLink: ${params.groupResult.joinLink}`);
    console.log(`subscriptionStatus: ${params.groupResult.subscriptionStatus}`);
    console.log(`fixturesSynced: ${params.groupResult.fixturesSynced}`);
    console.log("");
    console.log("Quick test: log in, open owner group, check fixtures/overview, share join link.");
  } else {
    const access = params.groupResult.is_open ? "open" : "private";
    console.log("MEMBER GROUP ASSIGNED");
    console.log("------------------------------------------------------------");
    console.log(`name: ${params.groupResult.name}`);
    console.log(`slug: ${params.groupResult.slug}`);
    console.log(`friendsGroupId: ${params.groupResult.id}`);
    console.log(`inviteToken: ${params.groupResult.invite_token}`);
    console.log(`joinLink: /join/${params.groupResult.invite_token}`);
    console.log(`accessType: ${access}`);
    console.log("");
    console.log("Quick test: log in, confirm user sees this group as member.");
  }

  console.log("============================================================");
  console.log("");
}
