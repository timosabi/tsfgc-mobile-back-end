import FriendsGroupUsersService from "../../../src/services/FriendsGroupUsersService.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

function createService() {
  const repositories = {
    fixtures: createRepositoryMock<
      Pick<Repositories["fixtures"], "listOverviewFixturesForSubscription">
    >(["listOverviewFixturesForSubscription"]),
    friendsGroupSubscriptions: createRepositoryMock<
      Pick<
        Repositories["friendsGroupSubscriptions"],
        "listActiveWithCatalogByFriendsGroupIds"
      >
    >(["listActiveWithCatalogByFriendsGroupIds"]),
    friendsGroupUsers: createRepositoryMock<
      Pick<
        Repositories["friendsGroupUsers"],
        | "countMembers"
        | "findMembership"
        | "findMembershipId"
        | "listForUser"
        | "listGroupRefsForUser"
        | "listMembers"
        | "removeMembership"
        | "upsertMembership"
      >
    >([
      "countMembers",
      "findMembership",
      "findMembershipId",
      "listForUser",
      "listGroupRefsForUser",
      "listMembers",
      "removeMembership",
      "upsertMembership",
    ]),
    friendsGroups: createRepositoryMock<
      Pick<
        Repositories["friendsGroups"],
        "archiveById" | "findById" | "transferOwnership"
      >
    >(["archiveById", "findById", "transferOwnership"]),
    profiles: createRepositoryMock<
      Pick<
        Repositories["profiles"],
        "clearFriendsGroupRefs" | "clearFriendsGroupRefsForUser" | "listPreviewsByIds"
      >
    >(["clearFriendsGroupRefs", "clearFriendsGroupRefsForUser", "listPreviewsByIds"]),
    weeklyScores: createRepositoryMock<
      Pick<Repositories["weeklyScores"], "listByGroupPaginated">
    >(["listByGroupPaginated"]),
  };

  return {
    repositories,
    service: new FriendsGroupUsersService(
      repositories as unknown as ConstructorParameters<typeof FriendsGroupUsersService>[0]
    ),
  };
}

describe("FriendsGroupUsersService", () => {
  it("joins users idempotently through the membership repository", async () => {
    const { repositories, service } = createService();

    await service.joinFriendsGroup({
      friendsGroupId: "group-1",
      userId: "user-a",
      role: "owner",
    });

    expect(repositories.friendsGroupUsers.upsertMembership).toHaveBeenCalledWith({
      friendsGroupId: "group-1",
      userId: "user-a",
      role: "owner",
    });
  });

  it("reads strict and optional membership ids", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.findMembershipId.mockResolvedValue({ id: "member-1" });

    await expect(service.getFriendsGroupUserId("group-1", "user-a")).resolves
      .toEqual({ id: "member-1" });
    await expect(service.checkFriendsGroupUserId("group-1", "user-a")).resolves
      .toEqual({ id: "member-1" });
    expect(repositories.friendsGroupUsers.findMembershipId).toHaveBeenLastCalledWith(
      "group-1",
      "user-a",
      { strict: true }
    );
  });

  it("lists user group refs", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listGroupRefsForUser.mockResolvedValue([
      { friends_group_id: "group-1" },
    ]);

    await expect(service.getAllUserFriendsGroups("user-a")).resolves.toEqual([
      { friends_group_id: "group-1" },
    ]);
  });

  it("enriches my groups with league and current matchweek card data", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.listForUser.mockResolvedValue([
      {
        role: "owner",
        joined_at: "2026-05-14T00:00:00.000Z",
        friends_group: {
          id: "group-1",
          name: "Los Muchachos",
          slug: "los-muchachos",
          created_by: "owner-a",
          invite_token: "invite-1",
          is_open: true,
          status: "approved",
          created_at: "2026-05-14T00:00:00.000Z",
          updated_at: "2026-05-14T00:00:00.000Z",
        },
      },
    ]);
    repositories.friendsGroupSubscriptions.listActiveWithCatalogByFriendsGroupIds
      .mockResolvedValue([
        {
          friends_group_id: "group-1",
          provider_league_id: 501,
          provider_season_id: 25598,
          competition: {
            id: "competition-1",
            name: "Premiership",
            country_name: "Scotland",
            logo_url: "https://cdn.example/501.png",
            provider_league_id: 501,
          },
          season: {
            id: "season-1",
            name: "2025/2026",
            provider_season_id: 25598,
          },
        },
      ]);
    repositories.fixtures.listOverviewFixturesForSubscription.mockResolvedValue([
      overviewFixture("Matchweek 11", "finished", "2026-05-10T12:00:00.000Z"),
      overviewFixture("Matchweek 12", "scheduled", "2026-05-17T12:00:00.000Z"),
      overviewFixture("Matchweek 13", "scheduled", "2026-05-24T12:00:00.000Z"),
    ]);
    repositories.weeklyScores.listByGroupPaginated.mockResolvedValue([
      weeklyScore("user-b", 1, 8, 8),
      weeklyScore("owner-a", 1, 5, 5),
      weeklyScore("owner-a", 2, 7, 12),
    ]);

    await expect(service.getFriendsGroupsForUser("owner-a")).resolves.toEqual([
      expect.objectContaining({
        role: "owner",
        score: {
          user_id: "owner-a",
          fixtures_predicted: 4,
          exact_score_points: 3,
          correct_result_points: 2,
          total_goals_bonus: 1,
          red_card_bonus: 2,
          points_earned: 12,
          weeks_played: 2,
          rank: 1,
        },
        friends_group: expect.objectContaining({
          id: "group-1",
          league: {
            providerLeagueId: 501,
            providerSeasonId: 25598,
            name: "Premiership",
            countryName: "Scotland",
            logoUrl: "https://cdn.example/501.png",
            seasonName: "2025/2026",
          },
          currentMatchweek: {
            matchweek: "Matchweek 12",
            weekNumber: 12,
            state: "upcoming",
            displayLabel: "Premiership week 12",
          },
        }),
      }),
    ]);

    expect(
      repositories.friendsGroupSubscriptions.listActiveWithCatalogByFriendsGroupIds
    ).toHaveBeenCalledWith(["group-1"]);
    expect(repositories.fixtures.listOverviewFixturesForSubscription).toHaveBeenCalledWith({
      providerLeagueId: 501,
      providerSeasonId: 25598,
    });
    expect(repositories.weeklyScores.listByGroupPaginated).toHaveBeenCalledWith({
      friendsGroupId: "group-1",
    });
  });

  it("lists members for owner management with profile previews and action flags", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.findMembership.mockResolvedValue({
      id: "owner-membership",
      friends_group_id: "group-1",
      user_id: "owner-a",
      role: "owner",
      joined_at: "2026-05-14T00:00:00.000Z",
    });
    repositories.friendsGroups.findById.mockResolvedValue({
      id: "group-1",
      created_by: "owner-a",
      status: "approved",
    } as Awaited<ReturnType<Repositories["friendsGroups"]["findById"]>>);
    repositories.friendsGroupUsers.listMembers.mockResolvedValue([
      {
        user_id: "owner-a",
        role: "owner",
        joined_at: "2026-05-14T00:00:00.000Z",
      },
      {
        user_id: "member-a",
        role: "member",
        joined_at: "2026-05-15T00:00:00.000Z",
      },
    ]);
    repositories.profiles.listPreviewsByIds.mockResolvedValue([
      {
        id: "owner-a",
        display_name: "Owner",
        avatar_emoji: "OO",
        color_class: "lime",
      },
      {
        id: "member-a",
        display_name: "Member",
        avatar_emoji: "MM",
        color_class: "blue",
      },
    ]);

    await expect(
      service.getOwnerMemberList({
        friendsGroupId: "group-1",
        ownerUserId: "owner-a",
      })
    ).resolves.toEqual([
      {
        userId: "owner-a",
        role: "owner",
        joinedAt: "2026-05-14T00:00:00.000Z",
        profile: {
          id: "owner-a",
          display_name: "Owner",
          avatar_emoji: "OO",
          color_class: "lime",
        },
        canRemove: false,
        canTransferOwnership: false,
      },
      {
        userId: "member-a",
        role: "member",
        joinedAt: "2026-05-15T00:00:00.000Z",
        profile: {
          id: "member-a",
          display_name: "Member",
          avatar_emoji: "MM",
          color_class: "blue",
        },
        canRemove: true,
        canTransferOwnership: true,
      },
    ]);

    expect(repositories.profiles.listPreviewsByIds).toHaveBeenCalledWith([
      "owner-a",
      "member-a",
    ]);
  });

  it("blocks member-management list for non-owners", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.findMembership.mockResolvedValue({
      id: "member-membership",
      friends_group_id: "group-1",
      user_id: "member-a",
      role: "member",
      joined_at: "2026-05-14T00:00:00.000Z",
    });

    await expect(
      service.getOwnerMemberList({
        friendsGroupId: "group-1",
        ownerUserId: "member-a",
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repositories.friendsGroupUsers.listMembers).not.toHaveBeenCalled();
  });

  it("lets a member leave and clears their active group refs", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.findMembership.mockResolvedValue({
      id: "membership-1",
      friends_group_id: "group-1",
      user_id: "member-a",
      role: "member",
      joined_at: "2026-05-14T00:00:00.000Z",
    });

    await expect(
      service.removeUserFromFriendsGroup("member-a", "group-1")
    ).resolves.toEqual({ status: "left" });

    expect(repositories.friendsGroupUsers.removeMembership).toHaveBeenCalledWith(
      "member-a",
      "group-1"
    );
    expect(repositories.profiles.clearFriendsGroupRefsForUser).toHaveBeenCalledWith(
      "member-a",
      "group-1"
    );
  });

  it("blocks owner leave while other members remain", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.findMembership.mockResolvedValue({
      id: "membership-1",
      friends_group_id: "group-1",
      user_id: "owner-a",
      role: "owner",
      joined_at: "2026-05-14T00:00:00.000Z",
    });
    repositories.friendsGroupUsers.countMembers.mockResolvedValue(2);

    await expect(
      service.removeUserFromFriendsGroup("owner-a", "group-1")
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(repositories.friendsGroups.archiveById).not.toHaveBeenCalled();
  });

  it("archives the group when the final owner leaves", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.findMembership.mockResolvedValue({
      id: "membership-1",
      friends_group_id: "group-1",
      user_id: "owner-a",
      role: "owner",
      joined_at: "2026-05-14T00:00:00.000Z",
    });
    repositories.friendsGroupUsers.countMembers.mockResolvedValue(1);

    await expect(
      service.removeUserFromFriendsGroup("owner-a", "group-1")
    ).resolves.toEqual({ status: "archived" });

    expect(repositories.friendsGroups.archiveById).toHaveBeenCalledWith("group-1");
    expect(repositories.friendsGroupUsers.removeMembership).toHaveBeenCalledWith(
      "owner-a",
      "group-1"
    );
    expect(repositories.profiles.clearFriendsGroupRefs).toHaveBeenCalledWith("group-1");
  });

  it("lets owner kick a member", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.findMembership
      .mockResolvedValueOnce({
        id: "owner-membership",
        friends_group_id: "group-1",
        user_id: "owner-a",
        role: "owner",
        joined_at: "2026-05-14T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "member-membership",
        friends_group_id: "group-1",
        user_id: "member-a",
        role: "member",
        joined_at: "2026-05-14T00:00:00.000Z",
      });
    repositories.friendsGroups.findById.mockResolvedValue({
      id: "group-1",
      created_by: "owner-a",
      status: "approved",
    } as Awaited<ReturnType<Repositories["friendsGroups"]["findById"]>>);

    await expect(
      service.kickMember({
        friendsGroupId: "group-1",
        ownerUserId: "owner-a",
        targetUserId: "member-a",
      })
    ).resolves.toEqual({
      status: "removed",
      friendsGroupId: "group-1",
      removedUserId: "member-a",
    });

    expect(repositories.friendsGroupUsers.removeMembership).toHaveBeenCalledWith(
      "member-a",
      "group-1"
    );
  });

  it("blocks non-owner kick", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.findMembership.mockResolvedValue({
      id: "member-membership",
      friends_group_id: "group-1",
      user_id: "member-a",
      role: "member",
      joined_at: "2026-05-14T00:00:00.000Z",
    });

    await expect(
      service.kickMember({
        friendsGroupId: "group-1",
        ownerUserId: "member-a",
        targetUserId: "other-member",
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("blocks owner kicking themselves", async () => {
    const { service } = createService();

    await expect(
      service.kickMember({
        friendsGroupId: "group-1",
        ownerUserId: "owner-a",
        targetUserId: "owner-a",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("transfers ownership to an existing member", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.findMembership
      .mockResolvedValueOnce({
        id: "owner-membership",
        friends_group_id: "group-1",
        user_id: "owner-a",
        role: "owner",
        joined_at: "2026-05-14T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "member-membership",
        friends_group_id: "group-1",
        user_id: "member-a",
        role: "member",
        joined_at: "2026-05-14T00:00:00.000Z",
      });
    repositories.friendsGroups.findById.mockResolvedValue({
      id: "group-1",
      created_by: "owner-a",
      status: "approved",
    } as Awaited<ReturnType<Repositories["friendsGroups"]["findById"]>>);

    await expect(
      service.transferOwnership({
        friendsGroupId: "group-1",
        currentOwnerUserId: "owner-a",
        newOwnerUserId: "member-a",
      })
    ).resolves.toEqual({
      status: "transferred",
      friendsGroupId: "group-1",
      previousOwnerUserId: "owner-a",
      newOwnerUserId: "member-a",
    });
    expect(repositories.friendsGroups.transferOwnership).toHaveBeenCalledWith({
      friendsGroupId: "group-1",
      currentOwnerId: "owner-a",
      newOwnerId: "member-a",
    });
  });

  it("blocks transfer to a non-member", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroupUsers.findMembership
      .mockResolvedValueOnce({
        id: "owner-membership",
        friends_group_id: "group-1",
        user_id: "owner-a",
        role: "owner",
        joined_at: "2026-05-14T00:00:00.000Z",
      })
      .mockResolvedValueOnce(null);
    repositories.friendsGroups.findById.mockResolvedValue({
      id: "group-1",
      created_by: "owner-a",
      status: "approved",
    } as Awaited<ReturnType<Repositories["friendsGroups"]["findById"]>>);

    await expect(
      service.transferOwnership({
        friendsGroupId: "group-1",
        currentOwnerUserId: "owner-a",
        newOwnerUserId: "missing-member",
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

});

function overviewFixture(matchweek: string, status: string, startingAt: string) {
  return {
    id: Number(matchweek.match(/\d+/)?.[0] ?? 1),
    sm_fixture_id: Number(matchweek.match(/\d+/)?.[0] ?? 1) + 1000,
    home_team: "Home",
    away_team: "Away",
    home_score: status === "finished" ? 1 : null,
    away_score: status === "finished" ? 0 : null,
    live_home_score: status === "live" ? 1 : null,
    live_away_score: status === "live" ? 0 : null,
    has_red_card: false,
    current_minute: status === "live" ? 45 : null,
    status,
    match_date: startingAt.slice(0, 10),
    match_time: startingAt.slice(11, 19),
    starting_at: startingAt,
    matchweek,
  } as Awaited<
    ReturnType<Repositories["fixtures"]["listOverviewFixturesForSubscription"]>
  >[number];
}

function weeklyScore(
  userId: string,
  weekNumber: number,
  pointsEarned: number,
  groupPoints: number
) {
  return {
    id: `${userId}-${weekNumber}`,
    user_id: userId,
    friends_group_id: "group-1",
    week_number: weekNumber,
    fixtures_predicted: 2,
    exact_score_points: pointsEarned >= 7 ? 3 : 0,
    correct_result_points: pointsEarned >= 5 ? 1 : 0,
    total_goals_bonus: pointsEarned >= 7 ? 1 : 0,
    red_card_bonus: pointsEarned >= 5 ? 1 : 0,
    points_earned: pointsEarned,
    group_points: groupPoints,
    created_at: "2026-05-14T00:00:00.000Z",
    updated_at: "2026-05-14T00:00:00.000Z",
  } as Awaited<
    ReturnType<Repositories["weeklyScores"]["listByGroupPaginated"]>
  >[number];
}
