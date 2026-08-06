import type { SupabaseClient } from "@supabase/supabase-js";
import SportMonksService from "./service.js";
import type { Database } from "../supabase/types.js";
import { createRepositories, type Repositories } from "../../repositories/index.js";

type ActiveSubscriptionTarget = {
  providerLeagueId: number;
  providerSeasonId: number | null;
};

type ActiveSubscription = ActiveSubscriptionTarget & {
  friendsGroupId: string;
};
type SportMonksHydrationRepositories = Pick<
  Repositories,
  "fixtures" | "friendsGroupSubscriptions"
>;

export class SportMonksHydrationService {
  private readonly repositories: SportMonksHydrationRepositories;

  constructor(
    private sportMonks: SportMonksService,
    clientOrRepositories: SupabaseClient<Database> | SportMonksHydrationRepositories
  ) {
    this.repositories = isSportMonksHydrationRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async hydrateMatchweek(matchweek: string, leagueId?: number): Promise<void> {
    console.log(`[Hydration] Starting hydration for matchweek: ${matchweek}`);

    try {
      const fixtures = await this.sportMonks.getAllFixtures(
        matchweek,
        leagueId ? [leagueId] : undefined
      );

      if (!fixtures || fixtures.length === 0) {
        console.log(
          `[Hydration] No fixtures found for matchweek: ${matchweek}`
        );
        return;
      }

      console.log(`[Hydration] Found ${fixtures.length} fixtures to sync`);

      await this.repositories.fixtures.upsertBySportMonksFixtureId(fixtures);

      console.log(
        `[Hydration] Successfully synced ${fixtures.length} fixtures`
      );
    } catch (error) {
      console.error("[Hydration] Hydration failed:", error);
      throw error;
    }
  }

  async hydrateFinishedFixtures(
    days: number = 7,
    leagueIds?: number[]
  ): Promise<void> {
    console.log(
      `[Hydration] Hydrating finished fixtures from last ${days} days`
    );

    try {
      const fixtures = await this.sportMonks.getFinishedFixtures(
        days,
        leagueIds
      );

      if (!fixtures || fixtures.length === 0) {
        console.log("[Hydration] No finished fixtures found");
        return;
      }

      console.log(`[Hydration] Found ${fixtures.length} finished fixtures`);

      await this.repositories.fixtures.upsertBySportMonksFixtureId(fixtures);

      console.log(
        `[Hydration] Successfully synced ${fixtures.length} finished fixtures`
      );
    } catch (error) {
      console.error("[Hydration] Failed to hydrate finished fixtures:", error);
      throw error;
    }
  }

  async hydrateActiveSubscriptionSchedules(): Promise<{
    subscriptionsFound: number;
    targetsHydrated: number;
    fixturesSynced: number;
    results: Array<{
      providerLeagueId: number;
      providerSeasonId: number | null;
      fixturesSynced: number;
    }>;
  }> {
    const { subscriptions, targets } = await this.getActiveSubscriptionTargets();
    const results = [];

    for (const target of targets) {
      const result = await this.hydrateLeagueSeason(
        target.providerLeagueId,
        target.providerSeasonId
      );

      results.push({
        ...target,
        fixturesSynced: result.fixturesSynced,
      });
    }

    return {
      subscriptionsFound: subscriptions.length,
      targetsHydrated: targets.length,
      fixturesSynced: results.reduce((sum, row) => sum + row.fixturesSynced, 0),
      results,
    };
  }

  async hydrateRecentFinishedForActiveSubscriptions(days = 2): Promise<{
    leagueIds: number[];
    fixturesSynced: number;
  }> {
    const { subscriptions } = await this.getActiveSubscriptionTargets();
    const leagueIds: number[] = Array.from(
      new Set(
        subscriptions
          .map((subscription: ActiveSubscription) => subscription.providerLeagueId)
          .filter((id: number) => Number.isFinite(id) && id > 0)
      )
    );

    if (!leagueIds.length) {
      console.log("[Hydration] No active subscriptions for finished refresh");
      return { leagueIds: [], fixturesSynced: 0 };
    }

    const fixtures = await this.sportMonks.getFinishedFixtures(days, leagueIds);
    if (!fixtures?.length) {
      console.log("[Hydration] No recently finished subscribed fixtures");
      return { leagueIds, fixturesSynced: 0 };
    }

    await this.repositories.fixtures.upsertBySportMonksFixtureId(fixtures, {
      batchSize: 800,
    });

    console.log(
      `[Hydration] Synced ${fixtures.length} recently finished subscribed fixtures`
    );
    return { leagueIds, fixturesSynced: fixtures.length };
  }

  async fullHydration(leagueIds?: number[]): Promise<{
    upcoming: number;
    finished: number;
    total: number;
  }> {
    console.log("[Hydration] Starting FULL hydration...");

    const stats = {
      upcoming: 0,
      finished: 0,
      total: 0,
    };

    try {
      // Hydrate upcoming fixtures (next 30 days)
      const upcomingFixtures = await this.sportMonks.getUpcomingFixtures(
        30,
        leagueIds
      );
      if (upcomingFixtures && upcomingFixtures.length > 0) {
        await this.repositories.fixtures.upsertBySportMonksFixtureId(
          upcomingFixtures,
          { returnRows: true }
        );
        stats.upcoming = upcomingFixtures.length;
      }

      // Hydrate finished fixtures (last 7 days)
      const finishedFixtures = await this.sportMonks.getFinishedFixtures(
        7,
        leagueIds
      );
      if (finishedFixtures && finishedFixtures.length > 0) {
        await this.repositories.fixtures.upsertBySportMonksFixtureId(
          finishedFixtures,
          { returnRows: true }
        );
        stats.finished = finishedFixtures.length;
      }

      stats.total = stats.upcoming + stats.finished;

      console.log("[Hydration] Full hydration complete:", stats);

      return stats;
    } catch (error) {
      console.error("[Hydration] Full hydration failed:", error);
      throw error;
    }
  }

  async hydrateDateRange(startDate: string, endDate: string): Promise<void> {
    console.log(
      `[Hydration] Hydrating fixtures from ${startDate} to ${endDate}`
    );

    try {
      const fixtures = await this.sportMonks.getFixturesByDateRange(
        startDate,
        endDate
      );

      if (!fixtures || fixtures.length === 0) {
        console.log("[Hydration] No fixtures found in date range");
        return;
      }

      console.log(
        `[Hydration] Found ${fixtures.length} fixtures in date range ${fixtures}`
      );

      await this.repositories.fixtures.upsertBySportMonksFixtureId(fixtures);

      console.log(
        `[Hydration] Successfully synced ${fixtures.length} fixtures`
      );
    } catch (error) {
      console.error("[Hydration] Failed to hydrate date range:", error);
      throw error;
    }
  }

  async hydrateUpcomingFixtures(days = 30, leagueIds?: number[]) {
    console.log(
      `[Hydration] Hydrating upcoming fixtures for next ${days} days`
    );
    const fixtures = await this.sportMonks.getUpcomingFixtures(days, leagueIds);
    if (!fixtures?.length) {
      console.log("[Hydration] No upcoming fixtures");
      return;
    }

    await this.repositories.fixtures.upsertBySportMonksFixtureId(fixtures, {
      batchSize: 800,
    });

    console.log(`[Hydration] Synced ${fixtures.length} upcoming fixtures`);
  }

  async hydrateLeagueSeason(
    providerLeagueId: number,
    providerSeasonId?: number | null
  ) {
    console.log(
      `[Hydration] Hydrating league ${providerLeagueId}` +
        (providerSeasonId ? ` season ${providerSeasonId}` : "")
    );

    const fixtures = providerSeasonId
      ? await this.sportMonks.getFixturesByLeague(
          String(providerLeagueId),
          String(providerSeasonId)
        )
      : await this.sportMonks.getUpcomingFixtures(45, [providerLeagueId]);

    if (!fixtures?.length) {
      console.log("[Hydration] No fixtures found for subscription");
      return { fixturesSynced: 0 };
    }

    await this.repositories.fixtures.upsertBySportMonksFixtureId(fixtures, {
      batchSize: 800,
    });

    console.log(`[Hydration] Synced ${fixtures.length} subscription fixtures`);
    return { fixturesSynced: fixtures.length };
  }

  private async getActiveSubscriptionTargets(): Promise<{
    subscriptions: ActiveSubscription[];
    targets: ActiveSubscriptionTarget[];
  }> {
    const data = await this.repositories.friendsGroupSubscriptions.listActiveTargets();

    const subscriptions: ActiveSubscription[] = (data ?? [])
      .map((row) => ({
        friendsGroupId: row.friends_group_id as string,
        providerLeagueId: Number(row.provider_league_id),
        providerSeasonId:
          row.provider_season_id === null ||
          row.provider_season_id === undefined
            ? null
            : Number(row.provider_season_id),
      }))
      .filter(
        (row: ActiveSubscription) =>
          Number.isFinite(row.providerLeagueId) && row.providerLeagueId > 0
      );

    const byTarget = new Map<
      string,
      { providerLeagueId: number; providerSeasonId: number | null }
    >();

    for (const subscription of subscriptions) {
      const key = `${subscription.providerLeagueId}:${
        subscription.providerSeasonId ?? "current"
      }`;
      if (!byTarget.has(key)) {
        byTarget.set(key, {
          providerLeagueId: subscription.providerLeagueId,
          providerSeasonId: subscription.providerSeasonId,
        });
      }
    }

    return {
      subscriptions,
      targets: Array.from(byTarget.values()),
    };
  }
}

function isSportMonksHydrationRepositories(
  value: SupabaseClient<Database> | SportMonksHydrationRepositories
): value is SportMonksHydrationRepositories {
  return "fixtures" in value && "friendsGroupSubscriptions" in value;
}
