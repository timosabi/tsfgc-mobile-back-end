import {
  ApiClient,
  assertEqual,
  assertTruthy,
  cleanupE2EData,
  configureE2EEnv,
  isolateMockCompetitionSeason,
  restoreCompetitionSeason,
  startTestServer,
  step,
} from "./helpers.js";
import {
  createFriendsGroup,
  joinOpenInvite,
  signUpAndSignIn,
} from "./flow-helpers.js";
import { MOCK_LEAGUE_8_SEASON_ID } from "../../src/integrations/sportmonks/mock-service.js";

type MembershipRef = { userId: string; role: "owner" | "member" };
type OwnerMemberListItem = {
  userId: string;
  role: "owner" | "member";
  canRemove: boolean;
  canTransferOwnership: boolean;
};

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "Supabase-e2e-password-123!";

configureE2EEnv();

const { supabaseService } = await import(
  "../../src/integrations/supabase/supabaseClient.js"
);

await cleanupE2EData(supabaseService, { friends: true, auth: true });
const originalSeasonId = await isolateMockCompetitionSeason(
  supabaseService,
  8,
  MOCK_LEAGUE_8_SEASON_ID
);
const server = await startTestServer();

try {
  const ownerClient = new ApiClient(server.baseUrl, "Owner");
  const memberClient = new ApiClient(server.baseUrl, "Member");
  const newOwnerClient = new ApiClient(server.baseUrl, "New Owner");

  step("Users sign up for owner-management flow");
  const owner = await signUpAndSignIn({
    client: ownerClient,
    email: `e2e-owner-management-owner-${runId}@example.com`,
    password,
    displayName: `E2E Owner Management Owner ${runId}`,
  });
  const member = await signUpAndSignIn({
    client: memberClient,
    email: `e2e-owner-management-member-${runId}@example.com`,
    password,
    displayName: `E2E Owner Management Member ${runId}`,
  });
  const newOwner = await signUpAndSignIn({
    client: newOwnerClient,
    email: `e2e-owner-management-new-owner-${runId}@example.com`,
    password,
    displayName: `E2E Owner Management New Owner ${runId}`,
  });

  step("Owner creates an open group and users join");
  const group = await createFriendsGroup({
    owner: ownerClient,
    name: "E2E Owner Management",
    slug: `e2e-owner-management-${runId}`,
    accessType: "open",
  });
  await joinOpenInvite({
    client: memberClient,
    inviteToken: group.data.invite_token,
  });
  await joinOpenInvite({
    client: newOwnerClient,
    inviteToken: group.data.invite_token,
  });

  step("Owner can fetch the member-management list");
  const ownerMembers = await ownerClient.get(
    `/friends-groups/${group.data.id}/members`
  );
  assertEqual(ownerMembers.data.length, 3, "member-management list includes all members");
  const ownerRow = ownerMembers.data.find(
    (row: OwnerMemberListItem) => row.userId === owner.id
  );
  const memberRow = ownerMembers.data.find(
    (row: OwnerMemberListItem) => row.userId === member.id
  );
  assertTruthy(ownerRow, "owner row exists in member-management list");
  assertTruthy(memberRow, "member row exists in member-management list");
  if (!ownerRow || !memberRow) {
    throw new Error("Member-management list is missing expected rows");
  }
  assertEqual(ownerRow.role, "owner", "owner row is marked as owner");
  assertEqual(ownerRow.canRemove, false, "owner cannot remove themselves");
  assertEqual(memberRow.canRemove, true, "owner can remove members");
  assertEqual(
    memberRow.canTransferOwnership,
    true,
    "owner can transfer ownership to members"
  );
  await memberClient.get(`/friends-groups/${group.data.id}/members`, 403);

  step("Owner cannot leave while other members remain");
  const blockedLeave = await ownerClient.request(
    "DELETE",
    `/friends-groups/${group.data.id}/leave`,
    undefined,
    409
  );
  assertTruthy(blockedLeave.error, "owner leave returns clear error while group has members");

  step("Only owner can kick members, and owner cannot kick themselves");
  await memberClient.request(
    "DELETE",
    `/friends-groups/${group.data.id}/members/${newOwner.id}`,
    undefined,
    403
  );
  await ownerClient.request(
    "DELETE",
    `/friends-groups/${group.data.id}/members/${owner.id}`,
    undefined,
    400
  );

  const kickResult = await ownerClient.request(
    "DELETE",
    `/friends-groups/${group.data.id}/members/${member.id}`
  );
  assertEqual(kickResult.data.status, "removed", "owner can kick a member");
  const membersAfterKick = await ownerClient.get(
    `/friends-groups/${group.data.id}/members`
  );
  assertEqual(
    membersAfterKick.data.some(
      (row: OwnerMemberListItem) => row.userId === member.id
    ),
    false,
    "kicked member is removed from owner member list"
  );
  await memberClient.get(
    `/friends-groups/${group.data.id}/matchweeks/current/overview`,
    403
  );

  step("Owner transfers ownership to an existing member");
  const transferResult = await ownerClient.post(
    `/friends-groups/${group.data.id}/transfer-ownership`,
    { newOwnerUserId: newOwner.id }
  );
  assertEqual(
    transferResult.data.status,
    "transferred",
    "ownership transfer succeeds"
  );

  const overviewAfterTransfer = await newOwnerClient.get(
    `/friends-groups/${group.data.id}/matchweeks/current/overview`
  );
  const oldOwnerMembership = overviewAfterTransfer.data.members.find(
    (row: MembershipRef) => row.userId === owner.id
  );
  const newOwnerMembership = overviewAfterTransfer.data.members.find(
    (row: MembershipRef) => row.userId === newOwner.id
  );
  assertEqual(oldOwnerMembership.role, "member", "old owner becomes member");
  assertEqual(newOwnerMembership.role, "owner", "new owner has owner role");
  await ownerClient.get(`/friends-groups/${group.data.id}/members`, 403);
  const newOwnerMembers = await newOwnerClient.get(
    `/friends-groups/${group.data.id}/members`
  );
  assertTruthy(
    newOwnerMembers.data.some(
      (row: OwnerMemberListItem) => row.userId === owner.id && row.canRemove
    ),
    "new owner can manage old owner as a member"
  );

  step("Old owner can leave and create a new group after transfer");
  const oldOwnerLeave = await ownerClient.request(
    "DELETE",
    `/friends-groups/${group.data.id}/leave`
  );
  assertEqual(oldOwnerLeave.data.status, "left", "old owner can leave as member");
  const oldOwnerNewGroup = await createFriendsGroup({
    owner: ownerClient,
    name: "E2E Owner Management Recreated",
    slug: `e2e-owner-management-recreated-${runId}`,
    accessType: "private",
  });
  assertEqual(
    oldOwnerNewGroup.data.status,
    "approved",
    "old owner can create another group after transfer"
  );

  step("Final owner leaving archives the group and frees ownership");
  const archived = await newOwnerClient.request(
    "DELETE",
    `/friends-groups/${group.data.id}/leave`
  );
  assertEqual(archived.data.status, "archived", "final owner leave archives group");

  const newOwnerGroups = await newOwnerClient.get("/friends-groups/me/groups");
  assertEqual(
    newOwnerGroups.data.some(
      (row: { friends_group: { id: string } }) =>
        row.friends_group.id === group.data.id
    ),
    false,
    "archived group disappears from my groups"
  );

  const { data: archivedGroup, error } = await supabaseService
    .from("friends_groups")
    .select("id, status")
    .eq("id", group.data.id)
    .single();
  if (error) throw new Error(`Read archived group failed: ${error.message}`);
  assertEqual(archivedGroup.status, "archived", "archived group row remains");

  const newOwnerNewGroup = await createFriendsGroup({
    owner: newOwnerClient,
    name: "E2E Owner Management Final Owner Recreated",
    slug: `e2e-owner-management-final-owner-recreated-${runId}`,
    accessType: "private",
  });
  assertEqual(
    newOwnerNewGroup.data.status,
    "approved",
    "final owner can create another group after archive"
  );

  console.log("\n[E2E] Friends group owner management passed.");
} finally {
  try {
    await server.close();
  } finally {
    await cleanupE2EData(supabaseService, { friends: true, auth: true });
    await restoreCompetitionSeason(supabaseService, 8, originalSeasonId);
  }
}
