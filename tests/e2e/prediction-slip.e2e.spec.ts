import {
  ApiClient,
  assertEqual,
  cleanupE2EData,
  configureE2EEnv,
  isolateMockCompetitionSeason,
  restoreCompetitionSeason,
  startTestServer,
  step,
} from "./helpers.js";
import {
  createFriendsGroup,
  fixtureByTeams,
  fixturesForMatchweek,
  joinOpenInvite,
  saveAndSubmitSlip,
  saveSlip,
  signUpAndSignIn,
  submitSlip,
} from "./flow-helpers.js";
import { MOCK_LEAGUE_8_SEASON_ID } from "../../src/integrations/sportmonks/mock-service.js";

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "Supabase-e2e-password-123!";
const matchweek = "Matchweek 2";

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
  const ownerClient = new ApiClient(server.baseUrl, "Slip Owner");
  const memberClient = new ApiClient(server.baseUrl, "Slip Member");

  step("Owner and member create an open group with scheduled fixtures");
  await signUpAndSignIn({
    client: ownerClient,
    email: `e2e-slip-owner-${runId}@example.com`,
    password,
    displayName: `E2E Slip Owner ${runId}`,
  });
  const member = await signUpAndSignIn({
    client: memberClient,
    email: `e2e-slip-member-${runId}@example.com`,
    password,
    displayName: `E2E Slip Member ${runId}`,
  });
  const group = await createFriendsGroup({
    owner: ownerClient,
    name: "E2E Slip Group",
    slug: `e2e-slip-${runId}`,
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
  const fullPredictions = [
    { fixtureId: arsenalLiverpool.id, homeScore: 2, awayScore: 1 },
    { fixtureId: chelseaCity.id, homeScore: 1, awayScore: 2 },
  ];

  step("Prediction slip rejects incomplete or invalid red-card selections");
  await saveSlip({
    client: memberClient,
    friendsGroupId: group.data.id,
    matchweek,
    predictions: [fullPredictions[0]],
    redCardFixtureId: arsenalLiverpool.id,
    expectedStatus: 400,
  });
  await saveSlip({
    client: memberClient,
    friendsGroupId: group.data.id,
    matchweek,
    predictions: fullPredictions,
    expectedStatus: 400,
  });
  await saveSlip({
    client: memberClient,
    friendsGroupId: group.data.id,
    matchweek,
    predictions: fullPredictions,
    redCardFixtureIds: [arsenalLiverpool.id, chelseaCity.id],
    expectedStatus: 400,
  });

  step("Prediction slip can be saved, edited, submitted, and read before lock");
  await saveSlip({
    client: memberClient,
    friendsGroupId: group.data.id,
    matchweek,
    predictions: fullPredictions,
    redCardFixtureId: arsenalLiverpool.id,
  });
  await saveSlip({
    client: memberClient,
    friendsGroupId: group.data.id,
    matchweek,
    predictions: [
      { fixtureId: arsenalLiverpool.id, homeScore: 1, awayScore: 1 },
      { fixtureId: chelseaCity.id, homeScore: 0, awayScore: 2 },
    ],
    redCardFixtureId: chelseaCity.id,
  });
  await submitSlip({
    client: memberClient,
    friendsGroupId: group.data.id,
    matchweek,
  });
  const mine = await memberClient.get(
    `/friends-groups/${group.data.id}/matchweeks/${encodeURIComponent(
      matchweek
    )}/predictions/mine`
  );
  assertEqual(mine.data.predictions.length, 2, "submitted slip has every fixture");
  assertEqual(mine.data.redCardFixtureId, chelseaCity.id, "edited red-card pick saved");
  assertEqual(mine.data.submitted, true, "slip submitted status is visible");

  step("Other member predictions stay hidden before kickoff lock");
  await saveAndSubmitSlip({
    client: ownerClient,
    friendsGroupId: group.data.id,
    matchweek,
    predictions: fullPredictions,
    redCardFixtureId: arsenalLiverpool.id,
  });
  const beforeLock = await ownerClient.get(
    `/friends-groups/${group.data.id}/matchweeks/${encodeURIComponent(
      matchweek
    )}/overview`
  );
  const memberBeforeLock = beforeLock.data.members.find(
    (row: { userId: string }) => row.userId === member.id
  );
  assertEqual(memberBeforeLock.prediction, null, "other prediction slip hidden before lock");

  step("First kickoff locks the whole matchweek slip and reveals submitted picks");
  const { error: updateError } = await supabaseService
    .from("fixtures")
    .update({
      status: "live",
      starting_at: "2026-01-01T12:00:00Z",
      match_date: "2026-01-01",
      match_time: "12:00:00",
    })
    .in("id", fixtures.map((fixture) => fixture.id));
  if (updateError) throw updateError;

  await saveSlip({
    client: memberClient,
    friendsGroupId: group.data.id,
    matchweek,
    predictions: fullPredictions,
    redCardFixtureId: arsenalLiverpool.id,
    expectedStatus: 409,
  });
  const afterLock = await ownerClient.get(
    `/friends-groups/${group.data.id}/matchweeks/${encodeURIComponent(
      matchweek
    )}/overview`
  );
  const memberAfterLock = afterLock.data.members.find(
    (row: { userId: string }) => row.userId === member.id
  );
  assertEqual(memberAfterLock.prediction.predictions.length, 2, "other score picks reveal after lock");
  assertEqual(memberAfterLock.prediction.redCardFixtureId, chelseaCity.id, "other red-card pick reveals after lock");

  console.log("\n[E2E] Prediction slip passed.");
} finally {
  try {
    await server.close();
  } finally {
    await cleanupE2EData(supabaseService, { friends: true, auth: true });
    await restoreCompetitionSeason(supabaseService, 8, originalSeasonId);
  }
}
