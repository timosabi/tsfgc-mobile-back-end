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
  fixtureByTeams,
  fixturesForMatchweek,
  joinOpenInvite,
  saveAndSubmitSlip,
  signUpAndSignIn,
} from "./flow-helpers.js";

type ScoreRow = {
  user_id: string;
  fixtures_predicted: number;
  exact_score_points: number;
  correct_result_points: number;
  total_goals_bonus: number;
  red_card_bonus: number;
  points_earned: number;
};
type OverviewScoreRow = { user_id: string; points_earned: number };

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "Supabase-e2e-password-123!";
const adminEmail = `e2e-scoring-admin-${runId}@example.com`;
const matchweek = "Matchweek 2";

configureE2EEnv(adminEmail);

const { supabaseService } = await import(
  "../../src/integrations/supabase/supabaseClient.js"
);

await cleanupE2EData(supabaseService, { friends: true, auth: true });
const server = await startTestServer();

try {
  const ownerClient = new ApiClient(server.baseUrl, "Scoring Owner");
  const memberClient = new ApiClient(server.baseUrl, "Scoring Member");
  const adminClient = new ApiClient(server.baseUrl, "Scoring Admin");

  step("Admin, owner, and member sign in for scoring flow");
  const owner = await signUpAndSignIn({
    client: ownerClient,
    email: `e2e-scoring-owner-${runId}@example.com`,
    password,
    displayName: `E2E Scoring Owner ${runId}`,
  });
  const member = await signUpAndSignIn({
    client: memberClient,
    email: `e2e-scoring-member-${runId}@example.com`,
    password,
    displayName: `E2E Scoring Member ${runId}`,
  });
  await signUpAndSignIn({
    client: adminClient,
    email: adminEmail,
    password,
    displayName: `E2E Scoring Admin ${runId}`,
  });

  step("Users join group and submit different predictions");
  const group = await createFriendsGroup({
    owner: ownerClient,
    name: "E2E Scoring Group",
    slug: `e2e-scoring-${runId}`,
    accessType: "open",
  });
  await joinOpenInvite({
    client: memberClient,
    inviteToken: group.data.invite_token,
  });
  const fixtures = await fixturesForMatchweek({
    client: ownerClient,
    friendsGroupId: group.data.id,
    matchweek,
  });
  const arsenalLiverpool = fixtureByTeams(fixtures, "Arsenal", "Liverpool");
  const chelseaCity = fixtureByTeams(fixtures, "Chelsea", "Manchester City");

  await saveAndSubmitSlip({
    client: ownerClient,
    friendsGroupId: group.data.id,
    matchweek,
    predictions: [
      { fixtureId: arsenalLiverpool.id, homeScore: 2, awayScore: 1 },
      { fixtureId: chelseaCity.id, homeScore: 1, awayScore: 2 },
    ],
    redCardFixtureId: arsenalLiverpool.id,
  });
  await saveAndSubmitSlip({
    client: memberClient,
    friendsGroupId: group.data.id,
    matchweek,
    predictions: [
      { fixtureId: arsenalLiverpool.id, homeScore: 1, awayScore: 1 },
      { fixtureId: chelseaCity.id, homeScore: 0, awayScore: 2 },
    ],
    redCardFixtureId: chelseaCity.id,
  });

  step("Mock finished hydration locks fixtures and scoring creates exact point rows");
  await adminClient.post("/admin/fixtures/hydrate/finished", { days: 30 });
  const scoreResult = await adminClient.post(
    `/weekly-score/${group.data.id}/calculate`,
    { matchweek }
  );
  assertEqual(scoreResult.data.fixturesScored, 2, "two fixtures scored");
  assertEqual(scoreResult.data.submittedUsers, 2, "two submitted users scored");

  const ownerScore = scoreResult.data.rows.find(
    (row: ScoreRow) => row.user_id === owner.id
  );
  const memberScore = scoreResult.data.rows.find(
    (row: ScoreRow) => row.user_id === member.id
  );
  assertTruthy(ownerScore, "owner score row exists");
  assertTruthy(memberScore, "member score row exists");

  assertEqual(ownerScore.fixtures_predicted, 2, "owner predicted two fixtures");
  assertEqual(ownerScore.exact_score_points, 2, "owner exact-score bonus points");
  assertEqual(ownerScore.correct_result_points, 2, "owner result points");
  assertEqual(ownerScore.total_goals_bonus, 2, "owner total-goals nearest bonus");
  assertEqual(ownerScore.red_card_bonus, 5, "owner red-card bonus");
  assertEqual(ownerScore.points_earned, 11, "owner earns eleven points");

  assertEqual(memberScore.fixtures_predicted, 2, "member predicted two fixtures");
  assertEqual(memberScore.exact_score_points, 2, "member exact-score bonus points");
  assertEqual(memberScore.correct_result_points, 1, "member result points");
  assertEqual(memberScore.total_goals_bonus, 2, "member total-goals nearest bonus");
  assertEqual(memberScore.red_card_bonus, 0, "member red-card bonus");
  assertEqual(memberScore.points_earned, 5, "member earns five points");

  step("Leaderboard and history expose persisted scores");
  const leaderboard = await ownerClient.get(
    `/weekly-score/${group.data.id}/leaderboard`
  );
  assertEqual(leaderboard.data[0].user_id, owner.id, "owner ranks first");
  assertEqual(leaderboard.data[0].points, 11, "leaderboard stores owner total");
  assertEqual(leaderboard.data[1].user_id, member.id, "member ranks second");

  const finishedOverview = await ownerClient.get(
    `/friends-groups/${group.data.id}/matchweeks/${encodeURIComponent(
      matchweek
    )}/overview`
  );
  const ownerOverviewScore = finishedOverview.data.scores.rows.find(
    (row: OverviewScoreRow) => row.user_id === owner.id
  );
  assertTruthy(ownerOverviewScore, "overview has owner score row");
  assertEqual(ownerOverviewScore.points_earned, 11, "overview has owner score");
  assertEqual(finishedOverview.data.scores.rows.length, 2, "overview includes submitted users' scores");
  assertEqual(
    finishedOverview.data.members.every(
      (row: { prediction: unknown | null }) => row.prediction !== null
    ),
    true,
    "overview reveals submitted prediction slips after finish"
  );

  console.log("\n[E2E] Scoring and leaderboard passed.");
} finally {
  try {
    await server.close();
  } finally {
    await cleanupE2EData(supabaseService, { friends: true, auth: true });
  }
}
