import { strict as assert } from "node:assert";
import {
  assertEqual,
  assertTruthy,
  cleanupE2EData,
  configureE2EEnv,
  detail,
  insertBatched,
  step,
} from "./helpers.js";
import type { Database } from "../../src/integrations/supabase/types.js";

configureE2EEnv();

const { supabaseService } = await import(
  "../../src/integrations/supabase/supabaseClient.js"
);
const { default: WeeklyScoreService } = await import(
  "../../src/services/WeeklyScoreService.js"
);

type GeneratedFixture = {
  id: number;
  fixtureNo: number;
  matchweek: string;
  home_score: number;
  away_score: number;
  has_red_card: boolean;
};
type InsertedGroup = {
  id: string;
  created_by: string;
};
type TableInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

type ExpectedScore = {
  fixtures_predicted: number;
  exact_score_points: number;
  correct_result_points: number;
  total_goals_bonus: number;
  red_card_bonus: number;
  points_earned: number;
};

const groupCount = Number(process.env.E2E_SEASON_GROUPS ?? 10);
const usersPerGroup = Number(process.env.E2E_SEASON_USERS_PER_GROUP ?? 30);
const matchweeks = Number(process.env.E2E_SEASON_MATCHWEEKS ?? 38);
const fixturesPerWeek = Number(process.env.E2E_SEASON_FIXTURES_PER_WEEK ?? 10);
const runNumber = Date.now() % 1_000_000_000;
const providerLeagueId = 800_000_000 + runNumber;
const providerSeasonId = 700_000_000 + runNumber;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const db = supabaseService;

await cleanupE2EData(db, { season: true, auth: false });

try {
step(
  `Generating full season: ${groupCount} groups, ${usersPerGroup} users/group, ${matchweeks} matchweeks, ${fixturesPerWeek} fixtures/week`
);

const { data: competition, error: competitionError } = await db
  .from("football_competitions")
  .insert({
    provider: "sportmonks",
    provider_league_id: providerLeagueId,
    name: `E2E Generated League ${runId}`,
    country_name: "E2E",
    current_provider_season_id: providerSeasonId,
  })
  .select("*")
  .single();
if (competitionError) throw competitionError;

const { data: season, error: seasonError } = await db
  .from("football_seasons")
  .insert({
    competition_id: competition.id,
    provider: "sportmonks",
    provider_season_id: providerSeasonId,
    name: "Generated E2E Season",
    starts_at: "2025-08-01",
    ends_at: "2026-05-24",
    is_current: false,
  })
  .select("*")
  .single();
if (seasonError) throw seasonError;

const fixtureRows: TableInsert<"fixtures">[] = [];
let fixtureNo = 0;
for (let week = 1; week <= matchweeks; week += 1) {
  for (let slot = 1; slot <= fixturesPerWeek; slot += 1) {
    fixtureNo += 1;
    const date = new Date(Date.UTC(2025, 7, 1 + week * 7 + slot));
    fixtureRows.push({
      provider: "e2e-season",
      sm_fixture_id: providerLeagueId * 1000 + fixtureNo,
      sm_league_id: providerLeagueId,
      sm_season_id: providerSeasonId,
      sm_round_id: week,
      home_team: `Home ${slot}`,
      away_team: `Away ${slot}`,
      home_score: fixtureNo % 4,
      away_score: (fixtureNo + week) % 3,
      has_red_card: fixtureNo % 7 === 0,
      match_date: date.toISOString().slice(0, 10),
      match_time: "15:00:00",
      starting_at: `${date.toISOString().slice(0, 10)}T15:00:00Z`,
      matchweek: `Matchweek ${week}`,
      status: "finished",
      provider_payload: { e2e: true, runId },
    });
  }
}

const { data: insertedFixtures, error: fixturesError } = await db
  .from("fixtures")
  .insert(fixtureRows)
  .select("id, sm_fixture_id, matchweek, home_score, away_score, has_red_card")
  .order("sm_fixture_id", { ascending: true });
if (fixturesError) throw fixturesError;

const fixtures: GeneratedFixture[] = insertedFixtures.map((fixture) => {
  if (
    fixture.matchweek === null ||
    fixture.home_score === null ||
    fixture.away_score === null ||
    fixture.has_red_card === null
  ) {
    throw new Error(`Generated fixture ${fixture.id} returned incomplete result data`);
  }

  return {
    id: fixture.id,
    fixtureNo: Number(fixture.sm_fixture_id) - providerLeagueId * 1000,
    matchweek: fixture.matchweek,
    home_score: fixture.home_score,
    away_score: fixture.away_score,
    has_red_card: fixture.has_red_card,
  };
});
assertEqual(
  fixtures.length,
  matchweeks * fixturesPerWeek,
  "generated expected fixture count"
);

step("Creating generated profiles, friendGroups, memberships, and subscriptions");
const groupOwnerIds = Array.from({ length: groupCount }, () => crypto.randomUUID());
const groups: TableInsert<"friends_groups">[] = Array.from({ length: groupCount }, (_, groupIndex) => ({
  name: `E2E Season Group ${groupIndex + 1}`,
  slug: `e2e-season-${runId}-${groupIndex + 1}`,
  created_by: groupOwnerIds[groupIndex],
  status: "approved",
  is_open: false,
}));

const { data: insertedGroups, error: groupsError } = await db
  .from("friends_groups")
  .insert(groups)
  .select("*")
  .order("created_at", { ascending: true });
if (groupsError) throw groupsError;

const usersByGroup = new Map<string, string[]>();
const profileRows: TableInsert<"profiles">[] = [];
const membershipRows: TableInsert<"friends_group_users">[] = [];
const subscriptionRows: TableInsert<"friends_group_subscriptions">[] = [];

for (const [groupIndex, group] of insertedGroups.entries()) {
  const userIds = [
    group.created_by,
    ...Array.from({ length: usersPerGroup - 1 }, () => crypto.randomUUID()),
  ];
  usersByGroup.set(group.id, userIds);

  for (const [userIndex, userId] of userIds.entries()) {
    profileRows.push({
      id: userId,
      display_name: `E2E G${groupIndex + 1} User ${userIndex + 1}`,
    });
    membershipRows.push({
      friends_group_id: group.id,
      user_id: userId,
      role: userIndex === 0 ? "owner" : "member",
    });
  }

  subscriptionRows.push({
    friends_group_id: group.id,
    competition_id: competition.id,
    season_id: season.id,
    provider: "sportmonks",
    provider_league_id: providerLeagueId,
    provider_season_id: providerSeasonId,
    status: "active",
    created_by: group.created_by,
  });
}

await insertBatched(db, "profiles", profileRows);
await insertBatched(db, "friends_group_users", membershipRows);
await insertBatched(db, "friends_group_subscriptions", subscriptionRows);

step("Generating predictions, red-card picks, and submissions");
const predictionRows: TableInsert<"predictions">[] = [];
const redCardRows: TableInsert<"red_card_predictions">[] = [];
const submissionRows: TableInsert<"user_submissions">[] = [];
const expectedByGroupUserWeek = new Map<string, ExpectedScore>();
const totalGoalCandidates = new Map<
  string,
  Array<{ userId: string; predictedTotal: number; actualTotal: number }>
>();
const fixturesByMatchweek = new Map<string, GeneratedFixture[]>();
for (const fixture of fixtures) {
  fixturesByMatchweek.set(fixture.matchweek, [
    ...(fixturesByMatchweek.get(fixture.matchweek) ?? []),
    fixture,
  ]);
}

for (const group of insertedGroups) {
  const userIds = usersByGroup.get(group.id) ?? [];
  for (const [userIndex, userId] of userIds.entries()) {
    for (let week = 1; week <= matchweeks; week += 1) {
      const matchweek = `Matchweek ${week}`;
      submissionRows.push({
        user_id: userId,
        friends_group_id: group.id,
        matchweek,
      });

      const weekFixtures = fixturesByMatchweek.get(matchweek) ?? [];
      const redCardFixture =
        weekFixtures[(userIndex + week - 1) % weekFixtures.length];
      const expected = emptyExpected();
      let predictedTotal = 0;
      let actualTotal = 0;

      for (const fixture of weekFixtures) {
        const prediction = makePrediction(userIndex, fixture);
        predictionRows.push({
          user_id: userId,
          fixture_id: fixture.id,
          friends_group_id: group.id,
          home_score_prediction: prediction.home,
          away_score_prediction: prediction.away,
        });

        if (redCardFixture?.id === fixture.id) {
          redCardRows.push({
            user_id: userId,
            fixture_id: fixture.id,
            friends_group_id: group.id,
          });
        }

        predictedTotal += prediction.home + prediction.away;
        actualTotal += fixture.home_score + fixture.away_score;
        applyFixtureExpected(expected, fixture, prediction);
      }

      if (redCardFixture?.has_red_card) expected.red_card_bonus = 5;
      expected.points_earned =
        expected.exact_score_points +
        expected.correct_result_points +
        expected.total_goals_bonus +
        expected.red_card_bonus;

      const groupWeekKey = `${group.id}:${matchweek}`;
      totalGoalCandidates.set(groupWeekKey, [
        ...(totalGoalCandidates.get(groupWeekKey) ?? []),
        { userId, predictedTotal, actualTotal },
      ]);
      const key = `${group.id}:${userId}:${matchweek}`;
      expectedByGroupUserWeek.set(key, expected);
    }
  }
}

for (const [groupWeekKey, candidates] of totalGoalCandidates.entries()) {
  const bestDistance = Math.min(
    ...candidates.map((candidate) =>
      Math.abs(candidate.predictedTotal - candidate.actualTotal)
    )
  );
  for (const candidate of candidates) {
    if (Math.abs(candidate.predictedTotal - candidate.actualTotal) !== bestDistance) {
      continue;
    }

    const [groupId, matchweek] = groupWeekKey.split(":");
    const key = `${groupId}:${candidate.userId}:${matchweek}`;
    const expected = expectedByGroupUserWeek.get(key);
    if (!expected) continue;
    expected.total_goals_bonus = 2;
    expected.points_earned =
      expected.exact_score_points +
      expected.correct_result_points +
      expected.total_goals_bonus +
      expected.red_card_bonus;
  }
}

await insertBatched(db, "predictions", predictionRows);
await insertBatched(db, "red_card_predictions", redCardRows);
await insertBatched(db, "user_submissions", submissionRows);
detail(`ok: inserted ${predictionRows.length} predictions`);
detail(`ok: inserted ${redCardRows.length} red-card picks`);
detail(`ok: inserted ${submissionRows.length} submissions`);

step("Calculating all finished matchweeks");
const scorer = new WeeklyScoreService(supabaseService);
const startedAt = Date.now();
const results = await scorer.calculateAllFinished();
const durationMs = Date.now() - startedAt;
detail(`ok: calculateAllFinished returned ${results.length} group/week results`);
detail(`ok: season scoring finished in ${durationMs}ms`);

step("Checking weekly score volume and exact scoring for sampled users");
const expectedScoreRows = groupCount * usersPerGroup * matchweeks;
const { count: weeklyScoreCount, error: weeklyCountError } = await db
  .from("weekly_scores")
  .select("*", { count: "exact", head: true })
  .in(
    "friends_group_id",
    insertedGroups.map((group: InsertedGroup) => group.id)
  );
if (weeklyCountError) throw weeklyCountError;
assertEqual(
  weeklyScoreCount,
  expectedScoreRows,
  "weekly_scores has one row per user per matchweek"
);

for (const group of insertedGroups.slice(0, Math.min(3, insertedGroups.length))) {
  const userIds = usersByGroup.get(group.id) ?? [];
  for (const userId of [userIds[0], userIds[usersPerGroup - 1]]) {
    const { data: rows, error } = await db
      .from("weekly_scores")
      .select("*")
      .eq("friends_group_id", group.id)
      .eq("user_id", userId)
      .order("week_number", { ascending: true });
    if (error) throw error;

    assertEqual(rows.length, matchweeks, "sample user has every week scored");

    let running = 0;
    for (const row of rows) {
      const expected = expectedByGroupUserWeek.get(
        `${group.id}:${userId}:Matchweek ${row.week_number}`
      );
      assert.ok(expected, "expected score exists for sampled week");
      running += expected!.points_earned;
      assert.equal(row.fixtures_predicted, expected!.fixtures_predicted);
      assert.equal(row.exact_score_points, expected!.exact_score_points);
      assert.equal(row.correct_result_points, expected!.correct_result_points);
      assert.equal(row.total_goals_bonus, expected!.total_goals_bonus);
      assert.equal(row.red_card_bonus, expected!.red_card_bonus);
      assert.equal(row.points_earned, expected!.points_earned);
      assert.equal(row.group_points, running);
    }
  }
}
detail("ok: sampled weekly score rows match independent expected scorer");

step("Checking leaderboard-style final totals for every group");
for (const group of insertedGroups) {
  const leaderboard = await scorer.getLeaderboard(group.id);
  assertEqual(leaderboard.length, usersPerGroup, "every group has all users ranked");
  assertTruthy(
    leaderboard[0].points >= leaderboard[leaderboard.length - 1].points,
    "leaderboard totals are sorted"
  );
}

console.log("\n[E2E] Full season simulation passed.");
} finally {
  await cleanupE2EData(db, { season: true, auth: false });
}

function makePrediction(userIndex: number, fixture: GeneratedFixture) {
  const mode = userIndex % 5;
  if (mode === 0) {
    return {
      home: fixture.home_score,
      away: fixture.away_score,
      redCard: fixture.has_red_card,
    };
  }

  if (mode === 1) {
    const homeWon = fixture.home_score > fixture.away_score;
    const awayWon = fixture.away_score > fixture.home_score;
    return {
      home: homeWon ? fixture.home_score + 1 : awayWon ? 0 : 1,
      away: awayWon ? fixture.away_score + 1 : homeWon ? 0 : 1,
      redCard: fixture.fixtureNo % 3 === 0,
    };
  }

  return {
    home: (fixture.home_score + userIndex + fixture.fixtureNo) % 5,
    away: (fixture.away_score + userIndex) % 4,
    redCard: (userIndex + fixture.fixtureNo) % 4 === 0,
  };
}

function emptyExpected(): ExpectedScore {
  return {
    fixtures_predicted: 0,
    exact_score_points: 0,
    correct_result_points: 0,
    total_goals_bonus: 0,
    red_card_bonus: 0,
    points_earned: 0,
  };
}

function applyFixtureExpected(
  expected: ExpectedScore,
  fixture: GeneratedFixture,
  prediction: { home: number; away: number; redCard: boolean }
) {
  expected.fixtures_predicted += 1;

  const exact =
    prediction.home === fixture.home_score && prediction.away === fixture.away_score;

  if (exact) {
    expected.correct_result_points += 1;
    expected.exact_score_points += 2;
  } else if (
    resultSign(prediction.home, prediction.away) ===
    resultSign(fixture.home_score, fixture.away_score)
  ) {
    expected.correct_result_points += 1;
  }

  expected.points_earned =
    expected.exact_score_points +
    expected.correct_result_points +
    expected.total_goals_bonus +
    expected.red_card_bonus;
}

function resultSign(home: number, away: number) {
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}
