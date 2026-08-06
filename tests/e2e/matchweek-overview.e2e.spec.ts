import {
  ApiClient,
  assertEqual,
  assertTruthy,
  configureE2EEnv,
  detail,
  startTestServer,
  step,
} from "./helpers.js";
import type { Database } from "../../src/integrations/supabase/types.js";

type OverviewMember = {
  userId: string;
  submitted: boolean;
  prediction: { predictions: unknown[]; redCardFixtureId: number | null } | null;
  score: { points_earned: number; provisional: boolean };
};
type OverviewScoreRow = {
  user_id: string;
  points_earned: number;
  provisional: boolean;
};
type TableName = keyof Database["public"]["Tables"];
type TableInsert<T extends TableName> =
  Database["public"]["Tables"][T]["Insert"];

configureE2EEnv();

const { supabaseService } = await import(
  "../../src/integrations/supabase/supabaseClient.js"
);

const db = supabaseService;
const runNumber = Date.now() % 1_000_000_000;
const leagueId = 1_410_000_000 + runNumber;
const seasonId = 1_420_000_000 + runNumber;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "Supabase-e2e-password-123!";
const userAEmail = `e2e-overview-a-${runId}@example.com`;
const userBEmail = `e2e-overview-b-${runId}@example.com`;
const outsiderEmail = `e2e-overview-outsider-${runId}@example.com`;

await cleanup();
const server = await startTestServer();

try {
  const userA = new ApiClient(server.baseUrl, "Overview User A");
  const userB = new ApiClient(server.baseUrl, "Overview User B");
  const outsider = new ApiClient(server.baseUrl, "Overview Outsider");

  step("Creating signed-in users for isolated overview season");
  await userA.post("/auth/sign-up", {
    email: userAEmail,
    password,
    displayName: `E2E Overview A ${runId}`,
  });
  await userA.post("/auth/sign-in", { email: userAEmail, password });
  const userAId = (await userA.get("/auth/me")).user.id;

  await userB.post("/auth/sign-up", {
    email: userBEmail,
    password,
    displayName: `E2E Overview B ${runId}`,
  });
  await userB.post("/auth/sign-in", { email: userBEmail, password });
  const userBId = (await userB.get("/auth/me")).user.id;

  await outsider.post("/auth/sign-up", {
    email: outsiderEmail,
    password,
    displayName: `E2E Overview Outsider ${runId}`,
  });
  await outsider.post("/auth/sign-in", { email: outsiderEmail, password });

  const setup = await createFinishedSeason({ userAId, userBId });

  step("Current overview falls back to latest finished matchweek");
  const current = await userA.get(
    `/friends-groups/${setup.group.id}/matchweeks/current/overview`
  );
  assertEqual(current.data.selectedMatchweek, "Matchweek 2", "current picks latest finished week");
  assertEqual(current.data.locksAt, "2026-01-08T14:00:00.000Z", "current overview exposes earliest lock time");
  assertEqual(current.data.state, "finished", "current finished-season overview is readonly");
  assertEqual(current.data.navigation.previous, "Matchweek 1", "current overview can swipe to previous week");
  assertEqual(current.data.navigation.next, null, "latest finished week has no next navigation");
  assertEqual(current.data.permissions.canEditPredictions, false, "finished-season overview blocks edits");
  assertEqual(current.data.permissions.canViewAllPredictions, true, "finished-season overview reveals submitted predictions");

  step("Previous matchweek overview returns complete readonly history");
  const previous = await userA.get(
    `/friends-groups/${setup.group.id}/matchweeks/${encodeURIComponent(
      "Matchweek 1"
    )}/overview`
  );
  assertEqual(previous.data.selectedMatchweek, "Matchweek 1", "specific previous week loads");
  assertEqual(previous.data.locksAt, "2026-01-01T14:00:00.000Z", "previous overview exposes earliest lock time");
  assertEqual(previous.data.navigation.previous, null, "first week has no previous");
  assertEqual(previous.data.navigation.next, "Matchweek 2", "first week can swipe forward");
  assertEqual(previous.data.fixtures.length, 2, "previous week includes fixtures");
  assertEqual(previous.data.liveFeed.length, 1, "previous week includes saved commentary");
  const myPreviousScore = previous.data.scores.rows.find(
    (row: OverviewScoreRow) => row.user_id === userAId
  );
  assertTruthy(myPreviousScore, "previous week includes my score row");
  assertEqual(myPreviousScore.points_earned, 4, "previous week includes my score");
  assertEqual(myPreviousScore.provisional, false, "previous week uses persisted scores");
  assertEqual(previous.data.scores.rows.length, 2, "previous week includes member score rows");
  assertEqual(
    Object.prototype.hasOwnProperty.call(previous.data.scores, "mine"),
    false,
    "overview no longer duplicates current user score under scores.mine"
  );
  assertEqual(
    Object.prototype.hasOwnProperty.call(previous.data, "leaderboard"),
    false,
    "overview no longer returns season leaderboard"
  );
  assertEqual(
    Object.prototype.hasOwnProperty.call(myPreviousScore, "group_points"),
    false,
    "overview score row is matchweek-only"
  );

  const userBPrevious = previous.data.members.find(
    (member: OverviewMember) => member.userId === userBId
  );
  assertTruthy(userBPrevious, "previous week includes User B member row");
  assertEqual(userBPrevious.submitted, true, "previous week shows User B submitted");
  assertEqual(userBPrevious.prediction?.predictions.length, 2, "previous week reveals User B predictions");
  assertEqual(userBPrevious.prediction?.redCardFixtureId, setup.week1Fixtures[1].id, "previous week reveals User B red-card pick");

  step("Overview rejects outsiders and missing matchweeks");
  await outsider.get(
    `/friends-groups/${setup.group.id}/matchweeks/Matchweek%201/overview`,
    403
  );
  detail("ok: outsider cannot read overview");
  await userA.get(
    `/friends-groups/${setup.group.id}/matchweeks/Matchweek%2099/overview`,
    404
  );
  detail("ok: missing matchweek returns 404");

  console.log("\n[E2E] Matchweek overview passed.");
} finally {
  try {
    await server.close();
  } finally {
    await cleanup();
  }
}

async function createFinishedSeason(params: { userAId: string; userBId: string }) {
  const { data: competition, error: competitionError } = await db
    .from("football_competitions")
    .insert({
      provider: "sportmonks",
      provider_league_id: leagueId,
      name: `E2E Overview League ${runId}`,
      country_name: "E2E",
      current_provider_season_id: seasonId,
    })
    .select("*")
    .single();
  if (competitionError) throw competitionError;

  const { data: season, error: seasonError } = await db
    .from("football_seasons")
    .insert({
      competition_id: competition.id,
      provider: "sportmonks",
      provider_season_id: seasonId,
      name: "E2E Overview Season",
      is_current: false,
    })
    .select("*")
    .single();
  if (seasonError) throw seasonError;

  const { data: group, error: groupError } = await db
    .from("friends_groups")
    .insert({
      name: "Overview Finished Season",
      slug: `e2e-overview-${runId}`,
      created_by: params.userAId,
      status: "approved",
    })
    .select("*")
    .single();
  if (groupError) throw groupError;

  await insertRows("friends_group_users", [
    { friends_group_id: group.id, user_id: params.userAId, role: "owner" },
    { friends_group_id: group.id, user_id: params.userBId, role: "member" },
  ]);

  await insertRows("friends_group_subscriptions", [
    {
      friends_group_id: group.id,
      competition_id: competition.id,
      season_id: season.id,
      provider: "sportmonks",
      provider_league_id: leagueId,
      provider_season_id: seasonId,
      status: "active",
      created_by: params.userAId,
    },
  ]);

  const { data: fixtures, error: fixturesError } = await db
    .from("fixtures")
    .insert([
      fixtureRow(1, "Matchweek 1", "Alpha", "Beta", 2, 1, true),
      fixtureRow(2, "Matchweek 1", "Gamma", "Delta", 0, 0, false),
      fixtureRow(3, "Matchweek 2", "Alpha", "Gamma", 1, 2, false),
      fixtureRow(4, "Matchweek 2", "Beta", "Delta", 3, 2, true),
    ])
    .select("*")
    .order("sm_fixture_id", { ascending: true });
  if (fixturesError) throw fixturesError;

  const week1Fixtures = fixtures.filter((fixture) => fixture.matchweek === "Matchweek 1");
  const week2Fixtures = fixtures.filter((fixture) => fixture.matchweek === "Matchweek 2");

  await insertRows("predictions", [
    predictionRow(params.userAId, group.id, week1Fixtures[0].id, 2, 1),
    predictionRow(params.userAId, group.id, week1Fixtures[1].id, 1, 1),
    predictionRow(params.userBId, group.id, week1Fixtures[0].id, 1, 0),
    predictionRow(params.userBId, group.id, week1Fixtures[1].id, 0, 0),
    predictionRow(params.userAId, group.id, week2Fixtures[0].id, 1, 1),
    predictionRow(params.userAId, group.id, week2Fixtures[1].id, 1, 1),
    predictionRow(params.userBId, group.id, week2Fixtures[0].id, 1, 2),
    predictionRow(params.userBId, group.id, week2Fixtures[1].id, 3, 2),
  ]);

  await insertRows("red_card_predictions", [
    redCardRow(params.userAId, group.id, week1Fixtures[0].id),
    redCardRow(params.userBId, group.id, week1Fixtures[1].id),
    redCardRow(params.userAId, group.id, week2Fixtures[0].id),
    redCardRow(params.userBId, group.id, week2Fixtures[1].id),
  ]);

  await insertRows("user_submissions", [
    submissionRow(params.userAId, group.id, "Matchweek 1"),
    submissionRow(params.userBId, group.id, "Matchweek 1"),
    submissionRow(params.userAId, group.id, "Matchweek 2"),
    submissionRow(params.userBId, group.id, "Matchweek 2"),
  ]);

  await insertRows("weekly_scores", [
    scoreRow(params.userAId, group.id, 1, 4, 4),
    scoreRow(params.userBId, group.id, 1, 2, 2),
    scoreRow(params.userAId, group.id, 2, 1, 5),
    scoreRow(params.userBId, group.id, 2, 6, 8),
  ]);

  await insertRows("live_feed_events", [
    {
      friends_group_id: group.id,
      fixture_id: week1Fixtures[0].id,
      matchweek: "Matchweek 1",
      sm_fixture_id: week1Fixtures[0].sm_fixture_id,
      event_key: `${week1Fixtures[0].id}:goal:12`,
      event_type: "goal",
      payload: { e2e: true },
      ai_message: "Alpha scored and the old predictions are locked in.",
    },
  ]);

  return { group, week1Fixtures, week2Fixtures };
}

function fixtureRow(
  fixtureNo: number,
  matchweek: string,
  homeTeam: string,
  awayTeam: string,
  homeScore: number,
  awayScore: number,
  hasRedCard: boolean
) {
  const day = fixtureNo <= 2 ? "2026-01-01" : "2026-01-08";
  const time = fixtureNo === 1 || fixtureNo === 3 ? "14:00:00" : "15:00:00";
  return {
    provider: "e2e-overview",
    sm_fixture_id: 1_430_000_000 + runNumber + fixtureNo,
    sm_league_id: leagueId,
    sm_season_id: seasonId,
    sm_round_id: fixtureNo <= 2 ? 1 : 2,
    home_team: homeTeam,
    away_team: awayTeam,
    home_score: homeScore,
    away_score: awayScore,
    live_home_score: null,
    live_away_score: null,
    has_red_card: hasRedCard,
    match_date: day,
    match_time: time,
    starting_at: `${day}T${time}Z`,
    matchweek,
    status: "finished",
    provider_payload: { e2e: true, runId },
  };
}

function predictionRow(
  userId: string,
  friendsGroupId: string,
  fixtureId: number,
  home: number,
  away: number
) {
  return {
    user_id: userId,
    friends_group_id: friendsGroupId,
    fixture_id: fixtureId,
    home_score_prediction: home,
    away_score_prediction: away,
  };
}

function redCardRow(userId: string, friendsGroupId: string, fixtureId: number) {
  return {
    user_id: userId,
    friends_group_id: friendsGroupId,
    fixture_id: fixtureId,
  };
}

function submissionRow(userId: string, friendsGroupId: string, matchweek: string) {
  return {
    user_id: userId,
    friends_group_id: friendsGroupId,
    matchweek,
  };
}

function scoreRow(
  userId: string,
  friendsGroupId: string,
  weekNumber: number,
  points: number,
  groupPoints: number
) {
  return {
    user_id: userId,
    friends_group_id: friendsGroupId,
    week_number: weekNumber,
    fixtures_predicted: 2,
    exact_score_points: points >= 3 ? 3 : 0,
    correct_result_points: points === 2 ? 1 : points === 1 ? 1 : 0,
    total_goals_bonus: points === 4 || points === 2 ? 1 : 0,
    red_card_bonus: points === 4 || points === 6 ? 1 : 0,
    points_earned: points,
    group_points: groupPoints,
  };
}

async function insertRows<T extends TableName>(table: T, rows: TableInsert<T>[]) {
  const { error } = await db.from(table).insert(rows as never);
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
}

async function cleanup() {
  await db.from("friends_groups").delete().like("slug", "e2e-overview-%");
  await db.from("fixtures").delete().eq("provider", "e2e-overview");
  await db
    .from("football_competitions")
    .delete()
    .eq("provider_league_id", leagueId);
  await db.from("profiles").delete().like("display_name", "E2E Overview %");
}
