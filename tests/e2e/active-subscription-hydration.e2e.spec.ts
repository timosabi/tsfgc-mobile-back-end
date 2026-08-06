import { strict as assert } from "node:assert";
import {
  assertEqual,
  assertTruthy,
  configureE2EEnv,
  detail,
  step,
} from "./helpers.js";
import { SportMonksHydrationService } from "../../src/integrations/sportmonks/hydration-service.js";
import type { FixtureInsert } from "../../src/services/dto/types.js";

configureE2EEnv();

const { supabaseService } = await import(
  "../../src/integrations/supabase/supabaseClient.js"
);

const db = supabaseService;
const runNumber = Date.now() % 1_000_000_000;
const leagueId = 910_000_000 + runNumber;
const seasonId = 920_000_000 + runNumber;
const fixtureId = 930_000_000 + runNumber;
const finishedFixtureId = fixtureId + 1;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

class FakeSportMonks {
  scheduleCalls: Array<{ leagueId: string; seasonId?: string }> = [];
  finishedCalls: Array<{ days: number; leagueIds?: number[] }> = [];

  scheduleFixture: FixtureInsert = makeFixture({
    smFixtureId: fixtureId,
    status: "scheduled",
    matchDate: "2026-08-15",
  });

  finishedFixtures: FixtureInsert[] = [
    makeFixture({
      smFixtureId: finishedFixtureId,
      status: "finished",
      matchDate: "2026-08-16",
      homeScore: 2,
      awayScore: 1,
      hasRedCard: true,
    }),
  ];

  async getFixturesByLeague(leagueIdArg: string, seasonIdArg?: string) {
    this.scheduleCalls.push({ leagueId: leagueIdArg, seasonId: seasonIdArg });
    if (Number(leagueIdArg) !== leagueId || Number(seasonIdArg) !== seasonId) {
      return [];
    }
    return [this.scheduleFixture];
  }

  async getUpcomingFixtures() {
    this.scheduleCalls.push({ leagueId: String(leagueId) });
    return [this.scheduleFixture];
  }

  async getFinishedFixtures(days = 2, leagueIds?: number[]) {
    this.finishedCalls.push({ days, leagueIds });
    return this.finishedFixtures;
  }
}

await cleanup();

try {
  step("Creating duplicate active subscriptions for the same league season");
  const { competition, season } = await createCompetitionAndSeason();
  const groups = await createGroupsWithActiveSubscriptions(
    competition.id,
    season.id
  );

  assertEqual(groups.length, 2, "two friendGroups use same subscription target");

  const fakeSportMonks = new FakeSportMonks();
  const hydration = new SportMonksHydrationService(
    fakeSportMonks as unknown as ConstructorParameters<
      typeof SportMonksHydrationService
    >[0],
    supabaseService
  );

  step("Daily refresh hydrates each unique league-season once");
  const firstRefresh = await hydration.hydrateActiveSubscriptionSchedules();

  assertTruthy(firstRefresh.subscriptionsFound >= 2, "at least our two subscriptions found");
  assertEqual(
    fakeSportMonks.scheduleCalls.filter(
      (call) =>
        Number(call.leagueId) === leagueId && Number(call.seasonId) === seasonId
    ).length,
    1,
    "our duplicate subscriptions make one SportMonks schedule call"
  );

  let fixture = await getFixture(fixtureId);
  assertEqual(fixture.status, "scheduled", "fixture starts scheduled");
  assertEqual(fixture.match_date, "2026-08-15", "fixture date stored");

  step("Daily refresh updates a postponed/rescheduled fixture");
  fakeSportMonks.scheduleFixture = makeFixture({
    smFixtureId: fixtureId,
    status: "postponed",
    matchDate: "2026-09-01",
  });

  const secondRefresh = await hydration.hydrateActiveSubscriptionSchedules();
  assertTruthy(secondRefresh.targetsHydrated >= 1, "same unique target refreshed");
  assertEqual(
    fakeSportMonks.scheduleCalls.filter(
      (call) =>
        Number(call.leagueId) === leagueId && Number(call.seasonId) === seasonId
    ).length,
    2,
    "second daily schedule call made for our target"
  );

  fixture = await getFixture(fixtureId);
  assertEqual(fixture.status, "postponed", "fixture status updated to postponed");
  assertEqual(fixture.match_date, "2026-09-01", "fixture date updated");

  step("Recent finished refresh is league-level, not group/user-level");
  const finishedRefresh =
    await hydration.hydrateRecentFinishedForActiveSubscriptions(2);

  assertEqual(finishedRefresh.fixturesSynced, 1, "one finished fixture synced");
  assertEqual(fakeSportMonks.finishedCalls.length, 1, "one SportMonks finished call");
  assertTruthy(
    fakeSportMonks.finishedCalls[0].leagueIds?.includes(leagueId),
    "finished refresh includes our subscribed league id"
  );
  assertEqual(
    fakeSportMonks.finishedCalls[0].leagueIds?.filter((id) => id === leagueId)
      .length,
    1,
    "finished refresh dedupes our subscribed league id"
  );

  const finishedFixture = await getFixture(finishedFixtureId);
  assertEqual(finishedFixture.status, "finished", "finished fixture stored");
  assertEqual(finishedFixture.home_score, 2, "finished home score stored");
  assertEqual(finishedFixture.away_score, 1, "finished away score stored");
  assertEqual(finishedFixture.has_red_card, true, "finished red-card flag stored");

  detail("ok: active subscription hydration stays low-call and catches schedule changes");
  console.log("\n[E2E] Active subscription hydration passed.");
} finally {
  await cleanup();
}

function makeFixture(options: {
  smFixtureId: number;
  status: string;
  matchDate: string;
  homeScore?: number | null;
  awayScore?: number | null;
  hasRedCard?: boolean | null;
}): FixtureInsert {
  return {
    provider: "e2e-cron",
    sm_fixture_id: options.smFixtureId,
    sm_league_id: leagueId,
    sm_season_id: seasonId,
    sm_round_id: 1,
    home_team: "Cron Home",
    away_team: "Cron Away",
    home_score: options.homeScore ?? null,
    away_score: options.awayScore ?? null,
    has_red_card: options.hasRedCard ?? null,
    match_date: options.matchDate,
    match_time: "15:00:00",
    starting_at: `${options.matchDate}T15:00:00Z`,
    matchweek: "Matchweek 1",
    status: options.status,
    provider_payload: { e2e: true, runId },
  };
}

async function createCompetitionAndSeason() {
  const { data: competition, error: competitionError } = await db
    .from("football_competitions")
    .insert({
      provider: "sportmonks",
      provider_league_id: leagueId,
      name: `E2E Cron League ${runId}`,
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
      name: "E2E Cron Season",
      is_current: false,
    })
    .select("*")
    .single();
  if (seasonError) throw seasonError;

  return { competition, season };
}

async function createGroupsWithActiveSubscriptions(
  competitionId: string,
  seasonRowId: string
) {
  const groupsToInsert = [1, 2].map((n) => ({
    name: `E2E Cron Group ${n}`,
    slug: `e2e-cron-${runId}-${n}`,
    created_by: crypto.randomUUID(),
    status: "approved",
  }));

  const { data: groups, error: groupsError } = await db
    .from("friends_groups")
    .insert(groupsToInsert)
    .select("*")
    .order("slug", { ascending: true });
  if (groupsError) throw groupsError;

  const subscriptions = groups.map((group: { id: string; created_by: string }) => ({
    friends_group_id: group.id,
    competition_id: competitionId,
    season_id: seasonRowId,
    provider: "sportmonks",
    provider_league_id: leagueId,
    provider_season_id: seasonId,
    status: "active",
    created_by: group.created_by,
  }));

  const { error: subscriptionError } = await db
    .from("friends_group_subscriptions")
    .insert(subscriptions);
  if (subscriptionError) throw subscriptionError;

  return groups;
}

async function getFixture(smFixtureId: number) {
  const { data, error } = await db
    .from("fixtures")
    .select("*")
    .eq("sm_fixture_id", smFixtureId)
    .single();
  if (error) throw error;
  assertTruthy(data, `fixture ${smFixtureId} exists`);
  return data;
}

async function cleanup() {
  await db.from("friends_groups").delete().like("slug", "e2e-cron-%");
  await db.from("fixtures").delete().eq("sm_league_id", leagueId);
  await db
    .from("football_competitions")
    .delete()
    .eq("provider_league_id", leagueId);
}
