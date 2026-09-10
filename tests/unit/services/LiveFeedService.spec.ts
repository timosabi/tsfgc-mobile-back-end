import LiveFeedService from "../../../src/services/LiveFeedService.js";
import type { LiveChatGenerator } from "../../../src/services/LiveChatGenerator.js";
import type { LiveFeedFixtureRow } from "../../../src/repositories/FixturesRepository.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

function createService(
  matchweekOverview?: { getMatchweekScores: jest.Mock },
  scoreUpdateGenerator?: LiveChatGenerator
) {
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
  const impactGenerator: LiveChatGenerator = {
    generate: jest.fn().mockResolvedValue("Molly has hit their exact score."),
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
  (repositories.liveFeedEvents.upsertFeedEvent as jest.Mock).mockImplementation(
    (row: Record<string, unknown>) =>
    Promise.resolve({
      id: "feed-1",
      friends_group_id: "group-1",
      fixture_id: 101,
      sm_fixture_id: 1101,
      matchweek: "Matchweek 2",
      pushed_at: null,
      created_at: "2026-08-01T10:00:00Z",
      ...row,
    })
  );

  return {
    impactGenerator,
    repositories,
    service: new LiveFeedService(
      repositories as unknown as ConstructorParameters<typeof LiveFeedService>[0],
      impactGenerator,
      matchweekOverview as never,
      scoreUpdateGenerator
    ),
  };
}

function upsertCallsFor(repositories: ReturnType<typeof createService>["repositories"], suffix: string) {
  return (repositories.liveFeedEvents.upsertFeedEvent as jest.Mock).mock.calls.filter(
    ([row]) => row.event_key.endsWith(suffix)
  );
}

describe("LiveFeedService", () => {
  describe("Score Update (immediate)", () => {
    it("writes a Score Update row for a goal immediately (deterministic fallback when no AI generator is configured), without touching the impact generator or patching the fixture's score", async () => {
      const { impactGenerator, repositories, service } = createService();

      const result = await service.processEvent({
        eventType: "goal",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        team: "Arsenal",
        playerName: "Saka",
        homeScore: 1,
        awayScore: 0,
      });

      expect(result).toMatchObject({ created: 1 });
      expect(impactGenerator.generate).not.toHaveBeenCalled();
      // Score columns are owned exclusively by the bulk /livescores poll (Source A);
      // a per-event goal replay (Source B) must never write them.
      expect(repositories.fixtures.updateFixtureById).not.toHaveBeenCalled();
      expect(repositories.liveFeedEvents.upsertFeedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          friends_group_id: "group-1",
          event_key: "101:goal:27:score",
          ai_message: expect.stringContaining("GOAL!"),
          payload: expect.objectContaining({ stage: "score_update" }),
        })
      );
    });

    it("generates the Score Update via the AI generator when one is configured, for a goal or red card", async () => {
      const scoreUpdateGenerator: LiveChatGenerator = {
        generate: jest.fn().mockResolvedValue("GOAL! 27' Saka scores! Arsenal edge ahead."),
      };
      const { repositories, service } = createService(undefined, scoreUpdateGenerator);

      await service.processEvent({
        eventType: "goal",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        team: "Arsenal",
        playerName: "Saka",
        homeScore: 1,
        awayScore: 0,
      });

      expect(scoreUpdateGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "goal", player: "Saka" })
      );
      expect(repositories.liveFeedEvents.upsertFeedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_key: "101:goal:27:score",
          ai_message: "GOAL! 27' Saka scores! Arsenal edge ahead.",
        })
      );
    });

    it("does not call the Score Update AI generator for ambient markers (kickoff/halftime/minute_85/fulltime)", async () => {
      const scoreUpdateGenerator: LiveChatGenerator = {
        generate: jest.fn().mockResolvedValue("should not be used"),
      };
      const { service } = createService(undefined, scoreUpdateGenerator);

      await service.processEvent({
        eventType: "kickoff",
        smFixtureId: 1101,
        smEventId: 1101900,
        minute: 0,
      });

      expect(scoreUpdateGenerator.generate).not.toHaveBeenCalled();
    });

    it("records the goal event's own score in the score-update payload, not a stale fixture row", async () => {
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
          payload: expect.objectContaining({ score: { home: 3, away: 1 } }),
        })
      );
    });

    it("records the pre-goal score in the score-update payload", async () => {
      // Reproduces a real incident: with no previousScore recorded, the very
      // first goal of a 0-0 game had no way to be distinguished from a lead
      // being extended.
      const { repositories, service } = createService();

      await service.processEvent({
        eventType: "goal",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        homeScore: 1,
        awayScore: 0,
      });

      expect(repositories.liveFeedEvents.upsertFeedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            score: { home: 1, away: 0 },
            previousScore: { home: 0, away: 0 },
          }),
        })
      );
    });

    it("writes an ambient marker (kickoff/halftime/minute_85/fulltime) immediately with no chat-generator call and no pending verification", async () => {
      const { impactGenerator, repositories, service } = createService();

      await service.processEvent({
        eventType: "kickoff",
        smFixtureId: 1101,
        smEventId: 1101900,
        minute: 0,
      });

      expect(impactGenerator.generate).not.toHaveBeenCalled();
      expect(repositories.liveFeedEvents.upsertFeedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_key: "1101:kickoff:1101900",
          ai_message: expect.stringContaining("KICK OFF"),
        })
      );
      expect(service.getDuePendingVerifications(1101, Date.now() + 999_999)).toEqual([]);
    });

    it("skips already-processed events before generating or fanning out to groups", async () => {
      const { impactGenerator, repositories, service } = createService();
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
      expect(impactGenerator.generate).not.toHaveBeenCalled();
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
      ["kickoff", undefined],
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
  });

  describe("pending verification queue", () => {
    it("registers a pending verification for a goal/red_card, but not for ambient markers", async () => {
      const { service } = createService();

      await service.processEvent({
        eventType: "goal",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        homeScore: 1,
        awayScore: 0,
      });

      expect(service.getAllPendingVerifications(1101)).toHaveLength(1);
    });

    it("only surfaces a pending verification once its delay has elapsed", async () => {
      const { service } = createService();

      await service.processEvent({
        eventType: "goal",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        homeScore: 1,
        awayScore: 0,
      });

      // Read the pending entry's actual recorded detectedAt back, rather than
      // assuming it lines up with a timestamp taken just before the
      // (asynchronous) processEvent call -- that gap is normally a
      // sub-millisecond race, but not one worth the test depending on.
      const { detectedAt } = service.getAllPendingVerifications(1101)[0];

      expect(service.getDuePendingVerifications(1101, detectedAt + 60_000)).toEqual([]);
      expect(service.getDuePendingVerifications(1101, detectedAt + 120_000)).toHaveLength(1);
    });

    it("resolveVerification is a no-op for an unknown key", async () => {
      const { impactGenerator, repositories, service } = createService();

      await expect(service.resolveVerification("no-such-key", true)).resolves.toBeUndefined();
      expect(impactGenerator.generate).not.toHaveBeenCalled();
      expect(repositories.liveFeedEvents.upsertFeedEvent).not.toHaveBeenCalled();
    });

    it("clears the pending entry once resolved", async () => {
      const { service } = createService();

      await service.processEvent({
        eventType: "goal",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        homeScore: 1,
        awayScore: 0,
      });
      await service.resolveVerification("101:goal:27", true);

      expect(service.getAllPendingVerifications(1101)).toEqual([]);
    });
  });

  describe("Impact message (after verification confirms)", () => {
    it("computes impacts from the explicit before-score, not the fixture's already-live score, and writes an impact row", async () => {
      const { impactGenerator, repositories, service } = createService();
      // Simulates the real poller: getLiveFixtures() has already patched the
      // fixture row to the post-goal score before processEvent runs, so the
      // fixture's own live_*_score can't be trusted as "before this goal".
      repositories.fixtures.findLiveFeedFixture.mockResolvedValue(
        liveFixture({ live_home_score: 1, live_away_score: 0 })
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
      await service.resolveVerification("101:goal:27", true);

      expect(impactGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          groupName: "Los Muchachos",
          impacts: [{ name: "Alex", change: "exact_gained", rankDisplay: null }],
        })
      );
      expect(repositories.liveFeedEvents.upsertFeedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_key: "101:goal:27:impact",
          ai_message: "Molly has hit their exact score.",
        })
      );
    });

    it("filters out result_gained in favour of exact_gained before calling the chat generator", async () => {
      const { impactGenerator, repositories, service } = createService();
      repositories.predictions.listScorePredictionsByGroupFixture.mockResolvedValue([
        { user_id: "user-a", fixture_id: 101, home_score_prediction: 1, away_score_prediction: 0 },
        { user_id: "user-b", fixture_id: 101, home_score_prediction: 2, away_score_prediction: 0 },
      ]);

      await service.processEvent({
        eventType: "goal",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        homeScore: 1,
        awayScore: 0,
      });
      await service.resolveVerification("101:goal:27", true);

      const impacts = (impactGenerator.generate as jest.Mock).mock.calls[0][0].impacts;
      expect(impacts.map((impact: { change: string }) => impact.change)).toEqual([
        "exact_gained",
      ]);
    });

    it("does not call the chat generator or write an impact row when nothing meaningful changed", async () => {
      const { impactGenerator, repositories, service } = createService();
      // Both users' predictions stay wrong before and after -- no exact_gained,
      // no result_gained, only the implicit "no change" case.
      repositories.predictions.listScorePredictionsByGroupFixture.mockResolvedValue([
        { user_id: "user-a", fixture_id: 101, home_score_prediction: 0, away_score_prediction: 5 },
      ]);

      await service.processEvent({
        eventType: "goal",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        homeScore: 1,
        awayScore: 0,
      });
      await service.resolveVerification("101:goal:27", true);

      expect(impactGenerator.generate).not.toHaveBeenCalled();
      expect(upsertCallsFor(repositories, ":impact")).toHaveLength(0);
    });

    it("attaches each user's current matchweek rank to a goal event's impacts", async () => {
      const matchweekOverview = {
        getMatchweekScores: jest.fn().mockResolvedValue({
          rows: [
            { user_id: "user-a", rank: 1, rank_display: "#1" },
            { user_id: "user-b", rank: 2, rank_display: "#2" },
          ],
        }),
      };
      const { impactGenerator, service } = createService(matchweekOverview);

      await service.processEvent({
        eventType: "goal",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        homeScore: 1,
        awayScore: 0,
      });
      await service.resolveVerification("101:goal:27", true);

      // Called twice: once for the score just before this goal, once for
      // just after, so a result_gained/result_lost impact (not exercised by
      // this exact-score test) can tell whether the goal actually moved
      // anyone's rank.
      expect(matchweekOverview.getMatchweekScores).toHaveBeenCalledWith({
        friendsGroupId: "group-1",
        matchweek: "Matchweek 2",
        fixtureScoreOverride: { fixtureId: 101, homeScore: 0, awayScore: 0 },
      });
      expect(matchweekOverview.getMatchweekScores).toHaveBeenCalledWith({
        friendsGroupId: "group-1",
        matchweek: "Matchweek 2",
        fixtureScoreOverride: { fixtureId: 101, homeScore: 1, awayScore: 0 },
      });
      expect(impactGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          impacts: expect.arrayContaining([
            expect.objectContaining({ name: "Alex", rankDisplay: "1st" }),
          ]),
        })
      );
    });

    it("attaches each user's current matchweek rank to a red_card event's impacts", async () => {
      const matchweekOverview = {
        getMatchweekScores: jest.fn().mockResolvedValue({
          rows: [
            { user_id: "user-a", rank: 1, rank_display: "#1" },
            { user_id: "user-b", rank: 1, rank_display: "=1" },
          ],
        }),
      };
      const { impactGenerator, repositories, service } = createService(matchweekOverview);
      repositories.redCardPredictions.listUserIdsByGroupFixture.mockResolvedValue([
        { user_id: "user-a", fixture_id: 101 },
        { user_id: "user-b", fixture_id: 101 },
      ]);

      await service.processEvent({
        eventType: "red_card",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 99,
        minute: 45,
      });
      await service.resolveVerification("101:red_card:99", true);

      expect(impactGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          impacts: expect.arrayContaining([
            expect.objectContaining({ name: "Alex", rankDisplay: "1st" }),
            expect.objectContaining({ name: "Bianca", rankDisplay: "tied for 1st" }),
          ]),
        })
      );
    });

    it("degrades gracefully when the rank lookup fails, omitting rankDisplay instead of throwing", async () => {
      const matchweekOverview = {
        getMatchweekScores: jest.fn().mockRejectedValue(new Error("boom")),
      };
      const { impactGenerator, service } = createService(matchweekOverview);

      await service.processEvent({
        eventType: "goal",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        homeScore: 1,
        awayScore: 0,
      });
      await service.resolveVerification("101:goal:27", true);

      expect(impactGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          impacts: expect.arrayContaining([
            expect.objectContaining({ name: "Alex", rankDisplay: null }),
          ]),
        })
      );
    });

    describe("result-guess (win/draw/loss) impacts", () => {
      it("reports a result_gained impact, with rank movement, for a non-exact prediction whose result just became correct", async () => {
        const matchweekOverview = {
          // Before this goal (0-0, a draw) both users sat tied at rank 2. After
          // it (1-0, a home win) user-a's now-correct result moves them to
          // rank 1, while user-b's stays put at rank 2.
          getMatchweekScores: jest.fn().mockImplementation(
            ({ fixtureScoreOverride }: { fixtureScoreOverride?: { homeScore: number } }) =>
              Promise.resolve({
                rows:
                  fixtureScoreOverride?.homeScore === 1
                    ? [
                        { user_id: "user-a", rank: 1, rank_display: "#1" },
                        { user_id: "user-b", rank: 2, rank_display: "#2" },
                      ]
                    : [
                        { user_id: "user-a", rank: 2, rank_display: "#2" },
                        { user_id: "user-b", rank: 2, rank_display: "#2" },
                      ],
              })
          ),
        };
        const { impactGenerator, repositories, service } = createService(matchweekOverview);
        repositories.predictions.listScorePredictionsByGroupFixture.mockResolvedValue([
          { user_id: "user-a", fixture_id: 101, home_score_prediction: 3, away_score_prediction: 0 },
          { user_id: "user-b", fixture_id: 101, home_score_prediction: 2, away_score_prediction: 0 },
        ]);

        await service.processEvent({
          eventType: "goal",
          fixtureId: 101,
          smFixtureId: 1101,
          smEventId: 27,
          minute: 27,
          homeScore: 1,
          awayScore: 0,
        });
        await service.resolveVerification("101:goal:27", true);

        expect(impactGenerator.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            impacts: expect.arrayContaining([
              expect.objectContaining({
                name: "Alex",
                change: "result_gained",
                rankMovement: "up",
              }),
              expect.objectContaining({
                name: "Bianca",
                change: "result_gained",
                rankMovement: "none",
              }),
            ]),
          })
        );
      });

      it("reports a result_lost impact when a later goal turns a correct result incorrect", async () => {
        const { impactGenerator, repositories, service } = createService();
        repositories.predictions.listScorePredictionsByGroupFixture.mockResolvedValue([
          { user_id: "user-a", fixture_id: 101, home_score_prediction: 2, away_score_prediction: 0 },
        ]);

        await service.processEvent({
          eventType: "goal",
          fixtureId: 101,
          smFixtureId: 1101,
          smEventId: 28,
          minute: 89,
          beforeHomeScore: 1,
          beforeAwayScore: 0,
          homeScore: 1,
          awayScore: 1,
        });
        await service.resolveVerification("101:goal:28", true);

        // A solo result_lost, with no exact_gained/result_gained anywhere in
        // the batch, still isn't "nothing meaningful" -- filterImpactsForMessage
        // drops _lost changes from the MESSAGE, but the underlying impacts
        // computation itself must still have detected it correctly.
        expect(impactGenerator.generate).not.toHaveBeenCalled();
      });
    });
  });

  describe("VAR overturn", () => {
    it("writes a NO GOAL correction instead of an impact when a goal is overturned, without calling the chat generator", async () => {
      const { impactGenerator, repositories, service } = createService();

      await service.processEvent({
        eventType: "goal",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 27,
        minute: 27,
        homeScore: 1,
        awayScore: 0,
      });
      await service.resolveVerification("101:goal:27", false);

      expect(impactGenerator.generate).not.toHaveBeenCalled();
      expect(repositories.liveFeedEvents.upsertFeedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_key: "101:goal:27:overturned",
          ai_message: "NO GOAL. As we were. Calm down.",
        })
      );
    });

    it("writes a CARD RESCINDED correction for an overturned red card", async () => {
      const { repositories, service } = createService();

      await service.processEvent({
        eventType: "red_card",
        fixtureId: 101,
        smFixtureId: 1101,
        smEventId: 99,
        minute: 45,
      });
      await service.resolveVerification("101:red_card:99", false);

      expect(repositories.liveFeedEvents.upsertFeedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_key: "101:red_card:99:overturned",
          ai_message: "CARD RESCINDED. As we were.",
        })
      );
    });
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
