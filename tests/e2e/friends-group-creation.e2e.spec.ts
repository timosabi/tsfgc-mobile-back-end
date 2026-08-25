import {
  ApiClient,
  assertEqual,
  assertTruthy,
  cleanupE2EData,
  configureE2EEnv,
  isolateMockCompetitionSeason,
  restoreCompetitionSeason,
  startTestServer,
  step,
} from "./helpers.js";
import {
  assertOwnerMembership,
  createFriendsGroup,
  signUpAndSignIn,
} from "./flow-helpers.js";
import { MOCK_LEAGUE_8_SEASON_ID } from "../../src/integrations/sportmonks/mock-service.js";

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "Supabase-e2e-password-123!";

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
  const ownerA = new ApiClient(server.baseUrl, "Creation Owner A");
  const ownerB = new ApiClient(server.baseUrl, "Creation Owner B");

  step("Owners sign up and profiles are created");
  const userA = await signUpAndSignIn({
    client: ownerA,
    email: `e2e-creation-a-${runId}@example.com`,
    password,
    displayName: `E2E Creation A ${runId}`,
  });
  const userB = await signUpAndSignIn({
    client: ownerB,
    email: `e2e-creation-b-${runId}@example.com`,
    password,
    displayName: `E2E Creation B ${runId}`,
  });

  const openSlug = `e2e-creation-open-${runId}`;
  const slugBeforeCreate = await ownerA.get(`/friends-groups/check-slug/${openSlug}`);
  assertEqual(
    slugBeforeCreate.data.available,
    true,
    "slug check returns available before create"
  );

  step("User A creates an open group with active subscription and fixture hydration");
  const openGroup = await createFriendsGroup({
    owner: ownerA,
    name: "E2E Creation Open",
    slug: openSlug,
    accessType: "open",
  });
  assertEqual(openGroup.data.status, "approved", "open group auto-approves");
  assertEqual(openGroup.subscription?.status, "active", "open subscription is active");
  assertEqual(openGroup.hydration?.fixturesSynced, 6, "open group hydrates fixtures");
  assertTruthy(openGroup.data.invite_token, "open group invite token is returned");
  const userAGroups = await ownerA.get("/friends-groups/me/groups");
  const openGroupReload = userAGroups.data.find(
    (row: { friends_group: { id: string } }) =>
      row.friends_group.id === openGroup.data.id
  );
  assertTruthy(openGroupReload, "open group appears in my groups after reload");
  assertEqual(
    openGroupReload.friends_group.invite_token,
    openGroup.data.invite_token,
    "my groups returns invite token for reload/share link"
  );
  assertEqual(
    openGroupReload.friends_group.joinLink,
    `/join/${openGroup.data.invite_token}`,
    "my groups returns join link for reload/share link"
  );
  assertEqual(
    openGroupReload.friends_group.accessType,
    "open",
    "my groups returns access type"
  );
  const groupCardLeagueName = openGroupReload.friends_group.league.name;
  assertTruthy(
    groupCardLeagueName,
    "my groups returns subscribed league name for group cards"
  );
  assertEqual(
    openGroupReload.friends_group.currentMatchweek.weekNumber,
    2,
    "my groups returns current matchweek number for group cards"
  );
  assertEqual(
    openGroupReload.friends_group.currentMatchweek.displayLabel,
    "Matchweek 2",
    "my groups returns group card display label"
  );
  assertEqual(
    openGroupReload.score.points_earned,
    0,
    "my groups returns current user's season score summary"
  );
  assertEqual(
    openGroupReload.score.rank,
    null,
    "my groups score rank is null before any scored weeks"
  );
  await assertOwnerMembership({
    client: ownerA,
    friendsGroupId: openGroup.data.id,
    ownerUserId: userA.id,
  });

  const slugAfterCreate = await ownerA.get(`/friends-groups/check-slug/${openSlug}`);
  assertEqual(
    slugAfterCreate.data.available,
    false,
    "slug check returns unavailable after create"
  );
  await createFriendsGroup({
    owner: ownerB,
    name: "E2E Creation Duplicate",
    slug: openSlug,
    accessType: "open",
    expectedStatus: 409,
  });

  step("Owner can create a second friends group");
  const secondGroup = await createFriendsGroup({
    owner: ownerA,
    name: "E2E Creation Second",
    slug: `e2e-creation-second-${runId}`,
    accessType: "open",
  });
  assertEqual(secondGroup.data.status, "approved", "second owned group auto-approves");

  step("Another user can create a private group and becomes owner");
  const privateGroup = await createFriendsGroup({
    owner: ownerB,
    name: "E2E Creation Private",
    slug: `e2e-creation-private-${runId}`,
    accessType: "private",
  });
  assertEqual(privateGroup.data.status, "approved", "private group auto-approves");
  assertEqual(privateGroup.subscription?.status, "active", "private subscription is active");
  assertTruthy(privateGroup.data.invite_token, "private group invite token is returned");
  await assertOwnerMembership({
    client: ownerB,
    friendsGroupId: privateGroup.data.id,
    ownerUserId: userB.id,
  });

  console.log("\n[E2E] Friends group creation passed.");
} finally {
  try {
    await server.close();
  } finally {
    await cleanupE2EData(supabaseService, { friends: true, auth: true });
    await restoreCompetitionSeason(supabaseService, 8, originalSeasonId);
  }
}
