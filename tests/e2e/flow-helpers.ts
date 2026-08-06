import {
  ApiClient,
  assertEqual,
  assertTruthy,
  detail,
} from "./helpers.js";

type FixtureRef = {
  id: number;
  status: string;
  home_team: string;
  away_team: string;
};
type OverviewMemberRef = {
  userId: string;
  role: "owner" | "member";
};

type GroupCreateResponse = {
  data: {
    id: string;
    invite_token: string;
    status: string;
    is_open?: boolean;
  };
  subscription?: {
    status: string;
  };
  hydration?: {
    fixturesSynced: number;
  };
};

export type TestUser = {
  client: ApiClient;
  id: string;
  email: string;
};

export type TestGroup = {
  id: string;
  inviteToken: string;
};

export async function signUpAndSignIn(params: {
  client: ApiClient;
  email: string;
  password: string;
  displayName: string;
}): Promise<TestUser> {
  const signup = await params.client.post("/auth/sign-up", {
    email: params.email,
    password: params.password,
    displayName: params.displayName,
  });
  await params.client.post("/auth/sign-in", {
    email: params.email,
    password: params.password,
  });
  const me = await params.client.get("/auth/me");
  assertEqual(signup.user.id, me.user.id, `${params.displayName} auth id is stable`);

  return {
    client: params.client,
    id: me.user.id,
    email: params.email,
  };
}

export async function createFriendsGroup(params: {
  owner: ApiClient;
  name: string;
  slug: string;
  accessType: "open" | "private";
  expectedStatus?: number;
}): Promise<GroupCreateResponse> {
  return params.owner.post(
    "/friends-groups",
    {
      payload: {
        name: params.name,
        slug: params.slug,
        accessType: params.accessType,
        subscription: {
          providerLeagueId: 8,
          providerSeasonId: 25583,
          competitionName: "Premier League",
          countryName: "England",
          seasonName: "2025/2026",
        },
      },
    },
    params.expectedStatus ?? 200
  );
}

export async function assertOwnerMembership(params: {
  client: ApiClient;
  friendsGroupId: string;
  ownerUserId: string;
}) {
  const overview = await params.client.get(
    `/friends-groups/${params.friendsGroupId}/matchweeks/current/overview`
  );
  const ownerMembership = overview.data.members.find(
    (row: OverviewMemberRef) => row.userId === params.ownerUserId
  );
  assertTruthy(ownerMembership, "owner is present in member list");
  assertEqual(ownerMembership.role, "owner", "creator membership has owner role");
}

export async function joinOpenInvite(params: {
  client: ApiClient;
  inviteToken: string;
  expectedStatus?: number;
}) {
  return params.client.post(
    `/friends-groups/invite/${params.inviteToken}/join`,
    undefined,
    params.expectedStatus ?? 200
  );
}

export async function requestPrivateInvite(params: {
  client: ApiClient;
  inviteToken: string;
  message?: string;
  expectedStatus?: number;
}) {
  return params.client.post(
    `/friends-groups/invite/${params.inviteToken}/join`,
    {
      message: params.message ?? "Please add me",
      userDisplayName: params.client.label,
    },
    params.expectedStatus ?? 202
  );
}

export async function findPendingJoinRequest(params: {
  owner: ApiClient;
  friendsGroupId: string;
  userId: string;
}) {
  const pending = await params.owner.get(
    `/friends-groups/${params.friendsGroupId}/requests/pending`
  );
  const request = pending.data.find(
    (row: { id: string; user_id: string }) => row.user_id === params.userId
  );
  assertTruthy(request, `pending join request exists for ${params.userId}`);
  return request;
}

export async function fixturesForMatchweek(params: {
  client: ApiClient;
  friendsGroupId: string;
  matchweek: string;
}): Promise<FixtureRef[]> {
  const response = await params.client.get(
    `/friends-groups/${params.friendsGroupId}/matchweeks/${encodeURIComponent(
      params.matchweek
    )}/predictions/mine`
  );
  return response.data.fixtures as FixtureRef[];
}

export function fixtureByTeams(
  fixtures: FixtureRef[],
  homeTeam: string,
  awayTeam: string
): FixtureRef {
  const fixture = fixtures.find(
    (row) => row.home_team === homeTeam && row.away_team === awayTeam
  );
  if (!fixture) {
    throw new Error(`${homeTeam} v ${awayTeam} fixture exists`);
  }
  assertTruthy(fixture, `${homeTeam} v ${awayTeam} fixture exists`);
  return fixture;
}

export async function saveSlip(params: {
  client: ApiClient;
  friendsGroupId: string;
  matchweek: string;
  predictions: Array<{ fixtureId: number; homeScore: number; awayScore: number }>;
  redCardFixtureId?: number;
  redCardFixtureIds?: number[];
  expectedStatus?: number;
}) {
  return params.client.put(
    `/friends-groups/${params.friendsGroupId}/matchweeks/${encodeURIComponent(
      params.matchweek
    )}/predictions/mine`,
    {
      predictions: params.predictions,
      ...(params.redCardFixtureId === undefined
        ? {}
        : { redCardFixtureId: params.redCardFixtureId }),
      ...(params.redCardFixtureIds === undefined
        ? {}
        : { redCardFixtureIds: params.redCardFixtureIds }),
    },
    params.expectedStatus ?? 200
  );
}

export async function submitSlip(params: {
  client: ApiClient;
  friendsGroupId: string;
  matchweek: string;
  expectedStatus?: number;
}) {
  return params.client.post(
    `/friends-groups/${params.friendsGroupId}/matchweeks/${encodeURIComponent(
      params.matchweek
    )}/predictions/mine/submit`,
    undefined,
    params.expectedStatus ?? 200
  );
}

export async function saveAndSubmitSlip(params: {
  client: ApiClient;
  friendsGroupId: string;
  matchweek: string;
  predictions: Array<{ fixtureId: number; homeScore: number; awayScore: number }>;
  redCardFixtureId: number;
}) {
  await saveSlip(params);
  await submitSlip(params);
  detail(`ok: ${params.client.label} submitted ${params.matchweek} prediction slip`);
}
