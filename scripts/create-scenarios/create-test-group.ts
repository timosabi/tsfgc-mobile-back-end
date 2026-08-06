import "dotenv/config";
import { env } from "node:process";
import { supabaseService } from "../../src/integrations/supabase/supabaseClient.js";
import AuthService from "../../src/services/AuthService.js";
import FriendsGroupJoinRequestService from "../../src/services/FriendsGroupJoinRequestService.js";
import FriendsGroupService from "../../src/services/FriendsGroupService.js";
import FriendsGroupSubscriptionService from "../../src/services/FriendsGroupSubscriptionService.js";
import FriendsGroupUsersService from "../../src/services/FriendsGroupUsersService.js";
import WeeklyScoreService from "../../src/services/WeeklyScoreService.js";
import type { Database } from "../../src/integrations/supabase/types.js";
import {
  askInteger,
  askRadioChoice,
  askString,
  assertLocalSupabaseUrl,
  assertSupabaseApiReachable,
  createCliPrompts,
  createDevScenarioRun,
  createDevUser,
  devSeedPassword,
  printUserBlock,
  printDevScenarioErrorAndExit,
  readArg,
  slugify,
  type DevScenarioUser,
} from "./lib/dev-scenario-utils.js";

type AccessType = "open" | "private";
type TestMode = "editable" | "locked" | "finished";
type PredictionSetup = "none" | "owner" | "all";
type BooleanChoice = "yes" | "no";
type FixtureRow = Database["public"]["Tables"]["fixtures"]["Row"];
type FixtureInsert = Database["public"]["Tables"]["fixtures"]["Insert"];
type ScoreCalculationResult = Awaited<
  ReturnType<WeeklyScoreService["calculateForFriendsGroupMatchweek"]>
>;
type ScenarioConfig = {
  groupName: string;
  access: AccessType;
  memberCount: number;
  pendingCount: number;
  matchweek: string;
  seedPreviousFinishedMatchweeks: boolean;
  mode: TestMode;
  predictions: PredictionSetup;
  fixtureCount: number;
};
type MatchweekSeedResult = {
  matchweek: string;
  mode: TestMode;
  fixtures: FixtureRow[];
  predictionSummary: {
    predictedUsers: number;
    submittedUsers: number;
    weeklyScores: number;
  };
  scoringResult: ScoreCalculationResult | null;
};

const scenarioName = "create-test-group";
const run = createDevScenarioRun();

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
const joinRequests = new FriendsGroupJoinRequestService(supabaseService);
const subscriptions = new FriendsGroupSubscriptionService(supabaseService);
const weeklyScores = new WeeklyScoreService(supabaseService);

try {
  const config = await readScenarioConfig();
  const result = await createScenario(config);
  printScenario(result);
} finally {
  rl.close();
}

async function readScenarioConfig(): Promise<ScenarioConfig> {
  console.log("");
  console.log("Create Test Group Scenario");
  console.log("------------------------------------------------------------");

  const groupName = await askString({
    rl,
    argName: "name",
    label: "Group name",
    defaultValue: `Dev Seed Test Group ${run.suffix}`,
  });
  const access = await askRadioChoice({
    rl,
    argName: "access",
    label: "Access type",
    choices: ["open", "private"] as const,
    defaultValue: "private",
  });
  const memberCount = await askInteger({
    rl,
    argName: "members",
    label: "Accepted member count, excluding owner",
    defaultValue: 3,
    min: 0,
    max: 50,
  });
  const pendingCount =
    access === "private"
      ? await askInteger({
          rl,
          argName: "pending",
          label: "Pending join request count",
          defaultValue: 1,
          min: 0,
          max: 50,
        })
      : Number(readArg("pending") ?? 0);
  const matchweek = await askString({
    rl,
    argName: "matchweek",
    label: "Matchweek label",
    defaultValue: "Matchweek 2",
  });
  const selectedMatchweekNumber = matchweekNumber(matchweek);
  const seedPreviousFinishedMatchweeks =
    selectedMatchweekNumber <= 1
      ? false
      : await readSeedPreviousFinishedMatchweeks();
  const mode = await askRadioChoice({
    rl,
    argName: "mode",
    label: "Test mode",
    choices: ["editable", "locked", "finished"] as const,
    defaultValue: "editable",
  });
  const predictions = await askRadioChoice({
    rl,
    argName: "predictions",
    label: "Prediction setup",
    choices: ["none", "owner", "all"] as const,
    defaultValue: mode === "editable" ? "owner" : "all",
  });
  const fixtureCount = await askInteger({
    rl,
    argName: "fixtures",
    label: "Fixture count in selected matchweek",
    defaultValue: 2,
    min: 1,
    max: 10,
  });

  return {
    groupName,
    access,
    memberCount,
    pendingCount: access === "private" ? pendingCount : 0,
    matchweek,
    seedPreviousFinishedMatchweeks,
    mode,
    predictions,
    fixtureCount,
  };
}

async function readSeedPreviousFinishedMatchweeks() {
  const legacyCount = readArg("previousFinished");
  if (legacyCount !== undefined) {
    return Number(legacyCount) > 0;
  }

  const choice: BooleanChoice = await askRadioChoice({
    rl,
    argName: "seedPrevious",
    label: "Seed all previous finished matchweeks",
    choices: ["no", "yes"] as const,
    defaultValue: "no",
  });

  return choice === "yes";
}

async function createScenario(config: ScenarioConfig) {
  const owner = await createDevUser({
    client: supabaseService,
    auth,
    suffix: run.suffix,
    role: "owner",
    label: "Test Group Owner",
    description: "Owns generated test group",
  });

  const members: DevScenarioUser[] = [];
  for (let i = 1; i <= config.memberCount; i += 1) {
    members.push(
      await createDevUser({
        client: supabaseService,
        auth,
        suffix: run.suffix,
        role: "member",
        label: "Accepted Member",
        description: "Accepted member in generated test group",
        index: i,
      })
    );
  }

  const pendingUsers: DevScenarioUser[] = [];
  for (let i = 1; i <= config.pendingCount; i += 1) {
    pendingUsers.push(
      await createDevUser({
        client: supabaseService,
        auth,
        suffix: run.suffix,
        role: "pending-member",
        label: "Pending Member",
        description: "Has pending join request waiting for owner approval",
        index: i,
      })
    );
  }

  const group = await friendsGroupService.createFriendsGroup({
    name: config.groupName,
    slug: `dev-seed-${slugify(config.groupName)}-${run.suffix}`,
    created_by: owner.id,
    is_open: config.access === "open",
    status: "approved",
  });

  await friendsGroupUsers.joinFriendsGroup({
    friendsGroupId: group.id,
    userId: owner.id,
    role: "owner",
  });

  for (const member of members) {
    await friendsGroupUsers.joinFriendsGroup({
      friendsGroupId: group.id,
      userId: member.id,
      role: "member",
    });
  }

  const providerLeagueId = 1_600_000_000 + run.numericSeed;
  const providerSeasonId = 1_700_000_000 + run.numericSeed;
  const subscriptionResult = await subscriptions.subscribe({
    friendsGroupId: group.id,
    createdBy: owner.id,
    providerLeagueId,
    providerSeasonId,
    competitionName: `Dev Seed League ${run.suffix}`,
    countryName: "Dev Seed",
    seasonName: `Dev Seed Season ${run.suffix}`,
    logoUrl: null,
    status: "active",
  });

  const previousMatchweekResults = await seedPreviousFinishedMatchweeks({
    config,
    friendsGroupId: group.id,
    providerLeagueId,
    providerSeasonId,
    users: [owner, ...members],
  });

  const selectedFixtures = await insertGeneratedFixtures({
    matchweek: config.matchweek,
    mode: config.mode,
    fixtureCount: config.fixtureCount,
    startsAtBase: firstFixtureDate(config.mode),
    providerLeagueId,
    providerSeasonId,
  });

  const pendingRequestIds: string[] = [];
  for (const pendingUser of pendingUsers) {
    await joinRequests.insertRequest({
      friendsGroupId: group.id,
      userId: pendingUser.id,
      userDisplayName: pendingUser.displayName,
      message: "Dev seed generated pending join request",
    });
    pendingRequestIds.push(
      await findPendingJoinRequestId(group.id, pendingUser.id)
    );
  }

  const predictionUsers = usersForPredictions(config.predictions, owner, members);
  const predictionSummary =
    predictionUsers.length > 0
      ? await insertPredictionsAndSubmissions({
          matchweek: config.matchweek,
          mode: config.mode,
          friendsGroupId: group.id,
          fixtures: selectedFixtures,
          users: predictionUsers,
        })
      : { predictedUsers: 0, submittedUsers: 0, weeklyScores: 0 };

  let scoringResult: ScoreCalculationResult | null = null;
  if (config.mode === "finished" && predictionUsers.length > 0) {
    scoringResult = await weeklyScores.calculateForFriendsGroupMatchweek(
      group.id,
      config.matchweek
    );
  }

  return {
    config,
    owner,
    members,
    pendingUsers,
    group,
    subscriptionStatus: subscriptionResult.subscription.status,
    providerLeagueId,
    providerSeasonId,
    selectedFixtures,
    previousMatchweekResults,
    pendingRequestIds,
    predictionSummary,
    scoringResult,
  };
}

async function seedPreviousFinishedMatchweeks(params: {
  config: ScenarioConfig;
  friendsGroupId: string;
  providerLeagueId: number;
  providerSeasonId: number;
  users: DevScenarioUser[];
}): Promise<MatchweekSeedResult[]> {
  const matchweeks = previousMatchweekLabels(
    params.config.matchweek,
    params.config.seedPreviousFinishedMatchweeks
  );
  const results: MatchweekSeedResult[] = [];

  for (const [index, matchweek] of matchweeks.entries()) {
    const fixtures = await insertGeneratedFixtures({
      matchweek,
      mode: "finished",
      fixtureCount: params.config.fixtureCount,
      startsAtBase: previousFixtureDate(matchweeks.length, index),
      providerLeagueId: params.providerLeagueId,
      providerSeasonId: params.providerSeasonId,
    });
    const predictionSummary = await insertPredictionsAndSubmissions({
      matchweek,
      mode: "finished",
      friendsGroupId: params.friendsGroupId,
      fixtures,
      users: params.users,
    });
    const scoringResult = await weeklyScores.calculateForFriendsGroupMatchweek(
      params.friendsGroupId,
      matchweek
    );

    results.push({
      matchweek,
      mode: "finished",
      fixtures,
      predictionSummary,
      scoringResult,
    });
  }

  return results;
}

async function insertGeneratedFixtures(params: {
  matchweek: string;
  mode: TestMode;
  fixtureCount: number;
  startsAtBase: Date;
  providerLeagueId: number;
  providerSeasonId: number;
}): Promise<FixtureRow[]> {
  const rows: FixtureInsert[] = [];
  const weekNumber = matchweekNumber(params.matchweek);

  for (let i = 0; i < params.fixtureCount; i += 1) {
    const startsAt = new Date(
      params.startsAtBase.getTime() + i * 2 * 60 * 60 * 1000
    );
    const { matchDate, matchTime } = dateParts(startsAt);
    const score = finishedScore(i);

    rows.push({
      provider: "dev-seed",
      sm_fixture_id: 1_800_000_000 + run.numericSeed * 10_000 + weekNumber * 100 + i,
      sm_league_id: params.providerLeagueId,
      sm_season_id: params.providerSeasonId,
      sm_round_id: weekNumber,
      home_team: teamName(i * 2),
      away_team: teamName(i * 2 + 1),
      home_score: params.mode === "finished" ? score.home : null,
      away_score: params.mode === "finished" ? score.away : null,
      live_home_score: null,
      live_away_score: null,
      has_red_card: params.mode === "finished" ? i === 0 : false,
      current_minute: null,
      match_date: matchDate,
      match_time: matchTime,
      starting_at: startsAt.toISOString(),
      matchweek: params.matchweek,
      status: params.mode === "finished" ? "finished" : "scheduled",
      provider_payload: {
        devSeed: true,
        scenarioName,
        runId: run.suffix,
        mode: params.mode,
      },
    });
  }

  const { data, error } = await supabaseService
    .from("fixtures")
    .insert(rows as never)
    .select("*")
    .order("match_date", { ascending: true })
    .order("match_time", { ascending: true });

  if (error) throw new Error(`Insert generated fixtures failed: ${error.message}`);
  return (data ?? []) as FixtureRow[];
}

async function insertPredictionsAndSubmissions(params: {
  matchweek: string;
  mode: TestMode;
  friendsGroupId: string;
  fixtures: FixtureRow[];
  users: DevScenarioUser[];
}) {
  const predictionRows = [];
  const redCardRows = [];
  const submissionRows = [];

  for (const [userIndex, user] of params.users.entries()) {
    for (const [fixtureIndex, fixture] of params.fixtures.entries()) {
      const prediction = predictedScore(fixtureIndex, userIndex, params.mode);
      predictionRows.push({
        user_id: user.id,
        friends_group_id: params.friendsGroupId,
        fixture_id: fixture.id,
        home_score_prediction: prediction.home,
        away_score_prediction: prediction.away,
        updated_at: new Date().toISOString(),
      });
    }

    redCardRows.push({
      user_id: user.id,
      friends_group_id: params.friendsGroupId,
      fixture_id: params.fixtures[userIndex % params.fixtures.length].id,
    });

    submissionRows.push({
      user_id: user.id,
      friends_group_id: params.friendsGroupId,
      matchweek: params.matchweek,
      submitted_at: new Date().toISOString(),
    });
  }

  const { error: predictionError } = await supabaseService
    .from("predictions")
    .insert(predictionRows as never);
  if (predictionError) {
    throw new Error(`Insert predictions failed: ${predictionError.message}`);
  }

  const { error: redCardError } = await supabaseService
    .from("red_card_predictions")
    .insert(redCardRows as never);
  if (redCardError) {
    throw new Error(`Insert red-card predictions failed: ${redCardError.message}`);
  }

  const { error: submissionError } = await supabaseService
    .from("user_submissions")
    .insert(submissionRows as never);
  if (submissionError) {
    throw new Error(`Insert submissions failed: ${submissionError.message}`);
  }

  return {
    predictedUsers: params.users.length,
    submittedUsers: submissionRows.length,
    weeklyScores: 0,
  };
}

async function findPendingJoinRequestId(friendsGroupId: string, userId: string) {
  const { data, error } = await supabaseService
    .from("friends_group_join_requests")
    .select("id")
    .eq("friends_group_id", friendsGroupId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .single();

  if (error) throw new Error(`Read pending join request failed: ${error.message}`);
  return data.id;
}

function usersForPredictions(
  setup: PredictionSetup,
  owner: DevScenarioUser,
  members: DevScenarioUser[]
) {
  if (setup === "none") return [];
  if (setup === "owner") return [owner];
  return [owner, ...members];
}

function firstFixtureDate(mode: TestMode) {
  const now = Date.now();
  const minute = 60 * 1000;
  const day = 24 * 60 * 60 * 1000;
  if (mode === "editable") return new Date(now + 30 * minute);
  if (mode === "locked") return new Date(now - day);
  return new Date(now - 8 * day);
}

function previousFixtureDate(totalPreviousWeeks: number, indexFromOldest: number) {
  const day = 24 * 60 * 60 * 1000;
  const weeksBeforeNow = totalPreviousWeeks - indexFromOldest + 1;
  return new Date(Date.now() - weeksBeforeNow * 7 * day);
}

function dateParts(date: Date) {
  const iso = date.toISOString();
  return {
    matchDate: iso.slice(0, 10),
    matchTime: iso.slice(11, 19),
  };
}

function matchweekNumber(matchweek: string) {
  const parsed = Number(matchweek.match(/\d+/)?.[0]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function previousMatchweekLabels(matchweek: string, shouldSeedPrevious: boolean) {
  if (!shouldSeedPrevious) return [];

  const selectedNumber = matchweekNumber(matchweek);
  const labels: string[] = [];

  for (let weekNumber = 1; weekNumber < selectedNumber; weekNumber += 1) {
    labels.push(`Matchweek ${weekNumber}`);
  }

  return labels;
}

function finishedScore(index: number) {
  return {
    home: (index % 3) + 1,
    away: index % 2,
  };
}

function predictedScore(fixtureIndex: number, userIndex: number, mode: TestMode) {
  const actual = finishedScore(fixtureIndex);
  if (mode === "finished" && userIndex === 0) return actual;
  if (mode === "finished" && userIndex % 2 === 1) {
    return { home: actual.home, away: actual.away + 1 };
  }

  return {
    home: (fixtureIndex + userIndex + 1) % 4,
    away: (fixtureIndex + userIndex) % 3,
  };
}

function teamName(index: number) {
  const teams = [
    "Arsenal",
    "Chelsea",
    "Liverpool",
    "Manchester City",
    "Tottenham",
    "Aston Villa",
    "Brighton",
    "Newcastle",
    "West Ham",
    "Everton",
    "Crystal Palace",
    "Fulham",
    "Brentford",
    "Bournemouth",
    "Wolves",
    "Nottingham Forest",
    "Leeds",
    "Burnley",
    "Sunderland",
    "Southampton",
  ];
  return teams[index % teams.length];
}

function printScenario(params: Awaited<ReturnType<typeof createScenario>>) {
  console.log("");
  console.log("============================================================");
  console.log(`DEV SCENARIO: ${scenarioName}`);
  console.log("============================================================");
  console.log(`Run id: ${run.suffix}`);
  console.log(`Shared password for every user: ${devSeedPassword}`);
  console.log("");

  console.log("COPY/PASTE LOGIN USERS");
  console.log("------------------------------------------------------------");
  printUserBlock(params.owner);
  for (const member of params.members) printUserBlock(member);
  for (const pendingUser of params.pendingUsers) printUserBlock(pendingUser);

  console.log("GROUP");
  console.log("------------------------------------------------------------");
  console.log(`name: ${params.group.name}`);
  console.log(`slug: ${params.group.slug}`);
  console.log(`accessType: ${params.config.access}`);
  console.log(`friendsGroupId: ${params.group.id}`);
  console.log(`inviteToken: ${params.group.invite_token}`);
  console.log(`joinLink: /join/${params.group.invite_token}`);
  console.log(`subscriptionStatus: ${params.subscriptionStatus}`);
  console.log(`providerLeagueId: ${params.providerLeagueId}`);
  console.log(`providerSeasonId: ${params.providerSeasonId}`);
  console.log("");

  console.log("MATCHWEEK");
  console.log("------------------------------------------------------------");
  console.log(`selectedMatchweek: ${params.config.matchweek}`);
  console.log(
    `seedPreviousFinishedMatchweeks: ${params.config.seedPreviousFinishedMatchweeks}`
  );
  console.log(`mode: ${params.config.mode}`);
  console.log(`predictions: ${params.config.predictions}`);
  if (params.selectedFixtures[0]?.starting_at) {
    console.log(`predictionLocksAt: ${params.selectedFixtures[0].starting_at}`);
  }
  console.log(`acceptedMembers: ${params.members.length}`);
  console.log(`pendingRequests: ${params.pendingUsers.length}`);
  if (params.pendingRequestIds.length) {
    console.log(`pendingJoinRequestIds: ${params.pendingRequestIds.join(", ")}`);
  }
  console.log("");

  if (params.previousMatchweekResults.length) {
    console.log("PREVIOUS FINISHED MATCHWEEKS");
    console.log("------------------------------------------------------------");
    for (const matchweekResult of params.previousMatchweekResults) {
      console.log(
        `${matchweekResult.matchweek}: fixtures ${matchweekResult.fixtures.length}, ` +
          `submittedUsers ${matchweekResult.predictionSummary.submittedUsers}, ` +
          `scoredUsers ${matchweekResult.scoringResult?.rows.length ?? 0}`
      );
    }
    console.log("");
  }

  console.log("SELECTED MATCHWEEK FIXTURES");
  console.log("------------------------------------------------------------");
  for (const fixture of params.selectedFixtures) {
    const result =
      fixture.status === "finished"
        ? ` result ${fixture.home_score}-${fixture.away_score}`
        : "";
    console.log(
      `${fixture.id}: ${fixture.home_team} vs ${fixture.away_team} | ${fixture.status} | ${fixture.starting_at}${result}`
    );
  }
  console.log("");

  console.log("PREDICTIONS AND SCORING");
  console.log("------------------------------------------------------------");
  console.log(`predictedUsers: ${params.predictionSummary.predictedUsers}`);
  console.log(`submittedUsers: ${params.predictionSummary.submittedUsers}`);
  if (params.scoringResult) {
    console.log(`scoredUsers: ${params.scoringResult.rows.length}`);
    console.log(`fixturesScored: ${params.scoringResult.fixturesScored}`);
  } else {
    console.log("scoredUsers: 0");
  }
  if (params.previousMatchweekResults.length) {
    const historyScoreRows = params.previousMatchweekResults.reduce(
      (total, result) => total + (result.scoringResult?.rows.length ?? 0),
      0
    );
    console.log(`previousHistoryScoredRows: ${historyScoreRows}`);
  }
  console.log("");

  console.log("QUICK TEST FLOW");
  console.log("------------------------------------------------------------");
  console.log("- log in as owner and open My Groups");
  console.log("- open the matchweek overview for the generated group");
  if (params.previousMatchweekResults.length) {
    console.log("- swipe back to previous matchweeks to test finished history");
  }
  console.log("- use joinLink to test invite flow");
  if (params.pendingUsers.length) {
    console.log("- owner can approve/reject generated pending join requests");
  }
  if (params.config.mode === "editable") {
    console.log(
      "- users can edit and submit predictions; lock is about 30 minutes after generation"
    );
  } else if (params.config.mode === "locked") {
    console.log("- predictions are readonly/revealed because kickoff passed");
  } else {
    console.log("- leaderboard, history, results, and score breakdowns are available");
  }
  console.log("============================================================");
  console.log("");
}
