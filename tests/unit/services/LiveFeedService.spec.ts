import LiveFeedService from "../../../src/services/LiveFeedService.js";
import type { LiveChatGenerator } from "../../../src/services/LiveChatGenerator.js";
import type { LiveFeedFixtureRow } from "../../../src/repositories/FixturesRepository.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

function createService(pushNotifications?: { sendToUsers: jest.Mock }) {
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
      Pick<Repositories["matchEvents"], "upsertProviderEvent" | "findBySmEventId">
    >(["upsertProviderEvent", "findBySmEventId"]),
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
      chatGenerator,
      pushNotifications as never
    ),
  };
}

describe("LiveFeedService", () => {
  it("processes a goal into match event, AI context, and feed row, without patching the fixture's score", async () => {
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
    // Score columns are owned exclusively by the bulk /livescores poll (Source A);
    // a per-event goal replay (Source B) must never write them -- that race is what
    // produced the live "4-0 briefly, then corrected to 3-1" incident.
    expect(repositories.fixtures.updateFixtureById).not.toHaveBeenCalled();
    expect(chatGenerator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        groupName: "Los Muchachos",
        impacts: [
          { name: "Alex", change: "exact_gained", predictedHome: 1, predictedAway: 0 },
          { name: "Bianca", change: "exact_lost", predictedHome: 0, predictedAway: 0 },
        ],
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

  it("uses the explicit before-score for prediction diffing, not the fixture's already-live score", async () => {
    const { repositories, service } = createService();
    // Simulates the real poller: getLiveFixtures() has already patched the fixture
    // row to the post-goal score before processEvent runs, so the fixture's own
    // live_home_score/live_away_score can't be trusted as "before this goal".
    repositories.fixtures.findLiveFeedFixture.mockResolvedValue(
      liveFixture({ live_home_score: 1, live_away_score: 0 }),
    );

    await service.processEvent({
      eventType: "goal",
      fixtureId: 101,
      smFixtureId: 1101,
      smEventId: 27,
      minute: 27,
      homeScore: 1,
      awayScore: 0,
      beforeHomeScore: 0,
      beforeAwayScore: 0,
    });

    expect(repositories.liveFeedEvents.upsertFeedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          impacts: [
            { name: "Alex", change: "exact_gained", predictedHome: 1, predictedAway: 0 },
            { name: "Bianca", change: "exact_lost", predictedHome: 0, predictedAway: 0 },
          ],
        }),
      }),
    );
  });

  it("passes scorer, assist, and penalty/own-goal detail through to the chat generator", async () => {
    const { chatGenerator, service } = createService();

    await service.processEvent({
      eventType: "goal",
      fixtureId: 101,
      smFixtureId: 1101,
      smEventId: 27,
      minute: 27,
      team: "Arsenal",
      playerName: "Kane",
      assistedBy: "Saka",
      isPenalty: true,
      isOwnGoal: false,
      homeScore: 1,
      awayScore: 0,
    });

    expect(chatGenerator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        player: "Kane",
        assistedBy: "Saka",
        team: "Arsenal",
        isPenalty: true,
        isOwnGoal: false,
      })
    );
  });

  it("skips already-processed events before generating or fanning out to groups", async () => {
    const { chatGenerator, repositories, service } = createService();
    repositories.matchEvents.findBySmEventId.mockResolvedValue({ id: "evt-1" });

    const result = await service.processEvent({
      eventType: "goal",
      fixtureId: 101,
      smFixtureId: 1101,
      smEventId: 27,
      minute: 27,
      homeScore: 1,
      awayScore: 0,
    });

    expect(result).toEqual({
      created: 0,
      skipped: true,
      reason: "already_processed",
    });
    expect(repositories.fixtures.findLiveFeedFixture).not.toHaveBeenCalled();
    expect(repositories.matchEvents.upsertProviderEvent).not.toHaveBeenCalled();
    expect(chatGenerator.generate).not.toHaveBeenCalled();
    expect(repositories.liveFeedEvents.upsertFeedEvent).not.toHaveBeenCalled();
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

  it.each([
    ["goal", undefined],
    ["halftime", undefined],
    ["minute_85", undefined],
    ["fulltime", undefined],
    ["red_card", { has_red_card: true }],
  ] as const)(
    "never writes score columns for a %s event (only has_red_card, if anything)",
    async (eventType, expectedPatch) => {
      const { repositories, service } = createService();
      repositories.matchEvents.findBySmEventId.mockResolvedValue(null);

      await service.processEvent({
        eventType,
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        homeScore: 1,
        awayScore: 0,
      });

      if (expectedPatch) {
        expect(repositories.fixtures.updateFixtureById).toHaveBeenCalledWith(
          101,
          expectedPatch
        );
      } else {
        expect(repositories.fixtures.updateFixtureById).not.toHaveBeenCalled();
      }
    }
  );

  it("uses the goal event's own score over a stale fixture row, for commentary", async () => {
    // Reproduces a real incident: a Brighton goal's own SportMonks payload said
    // "result": "3-1" (parsed upstream into input.homeScore/awayScore by
    // LiveEventsPollerService.parseEventResult), but the fixture row's
    // live_*_score columns -- only as fresh as the last bulk /livescores poll --
    // hadn't caught up yet and still said 3-0. Commentary showed "Brighton
    // score... 3-0", contradicting itself. The per-event score must win.
    const { chatGenerator, repositories, service } = createService();
    repositories.fixtures.findLiveFeedFixture.mockResolvedValue(
      liveFixture({ live_home_score: 3, live_away_score: 0 })
    );

    await service.processEvent({
      eventType: "goal",
      fixtureId: 101,
      smFixtureId: 1101,
      smEventId: 27,
      minute: 36,
      homeScore: 3,
      awayScore: 1,
    });

    expect(chatGenerator.generate).toHaveBeenCalledWith(
      expect.objectContaining({ score: { home: 3, away: 1 } })
    );
  });

  it("persists the goal event's own score in the feed row's payload, not a stale fixture row", async () => {
    const { repositories, service } = createService();
    repositories.fixtures.findLiveFeedFixture.mockResolvedValue(
      liveFixture({ live_home_score: 3, live_away_score: 0 })
    );

    await service.processEvent({
      eventType: "goal",
      fixtureId: 101,
      smFixtureId: 1101,
      smEventId: 27,
      minute: 36,
      homeScore: 3,
      awayScore: 1,
    });

    expect(repositories.liveFeedEvents.upsertFeedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          event: expect.objectContaining({ homeScore: 3, awayScore: 1 }),
        }),
      })
    );
  });

  it("sends a push notification to submitted users for a goal", async () => {
    const pushNotifications = { sendToUsers: jest.fn().mockResolvedValue({ sent: 2, skipped: false }) };
    const { service } = createService(pushNotifications);

    await service.processEvent({
      eventType: "goal",
      fixtureId: 101,
      smFixtureId: 1101,
      smEventId: 27,
      minute: 27,
      homeScore: 1,
      awayScore: 0,
    });

    expect(pushNotifications.sendToUsers).toHaveBeenCalledWith(
      ["user-a", "user-b"],
      expect.objectContaining({
        title: "Arsenal vs Chelsea",
        body: "Goal. Alex suddenly looks wise.",
        data: { type: "goal", friendsGroupId: "group-1", matchweek: "Matchweek 2" },
      })
    );
  });

  it("sends a push notification for a red card", async () => {
    const pushNotifications = { sendToUsers: jest.fn().mockResolvedValue({ sent: 2, skipped: false }) };
    const { service } = createService(pushNotifications);

    await service.processEvent({
      eventType: "red_card",
      fixtureId: 101,
      smFixtureId: 1101,
      smEventId: 30,
      minute: 60,
    });

    expect(pushNotifications.sendToUsers).toHaveBeenCalledWith(
      ["user-a", "user-b"],
      expect.objectContaining({ data: expect.objectContaining({ type: "red_card" }) })
    );
  });

  it.each(["halftime", "minute_85", "fulltime"] as const)(
    "does not send a push notification for a %s marker",
    async (eventType) => {
      const pushNotifications = { sendToUsers: jest.fn() };
      const { service } = createService(pushNotifications);

      await service.processEvent({
        eventType,
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 99,
        minute: 45,
      });

      expect(pushNotifications.sendToUsers).not.toHaveBeenCalled();
    }
  );

  it("works fine without a pushNotifications dependency at all", async () => {
    const { service } = createService(undefined);

    await expect(
      service.processEvent({
        eventType: "goal",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        homeScore: 1,
        awayScore: 0,
      })
    ).resolves.toMatchObject({ created: 1 });
  });
});

function liveFixture(
  overrides: Partial<LiveFeedFixtureRow> = {},
): LiveFeedFixtureRow {
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
    ...overrides,
  };
}
