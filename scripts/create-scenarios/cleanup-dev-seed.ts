import "dotenv/config";
import { env } from "node:process";
import type { User } from "@supabase/supabase-js";
import { supabaseService } from "../../src/integrations/supabase/supabaseClient.js";
import type { Database } from "../../src/integrations/supabase/types.js";
import {
  askRadioChoice,
  assertLocalSupabaseUrl,
  assertSupabaseApiReachable,
  createCliPrompts,
  printDevScenarioErrorAndExit,
  readArg,
} from "./lib/dev-scenario-utils.js";

type CleanupCounts = Record<string, number>;
type TableName = keyof Database["public"]["Tables"];
type ListIdsResult = {
  data: Array<Record<string, string | number>> | null;
  error: { message: string } | null;
};
type FilterableQuery = {
  like(column: string, pattern: string): FilterableQuery;
  eq(column: string, value: unknown): FilterableQuery;
  or(filters: string): FilterableQuery;
  then: PromiseLike<ListIdsResult>["then"];
};
type DeleteQuery = {
  delete(): {
    in(column: string, values: Array<string | number>): {
      select(column: string): Promise<{
        data: unknown[] | null;
        error: { message: string } | null;
      }>;
    };
  };
};

assertLocalSupabaseUrl(env.LOVABLE_SUPABASE_URL);
await assertSupabaseApiReachable(env.LOVABLE_SUPABASE_URL).catch(
  printDevScenarioErrorAndExit
);

const rl = createCliPrompts();

try {
  const shouldCleanup = await confirmCleanup();
  if (!shouldCleanup) {
    console.log("Cleanup cancelled. No data changed.");
    process.exit(0);
  }

  const counts = await cleanupDevSeedData();
  printSummary(counts);
} finally {
  rl.close();
}

async function confirmCleanup() {
  if (readArg("yes") === "true" || readArg("yes") === "1") return true;

  console.log("");
  console.log("Cleanup Dev Seed Scenario Data");
  console.log("------------------------------------------------------------");
  console.log("This deletes only local data created by scripts/create-scenarios:");
  console.log("- auth users with email starting dev-seed-");
  console.log("- profiles for those users");
  console.log("- groups with slug starting dev-seed- and their related rows");
  console.log("- fixtures where provider is dev-seed");
  console.log("- generated Dev Seed competition/season catalog rows");
  console.log("");

  const answer = await askRadioChoice({
    rl,
    argName: "confirm",
    label: "Delete dev seed data",
    choices: ["no", "yes"] as const,
    defaultValue: "no",
  });

  return answer === "yes";
}

async function cleanupDevSeedData() {
  const counts: CleanupCounts = {};
  const devUsers = await listDevSeedAuthUsers();
  const devUserIds = devUsers.map((user) => user.id);
  const devGroupIds = await listIds("friends_groups", "id", (query) =>
    query.like("slug", "dev-seed-%")
  );
  const devFixtureIds = await listIds("fixtures", "id", (query) =>
    query.eq("provider", "dev-seed")
  );
  const devCompetitionIds = await listIds("football_competitions", "id", (query) =>
    query.or("name.ilike.Dev Seed%,country_name.eq.Dev Seed,provider_league_id.gte.1600000000")
  );

  if (devGroupIds.length > 0) {
    counts.liveFeedEventsByGroup = await deleteByIds(
      "live_feed_events",
      "friends_group_id",
      devGroupIds
    );
    counts.notificationSubscriptionsByGroup = await deleteByIds(
      "notification_subscriptions",
      "friends_group_id",
      devGroupIds
    );
    counts.weeklyScoresByGroup = await deleteByIds(
      "weekly_scores",
      "friends_group_id",
      devGroupIds
    );
    counts.userSubmissionsByGroup = await deleteByIds(
      "user_submissions",
      "friends_group_id",
      devGroupIds
    );
    counts.redCardPredictionsByGroup = await deleteByIds(
      "red_card_predictions",
      "friends_group_id",
      devGroupIds
    );
    counts.predictionsByGroup = await deleteByIds(
      "predictions",
      "friends_group_id",
      devGroupIds
    );
    counts.joinRequests = await deleteByIds(
      "friends_group_join_requests",
      "friends_group_id",
      devGroupIds
    );
    counts.memberships = await deleteByIds(
      "friends_group_users",
      "friends_group_id",
      devGroupIds
    );
    counts.subscriptions = await deleteByIds(
      "friends_group_subscriptions",
      "friends_group_id",
      devGroupIds
    );
  }

  if (devUserIds.length > 0) {
    counts.notificationSubscriptionsByUser = await deleteByIds(
      "notification_subscriptions",
      "user_id",
      devUserIds
    );
    counts.weeklyScoresByUser = await deleteByIds("weekly_scores", "user_id", devUserIds);
    counts.userSubmissionsByUser = await deleteByIds(
      "user_submissions",
      "user_id",
      devUserIds
    );
    counts.redCardPredictionsByUser = await deleteByIds(
      "red_card_predictions",
      "user_id",
      devUserIds
    );
    counts.predictionsByUser = await deleteByIds("predictions", "user_id", devUserIds);
    counts.joinRequestsByUser = await deleteByIds(
      "friends_group_join_requests",
      "user_id",
      devUserIds
    );
    counts.membershipsByUser = await deleteByIds(
      "friends_group_users",
      "user_id",
      devUserIds
    );
  }

  if (devFixtureIds.length > 0) {
    counts.liveFeedEventsByFixture = await deleteByIds(
      "live_feed_events",
      "fixture_id",
      devFixtureIds
    );
    counts.matchEvents = await deleteByIds("match_events", "fixture_id", devFixtureIds);
    counts.redCardPredictionsByFixture = await deleteByIds(
      "red_card_predictions",
      "fixture_id",
      devFixtureIds
    );
    counts.predictionsByFixture = await deleteByIds(
      "predictions",
      "fixture_id",
      devFixtureIds
    );
  }

  counts.groups = await deleteByIds("friends_groups", "id", devGroupIds);
  counts.fixtures = await deleteByIds("fixtures", "id", devFixtureIds);

  if (devCompetitionIds.length > 0) {
    counts.seasons = await deleteByIds(
      "football_seasons",
      "competition_id",
      devCompetitionIds
    );
    counts.competitions = await deleteByIds(
      "football_competitions",
      "id",
      devCompetitionIds
    );
  }

  if (devUserIds.length > 0) {
    counts.profiles = await deleteByIds("profiles", "id", devUserIds);
  }
  counts.authUsers = await deleteDevSeedAuthUsers(devUsers);

  return counts;
}

async function listDevSeedAuthUsers() {
  const users: User[] = [];
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await supabaseService.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw new Error(`List auth users failed: ${error.message}`);

    const pageUsers = data.users ?? [];
    users.push(
      ...pageUsers.filter((user) => user.email?.startsWith("dev-seed-"))
    );

    if (pageUsers.length < perPage) break;
    page += 1;
  }

  return users;
}

async function deleteDevSeedAuthUsers(users: User[]) {
  let deleted = 0;
  for (const user of users) {
    const { error } = await supabaseService.auth.admin.deleteUser(user.id);
    if (error) {
      throw new Error(`Delete auth user ${user.email ?? user.id} failed: ${error.message}`);
    }
    deleted += 1;
  }
  return deleted;
}

async function listIds(
  tableName: TableName,
  columnName: string,
  applyFilter: (query: FilterableQuery) => FilterableQuery
) {
  const query = applyFilter(
    supabaseService.from(tableName).select(columnName) as unknown as FilterableQuery
  );
  const { data, error } = await query;
  if (error) throw new Error(`List ${String(tableName)} failed: ${error.message}`);

  return ((data ?? []) as Array<Record<string, string | number>>).map(
    (row) => row[columnName]
  );
}

async function deleteByIds(
  tableName: TableName,
  columnName: string,
  ids: Array<string | number>
) {
  if (ids.length === 0) return 0;

  let deleted = 0;
  for (const chunk of chunks(ids, 500)) {
    const { data, error } = await (supabaseService.from(tableName) as unknown as DeleteQuery)
      .delete()
      .in(columnName, chunk)
      .select(columnName);

    if (error) throw new Error(`Delete ${String(tableName)} failed: ${error.message}`);
    deleted += data?.length ?? 0;
  }

  return deleted;
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function printSummary(counts: CleanupCounts) {
  console.log("");
  console.log("============================================================");
  console.log("DEV SEED CLEANUP COMPLETE");
  console.log("================================================------------");
  for (const [key, value] of Object.entries(counts)) {
    console.log(`${key}: ${value}`);
  }
  console.log("============================================================");
  console.log("");
}
