import { strict as assert } from "node:assert";
import {
  assertEqual,
  assertTruthy,
  configureE2EEnv,
  detail,
  step,
} from "./helpers.js";
import LiveFeedService from "../../src/services/LiveFeedService.js";
import type {
  Database,
  Json,
} from "../../src/integrations/supabase/types.js";

configureE2EEnv();

const { supabaseService } =
  await import("../../src/integrations/supabase/supabaseClient.js");

const db = supabaseService;
const runNumber = Date.now() % 1_000_000_000;
const leagueId = 950_000_000 + runNumber;
const seasonId = 960_000_000 + runNumber;
const smFixtureId = 970_000_000 + runNumber;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type TableName = keyof Database["public"]["Tables"];
type TableInsert<T extends TableName> =
  Database["public"]["Tables"][T]["Insert"];
type LiveFeedPayload = {
  affectedPositive: string[];
  affectedNegative: string[];
  reason?: string;
  score?: {
    home: number;
    away: number;
  };
};

await cleanup();

try {
  step("Creating live test group, users, fixture, predictions, submissions");
  const setup = await createLiveSetup();
  const liveFeed = new LiveFeedService(supabaseService);

  step("Red card event creates personalised group chat and match event");
  await liveFeed.processEvent({
    eventType: "red_card",
    fixtureId: setup.fixture.id,
    smEventId: smFixtureId + 101,
    minute: 62,
    team: "Live Away",
    playerName: "Hot Head",
  });

  let mainFeed = await liveFeed.listFeed({
    friendsGroupId: setup.mainGroup.id,
    fixtureId: setup.fixture.id,
  });

  assertEqual(mainFeed.length, 1, "one live feed message created");
  const redCardMainFeed = requireFeedRow(mainFeed, 0);
  const redCardMessage = redCardMainFeed.ai_message ?? "";
  assertEqual(redCardMainFeed.event_type, "red_card", "red-card feed event stored");
  assertTruthy(
    redCardMessage.includes("George"),
    "red-card message mentions positive prediction",
  );
  assertTruthy(
    redCardMessage.includes("Alex"),
    "red-card message mentions negative prediction",
  );
  assertTruthy(
    redCardMessage.toLowerCase().includes("red card"),
    "red-card message has event context",
  );
  const redCardPayload = liveFeedPayload(redCardMainFeed.payload);
  assert.deepEqual(redCardPayload.affectedPositive, ["George"]);
  assert.deepEqual(redCardPayload.affectedNegative, ["Alex"]);

  const genericFeed = await liveFeed.listFeed({
    friendsGroupId: setup.emptyGroup.id,
    fixtureId: setup.fixture.id,
  });
  assertEqual(genericFeed.length, 1, "empty group still gets generic event");
  const genericFeedRow = requireFeedRow(genericFeed, 0);
  const genericMessage = genericFeedRow.ai_message ?? "";
  assertEqual(
    liveFeedPayload(genericFeedRow.payload).reason,
    "no_submitted_predictions",
    "empty group stores generic reason",
  );
  assertTruthy(
    !genericMessage.includes("George") && !genericMessage.includes("Alex"),
    "generic message has no player names",
  );

  const { count: matchEventCount, error: matchEventError } = await db
    .from("match_events")
    .select("*", { count: "exact", head: true })
    .eq("sm_event_id", smFixtureId + 101);
  if (matchEventError) throw matchEventError;
  assertEqual(matchEventCount, 1, "match event stored once");

  step("Duplicate same red-card event does not duplicate history");
  await liveFeed.processEvent({
    eventType: "red_card",
    fixtureId: setup.fixture.id,
    smEventId: smFixtureId + 101,
    minute: 62,
    team: "Live Away",
    playerName: "Hot Head",
  });

  mainFeed = await liveFeed.listFeed({
    friendsGroupId: setup.mainGroup.id,
    fixtureId: setup.fixture.id,
  });
  assertEqual(mainFeed.length, 1, "duplicate event keeps one feed message");

  step("Goal event creates score-impact chat and saved history");
  await liveFeed.processEvent({
    eventType: "goal",
    fixtureId: setup.fixture.id,
    smEventId: smFixtureId + 102,
    minute: 70,
    team: "Live Home",
    playerName: "Finisher",
    homeScore: 1,
    awayScore: 0,
  });

  mainFeed = await liveFeed.listFeed({
    friendsGroupId: setup.mainGroup.id,
    fixtureId: setup.fixture.id,
  });

  assertEqual(mainFeed.length, 2, "history has red-card and goal messages");
  const goalMessage = mainFeed.find((row) => row.event_type === "goal");
  assertTruthy(goalMessage, "goal feed event stored");
  if (!goalMessage) throw new Error("goal feed event missing after assertion");
  const goalAiMessage = goalMessage.ai_message ?? "";
  assertTruthy(
    goalAiMessage.includes("George"),
    "goal mentions George",
  );
  assertTruthy(goalAiMessage.includes("Alex"), "goal mentions Alex");
  const goalPayload = liveFeedPayload(goalMessage.payload);
  assert.deepEqual(goalPayload.affectedPositive, ["George"]);
  assert.deepEqual(goalPayload.affectedNegative, ["Alex"]);
  assertEqual(
    goalPayload.score?.home,
    1,
    "goal score stored in payload",
  );
  assertEqual(
    goalPayload.score?.away,
    0,
    "goal score stored in payload",
  );

  const history = await liveFeed.listFeed({
    friendsGroupId: setup.mainGroup.id,
    matchweek: "Matchweek 1",
  });
  assertEqual(history.length, 2, "matchweek history returns saved chat");

  const { data: fixtureAfterGoal, error: fixtureError } = await db
    .from("fixtures")
    .select(
      "home_score, away_score, live_home_score, live_away_score, has_red_card",
    )
    .eq("id", setup.fixture.id)
    .single();
  if (fixtureError) throw fixtureError;
  assertEqual(fixtureAfterGoal.home_score, 1, "fixture home score updated");
  assertEqual(fixtureAfterGoal.away_score, 0, "fixture away score updated");
  assertEqual(
    fixtureAfterGoal.has_red_card,
    true,
    "fixture red-card flag updated",
  );

  detail("ok: live chat persists history and stays prediction-aware");
  console.log("\n[E2E] Live feed passed.");
} finally {
  await cleanup();
}

async function createLiveSetup() {
  const { data: competition, error: competitionError } = await db
    .from("football_competitions")
    .insert({
      provider: "sportmonks",
      provider_league_id: leagueId,
      name: `E2E Live League ${runId}`,
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
      name: "E2E Live Season",
      is_current: false,
    })
    .select("*")
    .single();
  if (seasonError) throw seasonError;

  const georgeId = crypto.randomUUID();
  const alexId = crypto.randomUUID();
  const emptyUserId = crypto.randomUUID();

  await insertRows("profiles", [
    { id: georgeId, display_name: "George" },
    { id: alexId, display_name: "Alex" },
    { id: emptyUserId, display_name: "Quiet Friend" },
  ]);

  const { data: groups, error: groupsError } = await db
    .from("friends_groups")
    .insert([
      {
        name: "Sunday Chaos",
        slug: `e2e-live-${runId}-main`,
        created_by: georgeId,
        status: "approved",
      },
      {
        name: "Silent Stand",
        slug: `e2e-live-${runId}-empty`,
        created_by: emptyUserId,
        status: "approved",
      },
    ])
    .select("*")
    .order("slug", { ascending: true });
  if (groupsError) throw groupsError;

  const emptyGroup = groups[0].slug.includes("empty") ? groups[0] : groups[1];
  const mainGroup = groups[0].slug.includes("main") ? groups[0] : groups[1];

  await insertRows("friends_group_users", [
    { friends_group_id: mainGroup.id, user_id: georgeId, role: "owner" },
    { friends_group_id: mainGroup.id, user_id: alexId, role: "member" },
    { friends_group_id: emptyGroup.id, user_id: emptyUserId, role: "owner" },
  ]);

  await insertRows("friends_group_subscriptions", [
    subscriptionRow(mainGroup.id, georgeId, competition.id, season.id),
    subscriptionRow(emptyGroup.id, emptyUserId, competition.id, season.id),
  ]);

  const { data: fixture, error: fixtureError } = await db
    .from("fixtures")
    .insert({
      provider: "e2e-live",
      sm_fixture_id: smFixtureId,
      sm_league_id: leagueId,
      sm_season_id: seasonId,
      sm_round_id: 1,
      home_team: "Live Home",
      away_team: "Live Away",
      home_score: 0,
      away_score: 0,
      live_home_score: 0,
      live_away_score: 0,
      has_red_card: false,
      match_date: "2026-09-01",
      match_time: "15:00:00",
      starting_at: "2026-09-01T15:00:00Z",
      matchweek: "Matchweek 1",
      status: "live",
      provider_payload: { e2e: true, runId },
    })
    .select("*")
    .single();
  if (fixtureError) throw fixtureError;

  await insertRows("predictions", [
    {
      user_id: georgeId,
      fixture_id: fixture.id,
      friends_group_id: mainGroup.id,
      home_score_prediction: 2,
      away_score_prediction: 1,
    },
    {
      user_id: alexId,
      fixture_id: fixture.id,
      friends_group_id: mainGroup.id,
      home_score_prediction: 0,
      away_score_prediction: 0,
    },
  ]);

  await insertRows("red_card_predictions", [
    {
      user_id: georgeId,
      fixture_id: fixture.id,
      friends_group_id: mainGroup.id,
    },
  ]);

  await insertRows("user_submissions", [
    {
      user_id: georgeId,
      friends_group_id: mainGroup.id,
      matchweek: "Matchweek 1",
    },
    {
      user_id: alexId,
      friends_group_id: mainGroup.id,
      matchweek: "Matchweek 1",
    },
  ]);

  return { mainGroup, emptyGroup, fixture };
}

function subscriptionRow(
  friendsGroupId: string,
  createdBy: string,
  competitionId: string,
  seasonRowId: string,
) {
  return {
    friends_group_id: friendsGroupId,
    competition_id: competitionId,
    season_id: seasonRowId,
    provider: "sportmonks",
    provider_league_id: leagueId,
    provider_season_id: seasonId,
    status: "active",
    created_by: createdBy,
  };
}

async function insertRows<T extends TableName>(table: T, rows: TableInsert<T>[]) {
  const { error } = await db.from(table).insert(rows as never);
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
}

function liveFeedPayload(payload: Json): LiveFeedPayload {
  assert.ok(
    payload && typeof payload === "object" && !Array.isArray(payload),
    "live feed payload must be an object",
  );

  return payload as unknown as LiveFeedPayload;
}

function requireFeedRow<T>(rows: T[], index: number): T {
  const row = rows[index];
  if (!row) throw new Error(`Expected live feed row at index ${index}`);
  return row;
}

async function cleanup() {
  await db.from("friends_groups").delete().like("slug", "e2e-live-%");
  await db.from("fixtures").delete().eq("provider", "e2e-live");
  await db
    .from("football_competitions")
    .delete()
    .eq("provider_league_id", leagueId);
  await db
    .from("profiles")
    .delete()
    .in("display_name", ["George", "Alex", "Quiet Friend"]);
}
