import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types.js";
import { createRepositories, type Repositories } from "../../repositories/index.js";
import SportMonksService from "./service.js";

type FixtureRow = Database["public"]["Tables"]["fixtures"]["Row"];
type SportMonksLiveRepositories = Pick<Repositories, "fixtures">;

export class SportMonksLiveService {
  private readonly repositories: SportMonksLiveRepositories;

  constructor(
    private sportMonks: SportMonksService,
    clientOrRepositories: SupabaseClient<Database> | SportMonksLiveRepositories
  ) {
    this.repositories = isSportMonksLiveRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async getLiveFixtures(leagueIds?: number[]) {
    const liveFixtures = await this.sportMonks.getLiveFixtures(leagueIds);

    if (liveFixtures?.length) {
      const patches = liveFixtures.map((f) => ({
        sm_fixture_id: Number(f.sm_fixture_id),
        live_home_score: f.live_home_score ?? f.home_score ?? null,
        live_away_score: f.live_away_score ?? f.away_score ?? null,
        status: f.status ?? null,
        current_minute: f.current_minute ?? null,
      }));

      await this.repositories.fixtures.patchLiveRows(patches, 800);
    }

    return this.repositories.fixtures.listLiveOrdered();
  }

  async getFixtureLiveScore(fixtureId: number): Promise<{
    live_home_score: number | null;
    live_away_score: number | null;
    status: string | null;
    current_minute: number | null;
  } | null> {
    console.log(`[Live] Fetching live score for fixture ${fixtureId}`);

    try {
      const existingFixture =
        await this.repositories.fixtures.findIdAndSportMonksFixtureId(fixtureId);

      const sportMonksFixtureId = Number(existingFixture?.sm_fixture_id);
      if (!Number.isFinite(sportMonksFixtureId)) {
        throw new Error(`Fixture ${fixtureId} has no SportMonks fixture id`);
      }

      const fixtureData = await this.sportMonks.getFixtureById(
        sportMonksFixtureId,
        true
      );

      if (!fixtureData?.fixture) {
        console.log(`[Live] Fixture ${fixtureId} not found in SportMonks`);

        return this.repositories.fixtures.findLiveSnapshot(fixtureId);
      }

      await this.repositories.fixtures.upsertBySportMonksFixtureId([
        fixtureData.fixture,
      ]);

      return this.repositories.fixtures.findLiveSnapshot(fixtureId);
    } catch (error) {
      console.error(
        `[Live] Error fetching live score for fixture ${fixtureId}:`,
        error
      );

      // Fallback to DB
      return this.repositories.fixtures.findLiveSnapshot(fixtureId, false);
    }
  }

  async updateMatchweekLiveFixtures(
    matchweek: string,
    leagueId?: number
  ): Promise<FixtureRow[]> {
    console.log(`[Live] Updating live fixtures for matchweek: ${matchweek}`);

    try {
      const fixtures = await this.sportMonks.getAllFixtures(
        matchweek,
        leagueId ? [leagueId] : undefined
      );

      if (!fixtures || fixtures.length === 0) {
        console.log(`[Live] No fixtures found for matchweek ${matchweek}`);

        // Return from DB
        return this.repositories.fixtures.listLiveByMatchweek(matchweek);
      }

      const liveFixtures = fixtures.filter((f) => f.status === "live");

      if (liveFixtures.length > 0) {
        console.log(`[Live] Updating ${liveFixtures.length} live fixtures`);

        // Update DB
        await this.repositories.fixtures.upsertBySportMonksFixtureId(liveFixtures);
      }

      return this.repositories.fixtures.listByMatchweekOrdered(matchweek);
    } catch (error) {
      console.error(`[Live] Error updating matchweek ${matchweek}:`, error);

      return this.repositories.fixtures.listByMatchweek(matchweek);
    }
  }

  async getTodayLiveFixtures(leagueIds?: number[]): Promise<FixtureRow[]> {
    console.log("[Live] Fetching today's live fixtures...");

    try {
      const todayFixtures =
        await this.sportMonks.getTodayLiveFixturesWithFallback(leagueIds);

      if (todayFixtures && todayFixtures.length > 0) {
        await this.repositories.fixtures.upsertBySportMonksFixtureId(todayFixtures);
      }

      const today = new Date().toISOString().split("T")[0];
      return this.repositories.fixtures.listTodayLive(today, true);
    } catch (error) {
      console.error("[Live] Error fetching today's live fixtures:", error);

      const today = new Date().toISOString().split("T")[0];
      return this.repositories.fixtures.listTodayLive(today);
    }
  }
}

function isSportMonksLiveRepositories(
  value: SupabaseClient<Database> | SportMonksLiveRepositories
): value is SportMonksLiveRepositories {
  return "fixtures" in value;
}
