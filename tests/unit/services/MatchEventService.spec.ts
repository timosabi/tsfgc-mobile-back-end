import MatchEventService from "../../../src/services/MatchEventService.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

function createService() {
  const repositories = {
    matchEvents: createRepositoryMock<
      Pick<
        Repositories["matchEvents"],
        "insertEvent" | "listByFixture" | "listGoalEvents" | "listRedCardIds"
      >
    >(["insertEvent", "listByFixture", "listGoalEvents", "listRedCardIds"]),
  };

  return {
    repositories,
    service: new MatchEventService(
      repositories as unknown as ConstructorParameters<typeof MatchEventService>[0]
    ),
  };
}

describe("MatchEventService", () => {
  it("reads match events by fixture and event type", async () => {
    const { repositories, service } = createService();
    repositories.matchEvents.listByFixture.mockResolvedValue([]);
    repositories.matchEvents.listGoalEvents.mockResolvedValue([]);

    await expect(service.getMatchEvents(101)).resolves.toEqual([]);
    await expect(service.getFixtureGoalEvents(101)).resolves.toEqual([]);

    expect(repositories.matchEvents.listByFixture).toHaveBeenCalledWith(101);
    expect(repositories.matchEvents.listGoalEvents).toHaveBeenCalledWith(101);
  });

  it("inserts events and checks red-card occurrence", async () => {
    const { repositories, service } = createService();
    repositories.matchEvents.insertEvent.mockResolvedValue(null);
    repositories.matchEvents.listRedCardIds.mockResolvedValue([{ id: "event-1" }]);

    await service.insertMatchEvent({
      fixture_id: 101,
      event_type: "goal",
      minute: 27,
      player_name: "Saka",
      team: "home",
    });
    await expect(service.checkIfRedCardOccured(101)).resolves.toEqual([
      { id: "event-1" },
    ]);
  });
});
