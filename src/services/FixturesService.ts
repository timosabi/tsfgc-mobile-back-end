import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";

type FixtureInsert = Database["public"]["Tables"]["fixtures"]["Insert"];
type FixtureUpdate = Database["public"]["Tables"]["fixtures"]["Update"];
type FixtureRepositories = Pick<Repositories, "fixtures" | "friendsGroupSubscriptions">;

export default class FixtureService {
  private readonly repositories: FixtureRepositories;

  constructor(clientOrRepositories: SupabaseClient<Database> | FixtureRepositories) {
    this.repositories = isFixtureRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async getAllFixtures(currentMatchweek: string) {
    return this.repositories.fixtures.listByMatchweekWithStatuses(currentMatchweek, [
      "scheduled",
      "live",
      "finished",
    ]);
  }

  async getAllFixturesForFixturePage() {
    return this.repositories.fixtures.listAllOrdered();
  }

  async getFixturesForCustomLeague(leagueId: string, matchweek?: string) {
    const subscription =
      await this.repositories.friendsGroupSubscriptions.findActiveByFriendsGroup(
        leagueId
      );
    if (!subscription) return [];

    return this.repositories.fixtures.listForSubscription({
      providerLeagueId: subscription.provider_league_id,
      providerSeasonId: subscription.provider_season_id,
      matchweek,
    });
  }

  async getFixtureForFriendsGroup(friendsGroupId: string, fixtureId: number) {
    const subscription =
      await this.repositories.friendsGroupSubscriptions.findActiveByFriendsGroup(
        friendsGroupId
      );
    if (!subscription) return null;

    return this.repositories.fixtures.findFixtureForSubscription({
      fixtureId,
      providerLeagueId: subscription.provider_league_id,
      providerSeasonId: subscription.provider_season_id,
    });
  }

  async getLiveMatches() {
    return this.repositories.fixtures.listByStatus("live");
  }

  async checkScheduledFixtures() {
    return this.repositories.fixtures.listScheduledFromDate(todayIso());
  }

  async checkIfAnyFixtureHasStart(leagueId: string) {
    const fixtures = await this.getFixturesForCustomLeague(leagueId);
    return fixtures.map((fixture) => ({ status: fixture.status }));
  }

  async getLiveFixtures(limit?: number | null) {
    return this.repositories.fixtures.listLiveMatchweeks(limit);
  }

  async getLiveFixturesOrderedMatchTime() {
    return this.repositories.fixtures.listLiveMatchweeksOrdered();
  }

  async getUpcomingFixtures() {
    return this.repositories.fixtures.listUpcomingMatchweeks(todayIso());
  }

  async getUpcomingFixturesOrdered() {
    return this.repositories.fixtures.listNextUpcomingMatchweek(todayIso());
  }

  async getUpcomingFixturesForToday() {
    return this.repositories.fixtures.listUpcomingToday(
      todayIso(),
      new Date().toTimeString().slice(0, 8)
    );
  }

  async getMostRecentCompletedFixtured() {
    return this.repositories.fixtures.listFinishedIdsAndMatchweeks();
  }

  async getMostRecentCompletedFixturedOrdered() {
    return this.repositories.fixtures.listFinishedMatchweeksOrdered();
  }

  async getMostRecentFinishedFixtured() {
    return this.repositories.fixtures.listLatestFinishedMatchweek();
  }

  async getFixtures() {
    return this.repositories.fixtures.listAllOrdered();
  }

  async getFixturesByCurrentMatch(currentMatchweek: string) {
    return this.repositories.fixtures.listIdsByMatchweek(currentMatchweek);
  }

  async getAvailableFixtures() {
    return this.repositories.fixtures.countAvailable(todayIso());
  }

  async getGlobalUpcomingFixtures() {
    const now = new Date();
    return this.repositories.fixtures.listGlobalUpcoming({
      date: now.toISOString().split("T")[0],
      time: now.toTimeString().split(" ")[0],
      limit: 20,
    });
  }

  async getFixturesWithActualResults(targetWeek: number) {
    return this.repositories.fixtures.listWithActualResults(targetWeek);
  }

  async getFixtureLiveScore(fixtureId: number) {
    return this.repositories.fixtures.findLiveScore(fixtureId);
  }

  async getFixtureForGameweek(fixtureId: number) {
    return this.repositories.fixtures.findFixtureMatchweek(fixtureId);
  }

  async getCurrentMatchWeekForFixture() {
    return this.repositories.fixtures.listAnyMatchweek();
  }

  async getAllFixtureForGameweek(matchweek: string) {
    return this.repositories.fixtures.listIdsByMatchweek(matchweek);
  }

  async hasLeagueFixtures(friendsGroupId: string) {
    return this.repositories.friendsGroupSubscriptions.listIdsForFriendsGroup(
      friendsGroupId
    );
  }

  async setStatus(payload: { fixtureId: number; data: FixtureUpdate }) {
    await this.repositories.fixtures.updateFixtureById(
      payload.fixtureId,
      payload.data
    );
  }

  async insertFixture(payload: FixtureInsert | FixtureInsert[]) {
    await this.repositories.fixtures.insertFixtures(payload);
  }
}

function isFixtureRepositories(
  value: SupabaseClient<Database> | FixtureRepositories
): value is FixtureRepositories {
  return "fixtures" in value && "friendsGroupSubscriptions" in value;
}

function todayIso() {
  return new Date().toISOString().split("T")[0];
}
