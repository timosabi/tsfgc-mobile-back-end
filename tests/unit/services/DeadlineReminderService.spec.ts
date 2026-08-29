import DeadlineReminderService from "../../../src/services/DeadlineReminderService.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

function isoHoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function createService() {
  const repositories = {
    friendsGroupSubscriptions: createRepositoryMock<
      Pick<Repositories["friendsGroupSubscriptions"], "listActiveTargets">
    >(["listActiveTargets"]),
    fixtures: createRepositoryMock<
      Pick<Repositories["fixtures"], "listOpenMatchweeks" | "listForSubscription">
    >(["listOpenMatchweeks", "listForSubscription"]),
    friendsGroupUsers: createRepositoryMock<
      Pick<Repositories["friendsGroupUsers"], "listMembers">
    >(["listMembers"]),
    userSubmissions: createRepositoryMock<
      Pick<Repositories["userSubmissions"], "listSubmittedUserIds">
    >(["listSubmittedUserIds"]),
    friendsGroups: createRepositoryMock<Pick<Repositories["friendsGroups"], "findById">>([
      "findById",
    ]),
  };
  const pushNotifications = { sendToUsers: jest.fn().mockResolvedValue({ sent: 1, skipped: false }) };

  repositories.friendsGroupSubscriptions.listActiveTargets.mockResolvedValue([
    { friends_group_id: "group-1", provider_league_id: 8, provider_season_id: 23614 },
  ]);
  repositories.friendsGroupUsers.listMembers.mockResolvedValue([
    { user_id: "user-a", joined_at: "2026-01-01", role: "owner" },
    { user_id: "user-b", joined_at: "2026-01-01", role: "member" },
  ]);
  repositories.userSubmissions.listSubmittedUserIds.mockResolvedValue([
    { user_id: "user-a" },
  ]);
  repositories.friendsGroups.findById.mockResolvedValue({
    id: "group-1",
    name: "Los Muchachos",
    slug: "los-muchachos",
  } as never);

  const service = new DeadlineReminderService(
    repositories as unknown as ConstructorParameters<typeof DeadlineReminderService>[0],
    pushNotifications as never
  );

  return { repositories, pushNotifications, service };
}

describe("DeadlineReminderService", () => {
  it("does nothing when a subscription has no open matchweeks", async () => {
    const { repositories, pushNotifications, service } = createService();
    repositories.fixtures.listOpenMatchweeks.mockResolvedValue([]);

    const result = await service.checkAndRemind();

    expect(result).toEqual({ remindersSent: 0 });
    expect(pushNotifications.sendToUsers).not.toHaveBeenCalled();
  });

  it("does nothing when the matchweek's fixtures have already locked", async () => {
    const { repositories, pushNotifications, service } = createService();
    repositories.fixtures.listOpenMatchweeks.mockResolvedValue(["Matchweek 2"]);
    repositories.fixtures.listForSubscription.mockResolvedValue([
      { starting_at: isoHoursFromNow(-1), match_date: "2026-08-01", match_time: "15:00:00" },
    ] as never);

    const result = await service.checkAndRemind();

    expect(result).toEqual({ remindersSent: 0 });
    expect(pushNotifications.sendToUsers).not.toHaveBeenCalled();
  });

  it("reminds non-submitted members once the 24h threshold is crossed", async () => {
    const { repositories, pushNotifications, service } = createService();
    repositories.fixtures.listOpenMatchweeks.mockResolvedValue(["Matchweek 2"]);
    repositories.fixtures.listForSubscription.mockResolvedValue([
      { starting_at: isoHoursFromNow(20), match_date: "2026-08-01", match_time: "15:00:00" },
    ] as never);

    const result = await service.checkAndRemind();

    expect(result).toEqual({ remindersSent: 1 });
    expect(pushNotifications.sendToUsers).toHaveBeenCalledTimes(1);
    expect(pushNotifications.sendToUsers).toHaveBeenCalledWith(
      ["user-b"], // only the non-submitted member
      expect.objectContaining({
        title: "Predictions lock soon",
        body: expect.stringContaining("24 hours"),
        data: {
          type: "deadline_reminder",
          friendsGroupId: "group-1",
          slug: "los-muchachos",
        },
      })
    );
  });

  it("does not re-send the same threshold on a later tick", async () => {
    const { repositories, pushNotifications, service } = createService();
    repositories.fixtures.listOpenMatchweeks.mockResolvedValue(["Matchweek 2"]);
    repositories.fixtures.listForSubscription.mockResolvedValue([
      { starting_at: isoHoursFromNow(20), match_date: "2026-08-01", match_time: "15:00:00" },
    ] as never);

    await service.checkAndRemind();
    const secondResult = await service.checkAndRemind();

    expect(secondResult).toEqual({ remindersSent: 0 });
    expect(pushNotifications.sendToUsers).toHaveBeenCalledTimes(1);
  });

  it("fires the 2h threshold separately once crossed, without re-firing 24h", async () => {
    const { repositories, pushNotifications, service } = createService();
    repositories.fixtures.listOpenMatchweeks.mockResolvedValue(["Matchweek 2"]);

    // First tick: 20h remaining -- crosses the 24h threshold.
    repositories.fixtures.listForSubscription.mockResolvedValueOnce([
      { starting_at: isoHoursFromNow(20), match_date: "2026-08-01", match_time: "15:00:00" },
    ] as never);
    await service.checkAndRemind();

    // Second tick: 1.5h remaining -- crosses the 2h threshold too.
    repositories.fixtures.listForSubscription.mockResolvedValueOnce([
      { starting_at: isoHoursFromNow(1.5), match_date: "2026-08-01", match_time: "15:00:00" },
    ] as never);
    const result = await service.checkAndRemind();

    expect(result).toEqual({ remindersSent: 1 });
    expect(pushNotifications.sendToUsers).toHaveBeenCalledTimes(2);
    expect(pushNotifications.sendToUsers).toHaveBeenLastCalledWith(
      ["user-b"],
      expect.objectContaining({ body: expect.stringContaining("2 hours") })
    );
  });

  it("does not call sendToUsers when every member has already submitted", async () => {
    const { repositories, pushNotifications, service } = createService();
    repositories.fixtures.listOpenMatchweeks.mockResolvedValue(["Matchweek 2"]);
    repositories.fixtures.listForSubscription.mockResolvedValue([
      { starting_at: isoHoursFromNow(20), match_date: "2026-08-01", match_time: "15:00:00" },
    ] as never);
    repositories.userSubmissions.listSubmittedUserIds.mockResolvedValue([
      { user_id: "user-a" },
      { user_id: "user-b" },
    ]);

    const result = await service.checkAndRemind();

    expect(result).toEqual({ remindersSent: 0 });
    expect(pushNotifications.sendToUsers).not.toHaveBeenCalled();
  });
});
