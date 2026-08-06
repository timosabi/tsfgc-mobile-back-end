import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";

type SubscribePayload = {
  friendsGroupId: string;
  createdBy: string;
  providerLeagueId: number;
  providerSeasonId?: number | null;
  competitionName: string;
  countryName?: string | null;
  logoUrl?: string | null;
  seasonName?: string | null;
  status?: "pending" | "active";
};
type FriendsGroupSubscriptionRepositories = Pick<
  Repositories,
  "footballCompetitions" | "footballSeasons" | "friendsGroupSubscriptions"
>;
type CompetitionCatalogEntry = {
  providerLeagueId: number;
  providerSeasonId: number | null;
  competitionName: string;
  countryName?: string | null;
  logoUrl?: string | null;
  seasonName?: string | null;
};

export default class FriendsGroupSubscriptionService {
  private readonly repositories: FriendsGroupSubscriptionRepositories;

  constructor(
    clientOrRepositories: SupabaseClient<Database> | FriendsGroupSubscriptionRepositories
  ) {
    this.repositories = isFriendsGroupSubscriptionRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async subscribe(payload: SubscribePayload) {
    const competition = await this.repositories.footballCompetitions.upsertCompetition({
      providerLeagueId: payload.providerLeagueId,
      name: payload.competitionName,
      countryName: payload.countryName,
      logoUrl: payload.logoUrl,
      currentProviderSeasonId: payload.providerSeasonId,
    });

    let seasonId: string | null = null;
    if (payload.providerSeasonId) {
      const season = await this.repositories.footballSeasons.upsertSeason({
        competitionId: competition.id,
        providerSeasonId: payload.providerSeasonId,
        name: payload.seasonName,
      });
      seasonId = season.id;
    }

    const existing =
      await this.repositories.friendsGroupSubscriptions.findPendingOrActiveId(
        payload.friendsGroupId
      );

    const subscriptionRow = {
      friends_group_id: payload.friendsGroupId,
      competition_id: competition.id,
      season_id: seasonId,
      provider: "sportmonks",
      provider_league_id: payload.providerLeagueId,
      provider_season_id: payload.providerSeasonId ?? null,
      status: payload.status ?? "active",
      created_by: payload.createdBy,
      updated_at: new Date().toISOString(),
    };

    const subscription = existing?.id
      ? await this.repositories.friendsGroupSubscriptions.updateSubscriptionById(
          existing.id,
          subscriptionRow
        )
      : await this.repositories.friendsGroupSubscriptions.insertSubscription(
          subscriptionRow
        );

    return { competition, subscription };
  }

  async getActiveForFriendsGroup(friendsGroupId: string) {
    return this.repositories.friendsGroupSubscriptions.findActiveWithCatalog(
      friendsGroupId
    );
  }

  async listCompetitions() {
    return this.repositories.footballCompetitions.listWithSeasons();
  }

  async getCompetition(providerLeagueId: number) {
    return this.repositories.footballCompetitions.findByProviderLeagueId(
      providerLeagueId
    );
  }

  async syncCompetitionCatalog(entries: CompetitionCatalogEntry[]) {
    for (const entry of entries) {
      const competition =
        await this.repositories.footballCompetitions.upsertCompetition({
          providerLeagueId: entry.providerLeagueId,
          name: entry.competitionName,
          countryName: entry.countryName,
          logoUrl: entry.logoUrl,
          currentProviderSeasonId: entry.providerSeasonId,
        });

      if (entry.providerSeasonId) {
        await this.repositories.footballSeasons.upsertSeason({
          competitionId: competition.id,
          providerSeasonId: entry.providerSeasonId,
          name: entry.seasonName,
        });
      }
    }
  }

  async getPendingForFriendsGroup(friendsGroupId: string) {
    return this.repositories.friendsGroupSubscriptions.findPendingByFriendsGroup(
      friendsGroupId
    );
  }

  async setStatusForFriendsGroup(
    friendsGroupId: string,
    status: "active" | "rejected"
  ) {
    return this.repositories.friendsGroupSubscriptions.setPendingStatusForFriendsGroup(
      friendsGroupId,
      status
    );
  }
}

function isFriendsGroupSubscriptionRepositories(
  value: SupabaseClient<Database> | FriendsGroupSubscriptionRepositories
): value is FriendsGroupSubscriptionRepositories {
  return (
    "footballCompetitions" in value &&
    "footballSeasons" in value &&
    "friendsGroupSubscriptions" in value
  );
}
