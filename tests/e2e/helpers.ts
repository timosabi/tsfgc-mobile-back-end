import "dotenv/config";
import { strict as assert } from "node:assert";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient, User as AuthUser } from "@supabase/supabase-js";
import type { Database } from "../../src/integrations/supabase/types.js";

type JsonBody = Record<string, unknown> | unknown[] | undefined;
type ApiJson = any;
type TestDb = SupabaseClient<Database>;
type TableName = keyof Database["public"]["Tables"];
type TableInsert<T extends TableName> =
  Database["public"]["Tables"][T]["Insert"];

export function configureE2EEnv(adminEmail?: string) {
  process.env.NODE_ENV = "test";
  process.env.SPORTMONKS_USE_MOCK = "true";
  process.env.CRON_ENABLED = "false";

  if (adminEmail) {
    const existing = process.env.ADMIN_EMAILS ?? "";
    process.env.ADMIN_EMAILS = [adminEmail, existing]
      .filter(Boolean)
      .join(",");
  }

  const missing = [
    "LOVABLE_SUPABASE_URL",
    "LOVABLE_SUPABASE_PUBLISHABLE_KEY",
    "LOVABLE_SUPABASE_SERVICE_ROLE_KEY",
  ].filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(
      `Missing required Supabase env vars for E2E: ${missing.join(", ")}`
    );
  }

  assertLocalSupabaseUrl(process.env.LOVABLE_SUPABASE_URL!);
}

export async function startTestServer() {
  const { app } = await import("../../src/app.js");

  const server: Server = await new Promise((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export class ApiClient {
  private cookies = new Map<string, string>();

  constructor(
    private baseUrl: string,
    public readonly label: string
  ) {}

  async get<T = ApiJson>(path: string, expectedStatus = 200) {
    return this.request<T>("GET", path, undefined, expectedStatus);
  }

  async post<T = ApiJson>(path: string, body?: JsonBody, expectedStatus = 200) {
    return this.request<T>("POST", path, body, expectedStatus);
  }

  async put<T = ApiJson>(path: string, body?: JsonBody, expectedStatus = 200) {
    return this.request<T>("PUT", path, body, expectedStatus);
  }

  async request<T = ApiJson>(
    method: string,
    path: string,
    body?: JsonBody,
    expectedStatus = 200
  ) {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookies.size) {
      headers.Cookie = Array.from(this.cookies.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    this.captureCookies(response);

    const text = await response.text();
    const parsed = text ? tryJson(text) : null;

    if (response.status !== expectedStatus) {
      throw new Error(
        `${this.label} ${method} ${path} expected ${expectedStatus}, got ${
          response.status
        }: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`
      );
    }

    return parsed as T;
  }

  private captureCookies(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(";")[0];
      const eq = first.indexOf("=");
      if (eq <= 0) continue;

      const name = first.slice(0, eq);
      const value = first.slice(eq + 1);
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

export function step(message: string) {
  console.log(`\n[E2E] ${message}`);
}

export function detail(message: string) {
  console.log(`      ${message}`);
}

export function assertEqual<T>(actual: T, expected: T, message: string) {
  assert.equal(actual, expected, message);
  detail(`ok: ${message}`);
}

export function assertTruthy(value: unknown, message: string) {
  assert.ok(value, message);
  detail(`ok: ${message}`);
}

export async function approveE2EUser(db: TestDb, userId: string) {
  const { error } = await db
    .from("profiles")
    .update({ membership_status: "approved" })
    .eq("id", userId);
  if (error) throw new Error(`approveE2EUser failed: ${error.message}`);
}

export async function isolateMockCompetitionSeason(
  db: TestDb,
  providerLeagueId: number,
  mockSeasonId: number
): Promise<number | null> {
  const { data: competition, error: findError } = await db
    .from("football_competitions")
    .select("id, current_provider_season_id")
    .eq("provider", "sportmonks")
    .eq("provider_league_id", providerLeagueId)
    .maybeSingle();
  if (findError) {
    throw new Error(`isolateMockCompetitionSeason lookup failed: ${findError.message}`);
  }
  if (!competition) {
    throw new Error(
      `isolateMockCompetitionSeason: no football_competitions row for league ${providerLeagueId}`
    );
  }

  const { error: seasonError } = await db.from("football_seasons").upsert(
    {
      competition_id: competition.id,
      provider: "sportmonks",
      provider_season_id: mockSeasonId,
      name: "E2E Mock Season",
      is_current: true,
    },
    { onConflict: "provider,provider_season_id" }
  );
  if (seasonError) {
    throw new Error(`isolateMockCompetitionSeason season upsert failed: ${seasonError.message}`);
  }

  const { error: updateError } = await db
    .from("football_competitions")
    .update({ current_provider_season_id: mockSeasonId })
    .eq("id", competition.id);
  if (updateError) {
    throw new Error(`isolateMockCompetitionSeason update failed: ${updateError.message}`);
  }

  return competition.current_provider_season_id;
}

export async function restoreCompetitionSeason(
  db: TestDb,
  providerLeagueId: number,
  originalSeasonId: number | null
) {
  const { error } = await db
    .from("football_competitions")
    .update({ current_provider_season_id: originalSeasonId })
    .eq("provider", "sportmonks")
    .eq("provider_league_id", providerLeagueId);
  if (error) {
    throw new Error(`restoreCompetitionSeason failed: ${error.message}`);
  }
}

export async function insertBatched<T extends TableName>(
  db: TestDb,
  table: T,
  rows: TableInsert<T>[],
  batchSize = 1000
) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await db.from(table).insert(batch as never);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

export async function cleanupE2EData(
  db: TestDb,
  scope: { friends?: boolean; season?: boolean; auth?: boolean } = {
    friends: true,
    season: true,
    auth: true,
  }
) {
  if (scope.friends) {
    await db.from("friends_groups").delete().like("slug", "e2e-%");
    await db.from("profiles").delete().like("display_name", "E2E %");
  }

  if (scope.season) {
    await db.from("friends_groups").delete().like("slug", "e2e-season-%");
    await db.from("fixtures").delete().eq("provider", "e2e-season");
    await db
      .from("football_competitions")
      .delete()
      .like("name", "E2E Generated League %");
    await db.from("profiles").delete().like("display_name", "E2E G% User %");
  }

  if (scope.auth) {
    await cleanupE2EAuthUsers(db);
  }

  // The mock SportMonks catalog reuses this fixed id range across every e2e
  // run (see SportMonksMockService). It shares a table with real fixtures
  // synced by a live dev backend, so always sweep it clean rather than
  // leaving mock rows to linger in local dev after a test run.
  await db.from("fixtures").delete().gte("sm_fixture_id", 900001).lte("sm_fixture_id", 900999);
}

function tryJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assertLocalSupabaseUrl(rawUrl: string) {
  if (process.env.E2E_ALLOW_NON_LOCAL_DB === "true") return;

  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

  if (!localHosts.has(url.hostname)) {
    throw new Error(
      `Refusing to run E2E against non-local Supabase URL: ${rawUrl}. ` +
        "Use local Supabase or set E2E_ALLOW_NON_LOCAL_DB=true intentionally."
    );
  }
}

async function cleanupE2EAuthUsers(db: TestDb) {
  const patterns = [
    /^e2e-.*@example\.com$/,
  ];

  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(`auth user cleanup failed: ${error.message}`);

    const users = data?.users ?? [];
    const matchingUserIds = users
      .filter((user: AuthUser) => {
        const email = user.email ?? "";
        return patterns.some((pattern) => pattern.test(email));
      })
      .map((user: AuthUser) => user.id);

    if (matchingUserIds.length) {
      const { error: profileDeleteError } = await db
        .from("profiles")
        .delete()
        .in("id", matchingUserIds);
      if (profileDeleteError) {
        throw new Error(
          `auth profile cleanup failed: ${profileDeleteError.message}`
        );
      }
    }

    for (const user of users) {
      const email = user.email ?? "";
      if (patterns.some((pattern) => pattern.test(email))) {
        const { error: deleteError } = await db.auth.admin.deleteUser(user.id);
        if (deleteError) {
          throw new Error(`auth user delete failed: ${deleteError.message}`);
        }
      }
    }

    if (users.length < 1000) break;
  }
}
