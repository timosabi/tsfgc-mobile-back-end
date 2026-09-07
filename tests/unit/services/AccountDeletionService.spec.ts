import AccountDeletionService from "../../../src/services/AccountDeletionService.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

function createService() {
  const repositories = {
    predictions: createRepositoryMock<Pick<Repositories["predictions"], "deleteByUserId">>([
      "deleteByUserId",
    ]),
    redCardPredictions: createRepositoryMock<
      Pick<Repositories["redCardPredictions"], "deleteByUserId">
    >(["deleteByUserId"]),
    userSubmissions: createRepositoryMock<
      Pick<Repositories["userSubmissions"], "deleteByUserId">
    >(["deleteByUserId"]),
    weeklyScores: createRepositoryMock<Pick<Repositories["weeklyScores"], "deleteByUserId">>([
      "deleteByUserId",
    ]),
    notificationSubscriptions: createRepositoryMock<
      Pick<Repositories["notificationSubscriptions"], "deleteByUserId">
    >(["deleteByUserId"]),
    friendsGroupJoinRequests: createRepositoryMock<
      Pick<Repositories["friendsGroupJoinRequests"], "deleteByUserId">
    >(["deleteByUserId"]),
    friendsGroupUsers: createRepositoryMock<
      Pick<Repositories["friendsGroupUsers"], "deleteByUserId">
    >(["deleteByUserId"]),
    friendsGroups: createRepositoryMock<
      Pick<Repositories["friendsGroups"], "findActiveOwnedByUserId">
    >(["findActiveOwnedByUserId"]),
    profiles: createRepositoryMock<Pick<Repositories["profiles"], "deleteById">>([
      "deleteById",
    ]),
  };

  return {
    repositories,
    service: new AccountDeletionService(
      repositories as unknown as ConstructorParameters<typeof AccountDeletionService>[0]
    ),
  };
}

describe("AccountDeletionService", () => {
  it("deletes the user's data across every table and the profile itself", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroups.findActiveOwnedByUserId.mockResolvedValue([]);

    await expect(service.deleteAccount("user-a")).resolves.toEqual({
      status: "deleted",
    });

    expect(repositories.predictions.deleteByUserId).toHaveBeenCalledWith("user-a");
    expect(repositories.redCardPredictions.deleteByUserId).toHaveBeenCalledWith("user-a");
    expect(repositories.userSubmissions.deleteByUserId).toHaveBeenCalledWith("user-a");
    expect(repositories.weeklyScores.deleteByUserId).toHaveBeenCalledWith("user-a");
    expect(repositories.notificationSubscriptions.deleteByUserId).toHaveBeenCalledWith(
      "user-a"
    );
    expect(repositories.friendsGroupJoinRequests.deleteByUserId).toHaveBeenCalledWith(
      "user-a"
    );
    expect(repositories.friendsGroupUsers.deleteByUserId).toHaveBeenCalledWith("user-a");
    expect(repositories.profiles.deleteById).toHaveBeenCalledWith("user-a");
  });

  it("blocks deletion when the user still owns an active group", async () => {
    const { repositories, service } = createService();
    repositories.friendsGroups.findActiveOwnedByUserId.mockResolvedValue([
      { id: "group-1", name: "The League" },
    ]);

    await expect(service.deleteAccount("user-a")).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(repositories.predictions.deleteByUserId).not.toHaveBeenCalled();
    expect(repositories.friendsGroupUsers.deleteByUserId).not.toHaveBeenCalled();
    expect(repositories.profiles.deleteById).not.toHaveBeenCalled();
  });
});
