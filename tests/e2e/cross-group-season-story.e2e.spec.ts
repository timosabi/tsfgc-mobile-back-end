import {
  ApiClient,
  assertEqual,
  assertTruthy,
  cleanupE2EData,
  configureE2EEnv,
  startTestServer,
  step,
} from "./helpers.js";
import {
  createFriendsGroup,
  findPendingJoinRequest,
  fixtureByTeams,
  fixturesForMatchweek,
  joinOpenInvite,
  requestPrivateInvite,
  saveAndSubmitSlip,
  signUpAndSignIn,
} from "./flow-helpers.js";

type LeaderboardRow = { user_id: string; points: number; rank: number };
type OverviewScoreRow = { user_id: string; points_earned: number };

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "Supabase-e2e-password-123!";
const adminEmail = `e2e-cross-admin-${runId}@example.com`;
const matchweek = "Matchweek 2";

configureE2EEnv(adminEmail);

const { supabaseService } = await import(
  "../../src/integrations/supabase/supabaseClient.js"
);

await cleanupE2EData(supabaseService, { friends: true, auth: true });
const server = await startTestServer();

try {
  const adminClient = new ApiClient(server.baseUrl, "Cross Admin");
  const aliceClient = new ApiClient(server.baseUrl, "Alice");
  const bobClient = new ApiClient(server.baseUrl, "Bob");
  const cleoClient = new ApiClient(server.baseUrl, "Cleo");
  const danaClient = new ApiClient(server.baseUrl, "Dana");

  step("Four users sign up, including one admin for backend jobs");
  await signUpAndSignIn({
    client: adminClient,
    email: adminEmail,
    password,
    displayName: `E2E Cross Admin ${runId}`,
  });
  const alice = await signUpAndSignIn({
    client: aliceClient,
    email: `e2e-cross-alice-${runId}@example.com`,
    password,
    displayName: `E2E Cross Alice ${runId}`,
  });
  const bob = await signUpAndSignIn({
    client: bobClient,
    email: `e2e-cross-bob-${runId}@example.com`,
    password,
    displayName: `E2E Cross Bob ${runId}`,
  });
  const cleo = await signUpAndSignIn({
    client: cleoClient,
    email: `e2e-cross-cleo-${runId}@example.com`,
    password,
    displayName: `E2E Cross Cleo ${runId}`,
  });
  const dana = await signUpAndSignIn({
    client: danaClient,
    email: `e2e-cross-dana-${runId}@example.com`,
    password,
    displayName: `E2E Cross Dana ${runId}`,
  });

  step("Users create open/private groups and join across groups");
  const aliceOpen = await createFriendsGroup({
    owner: aliceClient,
    name: "Alice Open Group",
    slug: `e2e-cross-alice-open-${runId}`,
    accessType: "open",
  });
  const cleoPrivate = await createFriendsGroup({
    owner: cleoClient,
    name: "Cleo Private Group",
    slug: `e2e-cross-cleo-private-${runId}`,
    accessType: "private",
  });
  const danaOpen = await createFriendsGroup({
    owner: danaClient,
    name: "Dana Open Group",
    slug: `e2e-cross-dana-open-${runId}`,
    accessType: "open",
  });

  await joinOpenInvite({ client: bobClient, inviteToken: aliceOpen.data.invite_token });
  await joinOpenInvite({ client: bobClient, inviteToken: danaOpen.data.invite_token });
  await requestPrivateInvite({
    client: aliceClient,
    inviteToken: cleoPrivate.data.invite_token,
  });
  const alicePrivateRequest = await findPendingJoinRequest({
    owner: cleoClient,
    friendsGroupId: cleoPrivate.data.id,
    userId: alice.id,
  });
  await cleoClient.post(`/friends-groups/requests/${alicePrivateRequest.id}/approve`);

  const aliceGroups = await aliceClient.get("/friends-groups/me/groups");
  assertTruthy(
    aliceGroups.data.some(
      (row: { friends_group: { id: string } }) =>
        row.friends_group.id === aliceOpen.data.id
    ),
    "Alice owns her open group"
  );
  assertTruthy(
    aliceGroups.data.some(
      (row: { friends_group: { id: string } }) =>
        row.friends_group.id === cleoPrivate.data.id
    ),
    "Alice can also be member of Cleo private group"
  );
  await bobClient.get(
    `/friends-groups/${cleoPrivate.data.id}/matchweeks/current/overview`,
    403
  );

  step("Different groups submit predictions for the same matchweek");
  const aliceOpenFixtures = await fixturesForMatchweek({
    client: aliceClient,
    friendsGroupId: aliceOpen.data.id,
    matchweek,
  });
  const cleoPrivateFixtures = await fixturesForMatchweek({
    client: cleoClient,
    friendsGroupId: cleoPrivate.data.id,
    matchweek,
  });
  const aliceOpenArsenal = fixtureByTeams(
    aliceOpenFixtures,
    "Arsenal",
    "Liverpool"
  );
  const aliceOpenChelsea = fixtureByTeams(
    aliceOpenFixtures,
    "Chelsea",
    "Manchester City"
  );
  const cleoPrivateArsenal = fixtureByTeams(
    cleoPrivateFixtures,
    "Arsenal",
    "Liverpool"
  );
  const cleoPrivateChelsea = fixtureByTeams(
    cleoPrivateFixtures,
    "Chelsea",
    "Manchester City"
  );

  await saveAndSubmitSlip({
    client: aliceClient,
    friendsGroupId: aliceOpen.data.id,
    matchweek,
    predictions: [
      { fixtureId: aliceOpenArsenal.id, homeScore: 2, awayScore: 1 },
      { fixtureId: aliceOpenChelsea.id, homeScore: 1, awayScore: 2 },
    ],
    redCardFixtureId: aliceOpenArsenal.id,
  });
  await saveAndSubmitSlip({
    client: bobClient,
    friendsGroupId: aliceOpen.data.id,
    matchweek,
    predictions: [
      { fixtureId: aliceOpenArsenal.id, homeScore: 1, awayScore: 1 },
      { fixtureId: aliceOpenChelsea.id, homeScore: 0, awayScore: 2 },
    ],
    redCardFixtureId: aliceOpenChelsea.id,
  });
  await saveAndSubmitSlip({
    client: cleoClient,
    friendsGroupId: cleoPrivate.data.id,
    matchweek,
    predictions: [
      { fixtureId: cleoPrivateArsenal.id, homeScore: 2, awayScore: 1 },
      { fixtureId: cleoPrivateChelsea.id, homeScore: 1, awayScore: 2 },
    ],
    redCardFixtureId: cleoPrivateArsenal.id,
  });
  await saveAndSubmitSlip({
    client: aliceClient,
    friendsGroupId: cleoPrivate.data.id,
    matchweek,
    predictions: [
      { fixtureId: cleoPrivateArsenal.id, homeScore: 1, awayScore: 1 },
      { fixtureId: cleoPrivateChelsea.id, homeScore: 0, awayScore: 2 },
    ],
    redCardFixtureId: cleoPrivateChelsea.id,
  });

  step("Kickoff lock hides no longer editable state and later finished scoring is group-isolated");
  await adminClient.post("/admin/fixtures/hydrate/finished", { days: 30 });
  await aliceClient.put(
    `/friends-groups/${aliceOpen.data.id}/matchweeks/${encodeURIComponent(
      matchweek
    )}/predictions/mine`,
    {
      predictions: [
        { fixtureId: aliceOpenArsenal.id, homeScore: 0, awayScore: 0 },
        { fixtureId: aliceOpenChelsea.id, homeScore: 0, awayScore: 0 },
      ],
      redCardFixtureId: aliceOpenArsenal.id,
    },
    409
  );

  await adminClient.post(`/weekly-score/${aliceOpen.data.id}/calculate`, {
    matchweek,
  });
  await adminClient.post(`/weekly-score/${cleoPrivate.data.id}/calculate`, {
    matchweek,
  });

  const aliceOpenLeaderboard = await aliceClient.get(
    `/weekly-score/${aliceOpen.data.id}/leaderboard`
  );
  const cleoPrivateLeaderboard = await cleoClient.get(
    `/weekly-score/${cleoPrivate.data.id}/leaderboard`
  );
  assertLeaderboardTop(aliceOpenLeaderboard.data, alice.id, 11, "Alice open group");
  assertLeaderboardTop(cleoPrivateLeaderboard.data, cleo.id, 11, "Cleo private group");

  const aliceOpenOverview = await aliceClient.get(
    `/friends-groups/${aliceOpen.data.id}/matchweeks/${encodeURIComponent(
      matchweek
    )}/overview`
  );
  const cleoPrivateOverview = await aliceClient.get(
    `/friends-groups/${cleoPrivate.data.id}/matchweeks/${encodeURIComponent(
      matchweek
    )}/overview`
  );
  assertEqual(aliceOpenOverview.data.state, "finished", "Alice group week is finished");
  assertEqual(cleoPrivateOverview.data.state, "finished", "Cleo group week is finished");
  const aliceOpenScore = aliceOpenOverview.data.scores.rows.find(
    (row: OverviewScoreRow) => row.user_id === alice.id
  );
  const alicePrivateScore = cleoPrivateOverview.data.scores.rows.find(
    (row: OverviewScoreRow) => row.user_id === alice.id
  );
  assertTruthy(aliceOpenScore, "Alice has a score row in her owned group");
  assertTruthy(alicePrivateScore, "Alice has a score row in Cleo group");
  assertEqual(
    aliceOpenScore.points_earned,
    11,
    "Alice has eleven points in her owned group"
  );
  assertEqual(
    alicePrivateScore.points_earned,
    5,
    "Alice has separate member score in Cleo group"
  );

  const danaOverview = await bobClient.get(
    `/friends-groups/${danaOpen.data.id}/matchweeks/current/overview`
  );
  assertEqual(danaOverview.data.friendsGroup.id, danaOpen.data.id, "Bob can read joined third group");
  assertTruthy(dana.id, "Dana owner account exists for third group coverage");

  console.log("\n[E2E] Cross-group season story passed.");
} finally {
  try {
    await server.close();
  } finally {
    await cleanupE2EData(supabaseService, { friends: true, auth: true });
  }
}

function assertLeaderboardTop(
  rows: LeaderboardRow[],
  expectedUserId: string,
  expectedPoints: number,
  label: string
) {
  assertEqual(rows[0]?.user_id, expectedUserId, `${label} leaderboard winner`);
  assertEqual(rows[0]?.points, expectedPoints, `${label} winner points`);
  assertEqual(rows[0]?.rank, 1, `${label} winner rank`);
}
