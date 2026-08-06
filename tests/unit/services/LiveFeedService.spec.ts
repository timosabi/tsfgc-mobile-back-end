import LiveFeedService from "../../../src/services/LiveFeedService.js";
import type { LiveChatGenerator } from "../../../src/services/LiveChatGenerator.js";
import type { LiveFeedFixtureRow } from "../../../src/repositories/FixturesRepository.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

function createService() {
  const repositories = {
    fixtures: createRepositoryMock<
      Pick<Repositories["fixtures"], "findLiveFeedFixture" | "updateFixtureById">
    >(["findLiveFeedFixture", "updateFixtureById"]),
    friendsGroups: createRepositoryMock<
      Pick<Repositories["friendsGroups"], "listApprovedNamesByIds">
    >(["listApprovedNamesByIds"]),
    friendsGroupSubscriptions: createRepositoryMock<
      Pick<Repositories["friendsGroupSubscriptions"], "listActiveByProviderLeague">
    >(["listActiveByProviderLeague"]),
    liveFeedEvents: createRepositoryMock<
      Pick<Repositories["liveFeedEvents"], "listFeed" | "upsertFeedEvent">
    >(["listFeed", "upsertFeedEvent"]),
    matchEvents: createRepositoryMock<
      Pick<Repositories["matchEvents"], "upsertProviderEvent">
    >(["upsertProviderEvent"]),
    predictions: createRepositoryMock<
      Pick<Repositories["predictions"], "listScorePredictionsByGroupFixture">
    >(["listScorePredictionsByGroupFixture"]),
    profiles: createRepositoryMock<
      Pick<Repositories["profiles"], "listDisplayNamesByIds">
    >(["listDisplayNamesByIds"]),
    redCardPredictions: createRepositoryMock<
      Pick<Repositories["redCardPredictions"], "listUserIdsByGroupFixture">
    >(["listUserIdsByGroupFixture"]),
    userSubmissions: createRepositoryMock<
      Pick<Repositories["userSubmissions"], "listSubmittedUserIds">
    >(["listSubmittedUserIds"]),
  };
  const chatGenerator: LiveChatGenerator = {
    generate: jest.fn().mockResolvedValue("Goal. Alex suddenly looks wise."),
  };

  repositories.fixtures.findLiveFeedFixture.mockResolvedValue(liveFixture());
  repositories.friendsGroupSubscriptions.listActiveByProviderLeague.mockResolvedValue([
    {
      friends_group_id: "group-1",
      provider_league_id: 8,
      provider_season_id: 23614,
    },
  ]);
  repositories.friendsGroups.listApprovedNamesByIds.mockResolvedValue([
    { id: "group-1", name: "Los Muchachos" },
  ]);
  repositories.userSubmissions.listSubmittedUserIds.mockResolvedValue([
    { user_id: "user-a" },
    { user_id: "user-b" },
  ]);
  repositories.profiles.listDisplayNamesByIds.mockResolvedValue([
    { id: "user-a", display_name: "Alex" },
    { id: "user-b", display_name: "Bianca" },
  ]);
  repositories.predictions.listScorePredictionsByGroupFixture.mockResolvedValue([
    {
      user_id: "user-a",
      fixture_id: 101,
      home_score_prediction: 1,
      away_score_prediction: 0,
    },
    {
      user_id: "user-b",
      fixture_id: 101,
      home_score_prediction: 0,
      away_score_prediction: 0,
    },
  ]);
  repositories.liveFeedEvents.upsertFeedEvent.mockResolvedValue({
    id: "feed-1",
    friends_group_id: "group-1",
    fixture_id: 101,
    sm_fixture_id: 1101,
    matchweek: "Matchweek 2",
    event_key: "1101:goal:27",
    event_type: "goal",
    ai_message: "Goal. Alex suddenly looks wise.",
    payload: {},
    pushed_at: null,
    created_at: "2026-08-01T10:00:00Z",
  });

  return {
    chatGenerator,
    repositories,
    service: new LiveFeedService(
      repositories as unknown as ConstructorParameters<typeof LiveFeedService>[0],
      chatGenerator
    ),
  };
}

describe("LiveFeedService", () => {
  it("processes a goal into match event, fixture patch, AI context, and feed row", async () => {
    const { chatGenerator, repositories, service } = createService();

    const result = await service.processEvent({
      eventType: "goal",
      fixtureId: 101,
      smFixtureId: 1101,
      smEventId: 27,
      minute: 27,
      homeScore: 1,
      awayScore: 0,
    });

    expect(result).toMatchObject({ created: 1 });
    expect(repositories.matchEvents.upsertProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        fixture_id: 101,
        event_type: "goal",
        sm_event_id: 27,
      }),
      true
    );
    expect(repositories.fixtures.updateFixtureById).toHaveBeenCalledWith(101, {
      live_home_score: 1,
      home_score: 1,
      live_away_score: 0,
      away_score: 0,
    });
    expect(chatGenerator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        groupName: "Los Muchachos",
        affectedPositive: ["Alex"],
        affectedNegative: ["Bianca"],
      })
    );
    expect(repositories.liveFeedEvents.upsertFeedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        friends_group_id: "group-1",
        event_key: "101:goal:27",
        ai_message: "Goal. Alex suddenly looks wise.",
      })
    );
  });

  it("skips unsupported events before writing", async () => {
    const { repositories, service } = createService();

    await expect(
      service.processEvent({ eventType: "corner" as "goal", fixtureId: 101 })
    ).resolves.toEqual({
      created: 0,
      skipped: true,
      reason: "unsupported_event",
    });
    expect(repositories.matchEvents.upsertProviderEvent).not.toHaveBeenCalled();
  });
});

function liveFixture(): LiveFeedFixtureRow {
  return {
    id: 101,
    sm_fixture_id: 1101,
    sm_league_id: 8,
    sm_season_id: 23614,
    home_team: "Arsenal",
    away_team: "Chelsea",
    home_score: 0,
    away_score: 0,
    live_home_score: 0,
    live_away_score: 0,
    has_red_card: false,
    matchweek: "Matchweek 2",
  };
}
