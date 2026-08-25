import "dotenv/config";
import { strict as assert } from "node:assert";
import {
  ApiClient,
  approveE2EUser,
  assertEqual,
  assertTruthy,
  detail,
  startTestServer,
  step,
} from "./helpers.js";

process.env.NODE_ENV = "test";
process.env.SPORTMONKS_USE_MOCK = "false";
process.env.CRON_ENABLED = "false";

const missing = [
  "LOVABLE_SUPABASE_URL",
  "LOVABLE_SUPABASE_PUBLISHABLE_KEY",
  "LOVABLE_SUPABASE_SERVICE_ROLE_KEY",
].filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(
    `Missing required Supabase env vars for real SportMonks smoke: ${missing.join(", ")}`
  );
}
if (!process.env.SPORTMONKS_TOKEN && !process.env.SPORTMONKS_API_TOKEN) {
  throw new Error(
    "Missing SPORTMONKS_TOKEN or SPORTMONKS_API_TOKEN for real SportMonks smoke"
  );
}

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "RealSportmonksSmoke123!";
const email = `e2e-real-sportmonks-${runId}@example.com`;
const displayName = `E2E Real SportMonks ${runId}`;
const groupName = `E2E Real SportMonks ${runId}`;
const groupSlug = `e2e-real-sportmonks-${runId}`;
const providerLeagueId = Number(process.env.REAL_SPORTMONKS_LEAGUE_ID ?? 501);

const { supabaseService } = await import(
  "../../src/integrations/supabase/supabaseClient.js"
);

assertLocalSupabaseUrl(process.env.LOVABLE_SUPABASE_URL!);

const server = await startTestServer();
let createdUserId: string | null = null;
let createdGroupId: string | null = null;

try {
  const client = new ApiClient(server.baseUrl, "Real SportMonks Smoke");

  step("Create a real API user and sign in");
  const signup = await client.post("/auth/sign-up", {
    email,
    password,
    displayName,
  });
  createdUserId = readString(signup, ["user", "id"]);
  detail(
    JSON.stringify(
      {
        email,
        userId: createdUserId,
        profileId: readString(signup, ["profile", "id"], true),
      },
      null,
      2
    )
  );

  await client.post("/auth/sign-in", { email, password });
  const me = await client.get("/auth/me");
  assertEqual(readString(me, ["user", "id"]), createdUserId, "signed-in user id matches signup");
  await approveE2EUser(supabaseService, createdUserId!);

  step(`Read competition catalog and verify league ${providerLeagueId} has a current season`);
  const catalog = await client.get("/friends-groups/competitions");
  const competitions = readArray(catalog, ["data"]);
  const competition = competitions.find(
    (row) => readNumber(row, ["provider_league_id"]) === providerLeagueId
  );
  assertTruthy(competition, `catalog includes league ${providerLeagueId}`);

  const catalogSummary = {
    providerLeagueId: readNumber(competition, ["provider_league_id"]),
    name: readString(competition, ["name"]),
    countryName: readString(competition, ["country_name"], true),
    currentProviderSeasonId: readNumber(
      competition,
      ["current_provider_season_id"]
    ),
    seasonsCount: readArray(competition, ["seasons"]).length,
    firstSeason: firstSeasonSummary(competition),
  };
  detail(JSON.stringify(catalogSummary, null, 2));
  assertTruthy(
    catalogSummary.currentProviderSeasonId,
    "catalog resolved current provider season id"
  );
  assertTruthy(catalogSummary.seasonsCount > 0, "catalog includes season rows");

  step("Create friends group with providerLeagueId only");
  const group = await client.post("/friends-groups", {
    payload: {
      name: groupName,
      slug: groupSlug,
      accessType: "open",
      subscription: { providerLeagueId },
    },
  });
  createdGroupId = readString(group, ["data", "id"]);

  const groupSummary = {
    groupId: createdGroupId,
    groupStatus: readString(group, ["data", "status"]),
    inviteToken: readString(group, ["data", "invite_token"]),
    subscriptionStatus: readString(group, ["subscription", "status"]),
    subscriptionLeagueId: readNumber(group, [
      "subscription",
      "provider_league_id",
    ]),
    subscriptionSeasonId: readNumber(group, [
      "subscription",
      "provider_season_id",
    ]),
    fixturesSynced: readNumber(group, ["hydration", "fixturesSynced"]),
  };
  detail(JSON.stringify(groupSummary, null, 2));
  assertEqual(groupSummary.groupStatus, "approved", "group is approved");
  assertEqual(
    groupSummary.subscriptionLeagueId,
    providerLeagueId,
    "subscription league matches selected league"
  );
  assertTruthy(
    groupSummary.subscriptionSeasonId,
    "backend resolved subscription season id"
  );
  assertTruthy(groupSummary.fixturesSynced > 0, "season hydration synced fixtures");

  step("Verify hydrated fixture count in DB for subscribed league/season");
  const { count, error } = await supabaseService
    .from("fixtures")
    .select("id", { count: "exact", head: true })
    .eq("sm_league_id", providerLeagueId)
    .eq("sm_season_id", groupSummary.subscriptionSeasonId);
  if (error) throw new Error(`fixture count failed: ${error.message}`);

  detail(
    JSON.stringify(
      {
        providerLeagueId,
        providerSeasonId: groupSummary.subscriptionSeasonId,
        fixtureCount: count,
      },
      null,
      2
    )
  );
  assertTruthy((count ?? 0) > 0, "DB has hydrated fixtures for league/season");

  step("Load FE current matchweek overview after group creation");
  const overview = await client.get(
    `/friends-groups/${createdGroupId}/matchweeks/current/overview`
  );
  const overviewData = readRecord(overview, ["data"]);
  const overviewFixtures = readArray(overviewData, ["fixtures"]);
  const overviewSummary = {
    selectedMatchweek: readString(overviewData, ["selectedMatchweek"]),
    state: readString(overviewData, ["state"]),
    locksAt: readString(overviewData, ["locksAt"]),
    fixturesReturned: overviewFixtures.length,
    membersReturned: readArray(overviewData, ["members"]).length,
    firstFixture: firstFixtureSummary(overviewFixtures[0]),
  };
  detail(JSON.stringify(overviewSummary, null, 2));
  assertEqual(
    readString(overviewData, ["friendsGroup", "id"]),
    createdGroupId,
    "overview belongs to created group"
  );
  assertTruthy(overviewFixtures.length > 0, "overview returns hydrated fixtures");

  console.log("\n[E2E] Real SportMonks smoke flow passed.");
} finally {
  try {
    step("Cleanup temporary user/group created by real SportMonks smoke");
    if (createdGroupId) {
      await supabaseService.from("friends_groups").delete().eq("id", createdGroupId);
      detail(`deleted friendsGroupId=${createdGroupId}`);
    }
    if (createdUserId) {
      await supabaseService.from("profiles").delete().eq("id", createdUserId);
      await supabaseService.auth.admin.deleteUser(createdUserId);
      detail(`deleted userId=${createdUserId}`);
    }
    detail("kept shared real SportMonks catalog and fixtures in local DB");
  } finally {
    await server.close();
  }
}

function assertLocalSupabaseUrl(rawUrl: string) {
  if (process.env.E2E_ALLOW_NON_LOCAL_DB === "true") return;

  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!localHosts.has(url.hostname)) {
    throw new Error(
      `Refusing to run real SportMonks smoke against non-local Supabase URL: ${rawUrl}. ` +
        "Use local Supabase or set E2E_ALLOW_NON_LOCAL_DB=true intentionally."
    );
  }
}

function readRecord(value: unknown, path: string[]) {
  const found = readPath(value, path);
  if (!found || typeof found !== "object" || Array.isArray(found)) {
    throw new Error(`Expected object at ${path.join(".")}`);
  }
  return found as Record<string, unknown>;
}

function readArray(value: unknown, path: string[]) {
  const found = readPath(value, path);
  if (!Array.isArray(found)) throw new Error(`Expected array at ${path.join(".")}`);
  return found;
}

function readString(value: unknown, path: string[], nullable = false) {
  const found = readPath(value, path);
  if (nullable && (found === null || found === undefined)) return null;
  if (typeof found !== "string") throw new Error(`Expected string at ${path.join(".")}`);
  return found;
}

function readNumber(value: unknown, path: string[]) {
  const found = readPath(value, path);
  const numeric = Number(found);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Expected number at ${path.join(".")}`);
  }
  return numeric;
}

function readPath(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function firstSeasonSummary(competition: unknown) {
  const firstSeason = readArray(competition, ["seasons"])[0];
  if (!firstSeason) return null;
  return {
    providerSeasonId: readNumber(firstSeason, ["provider_season_id"]),
    name: readString(firstSeason, ["name"], true),
    isCurrent: Boolean(readPath(firstSeason, ["is_current"])),
  };
}

function firstFixtureSummary(fixture: unknown) {
  if (!fixture) return null;
  return {
    id: readNumber(fixture, ["id"]),
    homeTeam: readString(fixture, ["home_team"]),
    awayTeam: readString(fixture, ["away_team"]),
    status: readString(fixture, ["status"]),
    startingAt: readString(fixture, ["starting_at"], true),
  };
}
