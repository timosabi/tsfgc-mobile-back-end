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
  findPendingJoinRequest,
  joinOpenInvite,
  requestPrivateInvite,
  signUpAndSignIn,
} from "./flow-helpers.js";
import { MOCK_LEAGUE_8_SEASON_ID } from "../../src/integrations/sportmonks/mock-service.js";

type MembershipRef = { userId: string; role: "owner" | "member" };

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
  const openOwnerClient = new ApiClient(server.baseUrl, "Open Owner");
  const privateOwnerClient = new ApiClient(server.baseUrl, "Private Owner");
  const memberClient = new ApiClient(server.baseUrl, "Joining Member");
  const rejectedClient = new ApiClient(server.baseUrl, "Rejected Member");

  step("Users sign up for open and private join flows");
  const openOwner = await signUpAndSignIn({
    client: openOwnerClient,
    email: `e2e-joining-open-owner-${runId}@example.com`,
    password,
    displayName: `E2E Joining Open Owner ${runId}`,
  });
  const privateOwner = await signUpAndSignIn({
    client: privateOwnerClient,
    email: `e2e-joining-private-owner-${runId}@example.com`,
    password,
    displayName: `E2E Joining Private Owner ${runId}`,
  });
  const member = await signUpAndSignIn({
    client: memberClient,
    email: `e2e-joining-member-${runId}@example.com`,
    password,
    displayName: `E2E Joining Member ${runId}`,
  });
  const rejected = await signUpAndSignIn({
    client: rejectedClient,
    email: `e2e-joining-rejected-${runId}@example.com`,
    password,
    displayName: `E2E Joining Rejected ${runId}`,
  });

  step("Open invite lets signed-in users join immediately");
  const openGroup = await createFriendsGroup({
    owner: openOwnerClient,
    name: "E2E Joining Open",
    slug: `e2e-joining-open-${runId}`,
    accessType: "open",
  });
  const preview = await memberClient.get(
    `/friends-groups/invite/${openGroup.data.invite_token}`
  );
  assertEqual(preview.data.accessType, "open", "open invite preview exposes access type");
  const openJoin = await joinOpenInvite({
    client: memberClient,
    inviteToken: openGroup.data.invite_token,
  });
  assertEqual(openJoin.status, "joined", "open invite joins immediately");

  const openMembers = await openOwnerClient.get(
    `/friends-groups/${openGroup.data.id}/matchweeks/current/overview`
  );
  const memberRow = openMembers.data.members.find(
    (row: MembershipRef) => row.userId === member.id
  );
  assertTruthy(memberRow, "open invite member appears in group");
  assertEqual(memberRow.role, "member", "open invite creates member role");

  const ownerJoin = await joinOpenInvite({
    client: openOwnerClient,
    inviteToken: openGroup.data.invite_token,
  });
  assertEqual(ownerJoin.status, "member", "owner invite join is idempotent");
  const openMembersAfterOwnerJoin = await openOwnerClient.get(
    `/friends-groups/${openGroup.data.id}/matchweeks/current/overview`
  );
  const ownerRows = openMembersAfterOwnerJoin.data.members.filter(
    (row: MembershipRef) => row.userId === openOwner.id
  );
  assertEqual(ownerRows.length, 1, "owner is not duplicated by invite join");

  step("Private invite creates pending requests for owner review");
  const privateGroup = await createFriendsGroup({
    owner: privateOwnerClient,
    name: "E2E Joining Private",
    slug: `e2e-joining-private-${runId}`,
    accessType: "private",
  });
  const privatePreview = await memberClient.get(
    `/friends-groups/invite/${privateGroup.data.invite_token}`
  );
  assertEqual(privatePreview.data.accessType, "private", "private invite preview exposes access type");
  const requested = await requestPrivateInvite({
    client: memberClient,
    inviteToken: privateGroup.data.invite_token,
  });
  assertEqual(requested.status, "requested", "private invite creates request");
  const request = await findPendingJoinRequest({
    owner: privateOwnerClient,
    friendsGroupId: privateGroup.data.id,
    userId: member.id,
  });
  await privateOwnerClient.post(`/friends-groups/requests/${request.id}/approve`);

  const privateMembers = await privateOwnerClient.get(
    `/friends-groups/${privateGroup.data.id}/matchweeks/current/overview`
  );
  assertTruthy(
    privateMembers.data.members.some((row: MembershipRef) => row.userId === member.id),
    "approved private request creates membership"
  );

  step("Private owner can reject another pending join request");
  await requestPrivateInvite({
    client: rejectedClient,
    inviteToken: privateGroup.data.invite_token,
  });
  const rejectedRequest = await findPendingJoinRequest({
    owner: privateOwnerClient,
    friendsGroupId: privateGroup.data.id,
    userId: rejected.id,
  });
  const rejection = await privateOwnerClient.post(
    `/friends-groups/requests/${rejectedRequest.id}/reject`
  );
  assertEqual(rejection.data.status, "rejected", "private request can be rejected");
  await rejectedClient.get(
    `/friends-groups/${privateGroup.data.id}/matchweeks/current/overview`,
    403
  );

  console.log("\n[E2E] Friends group joining passed.");
} finally {
  try {
    await server.close();
  } finally {
    await cleanupE2EData(supabaseService, { friends: true, auth: true });
    await restoreCompetitionSeason(supabaseService, 8, originalSeasonId);
  }
}
