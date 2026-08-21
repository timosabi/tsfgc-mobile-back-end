import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import type { UserFriendsGroupRow } from "../repositories/FriendsGroupUsersRepository.js";
import type {
  ActiveSubscriptionCardRef,
} from "../repositories/FriendsGroupSubscriptionsRepository.js";
import type { OverviewFixtureRow } from "../repositories/FixturesRepository.js";
import type { ProfilePreview } from "../repositories/ProfilesRepository.js";
import { AppError } from "../middleware/errorHandler.js";

type FriendsGroupUserRow =
  Database["public"]["Tables"]["friends_group_users"]["Row"];
type WeeklyScoreRow = Database["public"]["Tables"]["weekly_scores"]["Row"];
type FriendsGroupMembershipId = Pick<FriendsGroupUserRow, "id">;
type FriendsGroupUserId = Pick<FriendsGroupUserRow, "user_id">;
type FriendsGroupRef = Pick<FriendsGroupUserRow, "friends_group_id">;
type JoinFriendsGroupPayload = {
  friendsGroupId: string;
  userId: string;
  role?: "owner" | "member";
};
type LeaveFriendsGroupResult = { status: "left" | "archived" };
type KickMemberResult = { status: "removed"; friendsGroupId: string; removedUserId: string };
type TransferOwnershipResult = {
  status: "transferred";
  friendsGroupId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
};
type OwnerMemberListItem = {
  userId: string;
  role: "owner" | "member";
  joinedAt: string;
  profile: ProfilePreview | null;
  canRemove: boolean;
  canTransferOwnership: boolean;
};
type GroupCardLeague = {
  providerLeagueId: number;
  providerSeasonId: number | null;
  name: string;
  countryName: string | null;
  logoUrl: string | null;
  seasonName: string | null;
};
type GroupCardMatchweek = {
  matchweek: string;
  weekNumber: number | null;
  state: "upcoming" | "live" | "finished";
  displayLabel: string;
};
type GroupSeasonScoreSummary = {
  user_id: string;
  fixtures_predicted: number;
  exact_score_points: number;
  correct_result_points: number;
  total_goals_bonus: number;
  red_card_bonus: number;
  points_earned: number;
  weeks_played: number;
  rank: number | null;
};
type UserFriendsGroupCardRow = Omit<UserFriendsGroupRow, "friends_group"> & {
  friends_group: UserFriendsGroupRow["friends_group"] & {
    league: GroupCardLeague | null;
    currentMatchweek: GroupCardMatchweek | null;
  };
  score: GroupSeasonScoreSummary;
};
type FriendsGroupUsersRepositories = Pick<
  Repositories,
  | "fixtures"
  | "friendsGroupSubscriptions"
  | "friendsGroupUsers"
  | "friendsGroups"
  | "profiles"
  | "weeklyScores"
>;

export default class FriendsGroupUsersService {
  private readonly repositories: FriendsGroupUsersRepositories;

  constructor(clientOrRepositories: SupabaseClient<Database> | FriendsGroupUsersRepositories) {
    this.repositories = isFriendsGroupUsersRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async getFriendsGroupUserId(
    friendsGroupId: string,
    userId: string
  ): Promise<FriendsGroupMembershipId | null> {
    return this.repositories.friendsGroupUsers.findMembershipId(
      friendsGroupId,
      userId
    );
  }

  async checkFriendsGroupUserId(
    friendsGroupId: string,
    userId: string
  ): Promise<FriendsGroupMembershipId> {
    const row = await this.repositories.friendsGroupUsers.findMembershipId(
      friendsGroupId,
      userId,
      { strict: true }
    );
    if (!row) throw new Error("Friends group membership not found");
    return row;
  }

  async getFriendsGroupMembershipId(
    friendsGroupId: string,
    userId: string,
    { strict = false } = {}
  ): Promise<FriendsGroupMembershipId | null> {
    return this.repositories.friendsGroupUsers.findMembershipId(
      friendsGroupId,
      userId,
      { strict }
    );
  }

  async getFriendsGroupsForUser(userId: string): Promise<UserFriendsGroupCardRow[]> {
    const groups = await this.repositories.friendsGroupUsers.listForUser(userId);
    const groupIds = groups.map((group) => group.friends_group.id);
    const subscriptions =
      await this.repositories.friendsGroupSubscriptions.listActiveWithCatalogByFriendsGroupIds(
        groupIds
      );
    const subscriptionByGroupId = new Map(
      subscriptions.map((subscription) => [
        subscription.friends_group_id,
        subscription,
      ])
    );

    return Promise.all(
      groups.map(async (group) => {
        const subscription = subscriptionByGroupId.get(group.friends_group.id) ?? null;
        const league = this.buildCardLeague(subscription);
        const [fixtures, weeklyScores] = await Promise.all([
          subscription
            ? this.repositories.fixtures.listOverviewFixturesForSubscription({
                providerLeagueId: subscription.provider_league_id,
                providerSeasonId: subscription.provider_season_id,
              })
            : Promise.resolve([]),
          this.repositories.weeklyScores.listByGroupPaginated({
            friendsGroupId: group.friends_group.id,
          }),
        ]);
        const currentMatchweek = subscription
          ? this.buildCurrentMatchweekCard({ fixtures })
          : null;

        return {
          ...group,
          score: this.buildUserSeasonScoreSummary({
            userId,
            weeklyScores,
          }),
          friends_group: {
            ...group.friends_group,
            league,
            currentMatchweek,
          },
        };
      })
    );
  }

  async joinFriendsGroup(payload: JoinFriendsGroupPayload): Promise<void> {
    await this.repositories.friendsGroupUsers.upsertMembership(payload);
  }

  async getFriendsGroupUsers(
    friendsGroupId: string
  ): Promise<Array<FriendsGroupUserId & Pick<FriendsGroupUserRow, "role" | "joined_at">>> {
    return this.repositories.friendsGroupUsers.listMembers(friendsGroupId);
  }

  async getOwnerMemberList(params: {
    friendsGroupId: string;
    ownerUserId: string;
  }): Promise<OwnerMemberListItem[]> {
    await this.requireOwner(params.friendsGroupId, params.ownerUserId);

    const members = await this.repositories.friendsGroupUsers.listMembers(
      params.friendsGroupId
    );
    const profiles = await this.repositories.profiles.listPreviewsByIds(
      members.map((member) => member.user_id)
    );
    const profilesById = new Map(
      profiles.map((profile) => [profile.id, profile])
    );

    return members.map((member) => ({
      userId: member.user_id,
      role: member.role,
      joinedAt: member.joined_at,
      profile: profilesById.get(member.user_id) ?? null,
      canRemove: member.role !== "owner" && member.user_id !== params.ownerUserId,
      canTransferOwnership:
        member.role === "member" && member.user_id !== params.ownerUserId,
    }));
  }

  async getNumberOfPlayers(friendsGroupId: string): Promise<number | null> {
    return this.repositories.friendsGroupUsers.countMembers(friendsGroupId);
  }

  async removeUserFromFriendsGroup(
    userId: string,
    friendsGroupId: string
  ): Promise<LeaveFriendsGroupResult> {
    const membership = await this.repositories.friendsGroupUsers.findMembership(
      friendsGroupId,
      userId
    );
    if (!membership) throw new AppError("Friends group membership not found", 404);

    if (membership.role === "member") {
      await this.repositories.friendsGroupUsers.removeMembership(
        userId,
        friendsGroupId
      );
      await this.repositories.profiles.clearFriendsGroupRefsForUser(
        userId,
        friendsGroupId
      );
      return { status: "left" };
    }

    const memberCount =
      await this.repositories.friendsGroupUsers.countMembers(friendsGroupId);
    if ((memberCount ?? 0) > 1) {
      throw new AppError(
        "Owner must transfer ownership or remove other members before leaving",
        409
      );
    }

    await this.repositories.friendsGroups.archiveById(friendsGroupId);
    await this.repositories.friendsGroupUsers.removeMembership(
      userId,
      friendsGroupId
    );
    await this.repositories.profiles.clearFriendsGroupRefs(friendsGroupId);

    return { status: "archived" };
  }

  async kickMember(params: {
    friendsGroupId: string;
    ownerUserId: string;
    targetUserId: string;
  }): Promise<KickMemberResult> {
    if (params.ownerUserId === params.targetUserId) {
      throw new AppError("Owner cannot kick themselves; use leave instead", 400);
    }

    await this.requireOwner(params.friendsGroupId, params.ownerUserId);

    const targetMembership =
      await this.repositories.friendsGroupUsers.findMembership(
        params.friendsGroupId,
        params.targetUserId
      );
    if (!targetMembership) {
      throw new AppError("Target user is not a member of this friends group", 404);
    }
    if (targetMembership.role === "owner") {
      throw new AppError("Cannot kick the group owner", 409);
    }

    await this.repositories.friendsGroupUsers.removeMembership(
      params.targetUserId,
      params.friendsGroupId
    );
    await this.repositories.profiles.clearFriendsGroupRefsForUser(
      params.targetUserId,
      params.friendsGroupId
    );

    return {
      status: "removed",
      friendsGroupId: params.friendsGroupId,
      removedUserId: params.targetUserId,
    };
  }

  async transferOwnership(params: {
    friendsGroupId: string;
    currentOwnerUserId: string;
    newOwnerUserId: string;
  }): Promise<TransferOwnershipResult> {
    if (params.currentOwnerUserId === params.newOwnerUserId) {
      throw new AppError("New owner must be different from current owner", 400);
    }

    await this.requireOwner(params.friendsGroupId, params.currentOwnerUserId);

    const targetMembership =
      await this.repositories.friendsGroupUsers.findMembership(
        params.friendsGroupId,
        params.newOwnerUserId
      );
    if (!targetMembership) {
      throw new AppError("New owner must already be a member of this friends group", 404);
    }

    await this.repositories.friendsGroups.transferOwnership({
      friendsGroupId: params.friendsGroupId,
      currentOwnerId: params.currentOwnerUserId,
      newOwnerId: params.newOwnerUserId,
    });

    return {
      status: "transferred",
      friendsGroupId: params.friendsGroupId,
      previousOwnerUserId: params.currentOwnerUserId,
      newOwnerUserId: params.newOwnerUserId,
    };
  }

  async getAllUserFriendsGroups(userId: string): Promise<FriendsGroupRef[]> {
    return this.repositories.friendsGroupUsers.listGroupRefsForUser(userId);
  }

  private async requireOwner(
    friendsGroupId: string,
    userId: string
  ): Promise<void> {
    const membership = await this.repositories.friendsGroupUsers.findMembership(
      friendsGroupId,
      userId
    );
    if (!membership) throw new AppError("Friends group membership not found", 404);
    if (membership.role !== "owner") {
      throw new AppError("Only the friends group owner can perform this action", 403);
    }

    const friendsGroup = await this.repositories.friendsGroups.findById(friendsGroupId);
    if (!friendsGroup || friendsGroup.status !== "approved") {
      throw new AppError("Friends group not found", 404);
    }
    if (friendsGroup.created_by !== userId) {
      throw new AppError("Only the friends group owner can perform this action", 403);
    }
  }

  private buildCardLeague(
    subscription: ActiveSubscriptionCardRef | null
  ): GroupCardLeague | null {
    if (!subscription?.competition) return null;

    return {
      providerLeagueId: subscription.provider_league_id,
      providerSeasonId: subscription.provider_season_id ?? null,
      name: subscription.competition.name,
      countryName: subscription.competition.country_name,
      logoUrl: subscription.competition.logo_url,
      seasonName: subscription.season?.name ?? null,
    };
  }

  private buildCurrentMatchweekCard(params: {
    fixtures: OverviewFixtureRow[];
  }): GroupCardMatchweek | null {
    const selected = this.pickCurrentMatchweek(params.fixtures);
    if (!selected) return null;

    const weekNumber = this.weekNumberFromMatchweek(selected.matchweek);
    return {
      matchweek: selected.matchweek,
      weekNumber,
      state: selected.state,
      displayLabel:
        weekNumber === null ? selected.matchweek : `Matchweek ${weekNumber}`,
    };
  }

  private pickCurrentMatchweek(
    fixtures: OverviewFixtureRow[]
  ): GroupCardMatchweek | null {
    if (!fixtures.length) return null;

    const liveFixture = this.sortFixtures(fixtures).find(
      (fixture) => fixture.status === "live"
    );
    if (liveFixture?.matchweek) {
      return {
        matchweek: liveFixture.matchweek,
        weekNumber: this.weekNumberFromMatchweek(liveFixture.matchweek),
        state: "live",
        displayLabel: liveFixture.matchweek,
      };
    }

    const nextFixture = this.sortFixtures(fixtures).find(
      (fixture) => fixture.status !== "finished"
    );
    if (nextFixture?.matchweek) {
      return {
        matchweek: nextFixture.matchweek,
        weekNumber: this.weekNumberFromMatchweek(nextFixture.matchweek),
        state: "upcoming",
        displayLabel: nextFixture.matchweek,
      };
    }

    const finishedFixture = this.sortFixtures(fixtures, false).find(
      (fixture) => fixture.status === "finished"
    );
    if (!finishedFixture?.matchweek) return null;

    return {
      matchweek: finishedFixture.matchweek,
      weekNumber: this.weekNumberFromMatchweek(finishedFixture.matchweek),
      state: "finished",
      displayLabel: finishedFixture.matchweek,
    };
  }

  private sortFixtures(fixtures: OverviewFixtureRow[], ascending = true) {
    return [...fixtures].sort((a, b) => {
      const diff = this.fixtureTime(a) - this.fixtureTime(b);
      return ascending ? diff : -diff;
    });
  }

  private fixtureTime(fixture: OverviewFixtureRow) {
    const raw =
      fixture.starting_at ??
      `${fixture.match_date ?? "1970-01-01"}T${fixture.match_time ?? "00:00:00"}`;
    const time = new Date(raw).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  private weekNumberFromMatchweek(matchweek: string) {
    const n = Number(matchweek.match(/\d+/)?.[0]);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  private buildUserSeasonScoreSummary(params: {
    userId: string;
    weeklyScores: WeeklyScoreRow[];
  }): GroupSeasonScoreSummary {
    const totals = new Map<string, GroupSeasonScoreSummary>();

    for (const score of params.weeklyScores) {
      const row = totals.get(score.user_id) ?? {
        user_id: score.user_id,
        fixtures_predicted: 0,
        exact_score_points: 0,
        correct_result_points: 0,
        total_goals_bonus: 0,
        red_card_bonus: 0,
        points_earned: 0,
        weeks_played: 0,
        rank: null,
      };

      row.fixtures_predicted += score.fixtures_predicted;
      row.exact_score_points += score.exact_score_points;
      row.correct_result_points += score.correct_result_points;
      row.total_goals_bonus += score.total_goals_bonus;
      row.red_card_bonus += score.red_card_bonus;
      row.points_earned += score.points_earned;
      row.weeks_played += 1;
      totals.set(score.user_id, row);
    }

    const rows = Array.from(totals.values()).sort((a, b) => {
      if (b.points_earned !== a.points_earned) {
        return b.points_earned - a.points_earned;
      }
      if (b.exact_score_points !== a.exact_score_points) {
        return b.exact_score_points - a.exact_score_points;
      }
      return b.correct_result_points - a.correct_result_points;
    });
    rows.forEach((row, index) => {
      row.rank = index + 1;
    });

    return (
      totals.get(params.userId) ?? {
        user_id: params.userId,
        fixtures_predicted: 0,
        exact_score_points: 0,
        correct_result_points: 0,
        total_goals_bonus: 0,
        red_card_bonus: 0,
        points_earned: 0,
        weeks_played: 0,
        rank: null,
      }
    );
  }
}

function isFriendsGroupUsersRepositories(
  value: SupabaseClient<Database> | FriendsGroupUsersRepositories
): value is FriendsGroupUsersRepositories {
  return (
    "fixtures" in value &&
    "friendsGroupSubscriptions" in value &&
    "friendsGroupUsers" in value &&
    "friendsGroups" in value &&
    "profiles" in value &&
    "weeklyScores" in value
  );
}
