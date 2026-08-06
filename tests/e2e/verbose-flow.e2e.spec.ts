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
  assertOwnerMembership,
  createFriendsGroup,
  signUpAndSignIn,
} from "./flow-helpers.js";

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "Supabase-e2e-password-123!";

configureE2EEnv();

const { supabaseService } = await import(
  "../../src/integrations/supabase/supabaseClient.js"
);

await cleanupE2EData(supabaseService, { friends: true, auth: true });
const server = await startTestServer();

try {
  const userClient = new ApiClient(server.baseUrl, "Smoke User");

  step("Smoke user can sign up, create a group, and load the main FE overview");
  const user = await signUpAndSignIn({
    client: userClient,
    email: `e2e-smoke-user-${runId}@example.com`,
    password,
    displayName: `E2E Smoke User ${runId}`,
  });

  const group = await createFriendsGroup({
    owner: userClient,
    name: "E2E Smoke Group",
    slug: `e2e-smoke-${runId}`,
    accessType: "open",
  });
  assertEqual(group.data.status, "approved", "smoke group auto-approves");
  assertTruthy(group.data.invite_token, "smoke group has invite token");
  await assertOwnerMembership({
    client: userClient,
    friendsGroupId: group.data.id,
    ownerUserId: user.id,
  });

  const overview = await userClient.get(
    `/friends-groups/${group.data.id}/matchweeks/current/overview`
  );
  assertEqual(overview.data.friendsGroup.id, group.data.id, "overview loads created group");
  assertTruthy(overview.data.fixtures.length > 0, "overview includes hydrated fixtures");

  console.log("\n[E2E] Smoke verbose flow passed.");
} finally {
  try {
    await server.close();
  } finally {
    await cleanupE2EData(supabaseService, { friends: true, auth: true });
  }
}
