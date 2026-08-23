import LiveEventsPollerService from "../../../src/services/LiveEventsPollerService.js";

function liveFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    sm_fixture_id: 1101,
    sm_league_id: 8,
    sm_season_id: 23614,
    home_team: "Arsenal",
    away_team: "Chelsea",
    home_score: 0,
    away_score: 0,
    live_home_score: 1,
    live_away_score: 0,
    has_red_card: false,
    matchweek: "Matchweek 2",
    current_minute: 63,
    provider_payload: { state: { developer_name: "2ND_HALF" } },
    ...overrides,
  };
}

function createDeps() {
  const liveFeed = { processEvent: jest.fn().mockResolvedValue({ created: 1, rows: [] }) };
  const live = { getLiveFixtures: jest.fn() };
  const hydration = { hydrateFinishedFixtures: jest.fn().mockResolvedValue(undefined) };
  const weeklyScore = { calculateAllFinished: jest.fn().mockResolvedValue(undefined) };
  const sportMonks = { getFixtureById: jest.fn() };

  return { liveFeed, live, hydration, weeklyScore, sportMonks };
}

function createPoller(deps: ReturnType<typeof createDeps>) {
  return new LiveEventsPollerService({
    ...(deps as unknown as ConstructorParameters<typeof LiveEventsPollerService>[0]),
    leagueIds: [8, 501],
  });
}

describe("LiveEventsPollerService", () => {
  it("maps a goal event and passes the fixture's current score", async () => {
    const deps = createDeps();
    deps.live.getLiveFixtures.mockResolvedValue([liveFixture()]);
    deps.sportMonks.getFixtureById.mockResolvedValue({
      fixture: {},
      events: [
        {
          event_type: "goal",
          sm_event_id: 55,
          minute: 63,
          player_name: "Saka",
          team: "Arsenal",
        },
      ],
    });

    const poller = createPoller(deps);
    const result = await poller.poll();

    expect(result).toEqual({ liveCount: 1 });
    expect(deps.liveFeed.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "goal",
        smFixtureId: 1101,
        smEventId: 55,
        homeScore: 1,
        awayScore: 0,
        beforeHomeScore: 0,
        beforeAwayScore: 0,
      })
    );
  });

  it("replays goals in chronological order so each gets its own accurate before/after score", async () => {
    const deps = createDeps();
    // Fixture already shows the CURRENT (post-both-goals) score, same as the real
    // poller after getLiveFixtures() has patched it — this must not leak into the
    // per-goal before/after values, which should come purely from replaying events.
    deps.live.getLiveFixtures.mockResolvedValue([
      liveFixture({ live_home_score: 2, live_away_score: 0 }),
    ]);
    deps.sportMonks.getFixtureById.mockResolvedValue({
      fixture: {},
      // Deliberately out of order to prove the poller sorts by minute itself.
      events: [
        { event_type: "goal", sm_event_id: 2, minute: 23, player_name: "Saka", team: "Arsenal" },
        { event_type: "goal", sm_event_id: 1, minute: 15, player_name: "Havertz", team: "Arsenal" },
      ],
    });

    const poller = createPoller(deps);
    await poller.poll();

    const goalCalls = deps.liveFeed.processEvent.mock.calls
      .map(([input]) => input)
      .filter((input) => input.eventType === "goal")
      .sort((a, b) => a.minute - b.minute);

    expect(goalCalls).toEqual([
      expect.objectContaining({
        smEventId: 1,
        minute: 15,
        beforeHomeScore: 0,
        beforeAwayScore: 0,
        homeScore: 1,
        awayScore: 0,
      }),
      expect.objectContaining({
        smEventId: 2,
        minute: 23,
        beforeHomeScore: 1,
        beforeAwayScore: 0,
        homeScore: 2,
        awayScore: 0,
      }),
    ]);
  });

  it("credits an own goal to the opposing team", async () => {
    const deps = createDeps();
    deps.live.getLiveFixtures.mockResolvedValue([liveFixture()]);
    deps.sportMonks.getFixtureById.mockResolvedValue({
      fixture: {},
      events: [
        {
          event_type: "own_goal",
          sm_event_id: 9,
          minute: 40,
          player_name: "Unlucky Defender",
          team: "Arsenal",
        },
      ],
    });

    const poller = createPoller(deps);
    await poller.poll();

    expect(deps.liveFeed.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeHomeScore: 0,
        beforeAwayScore: 0,
        homeScore: 0,
        awayScore: 1,
      })
    );
  });

  it("flags own goals and penalties, and passes the assisting player through", async () => {
    const deps = createDeps();
    deps.live.getLiveFixtures.mockResolvedValue([liveFixture()]);
    deps.sportMonks.getFixtureById.mockResolvedValue({
      fixture: {},
      events: [
        {
          event_type: "penalty_goal",
          sm_event_id: 1,
          minute: 10,
          player_name: "Kane",
          team: "Arsenal",
          assist_player: null,
        },
        {
          event_type: "own_goal",
          sm_event_id: 2,
          minute: 20,
          player_name: "Defender",
          team: "Chelsea",
          assist_player: null,
        },
        {
          event_type: "goal",
          sm_event_id: 3,
          minute: 30,
          player_name: "Saka",
          team: "Arsenal",
          assist_player: "Odegaard",
        },
      ],
    });

    const poller = createPoller(deps);
    await poller.poll();

    const calls = deps.liveFeed.processEvent.mock.calls.map(([input]) => input);

    expect(calls).toContainEqual(
      expect.objectContaining({
        smEventId: 1,
        isPenalty: true,
        isOwnGoal: false,
        assistedBy: null,
      })
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        smEventId: 2,
        isPenalty: false,
        isOwnGoal: true,
        assistedBy: null,
      })
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        smEventId: 3,
        isPenalty: false,
        isOwnGoal: false,
        assistedBy: "Odegaard",
      })
    );
  });

  it("normalizes own_goal/penalty_goal to goal and drops unsupported event types", async () => {
    const deps = createDeps();
    deps.live.getLiveFixtures.mockResolvedValue([liveFixture()]);
    deps.sportMonks.getFixtureById.mockResolvedValue({
      fixture: {},
      events: [
        { event_type: "own_goal", sm_event_id: 1, minute: 10, player_name: "A", team: "Arsenal" },
        { event_type: "penalty_goal", sm_event_id: 2, minute: 20, player_name: "B", team: "Chelsea" },
        { event_type: "yellow_card", sm_event_id: 3, minute: 30, player_name: "C", team: "Arsenal" },
        { event_type: "substitution", sm_event_id: 4, minute: 40, player_name: "D", team: "Chelsea" },
      ],
    });

    const poller = createPoller(deps);
    await poller.poll();

    expect(deps.liveFeed.processEvent).toHaveBeenCalledTimes(2);
    expect(deps.liveFeed.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "goal", smEventId: 1 })
    );
    expect(deps.liveFeed.processEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "goal", smEventId: 2 })
    );
  });

  it("fires the minute-85 synthetic trigger once, not on every poll", async () => {
    const deps = createDeps();
    deps.live.getLiveFixtures.mockResolvedValue([liveFixture()]);
    deps.sportMonks.getFixtureById.mockResolvedValue({
      fixture: { sm_fixture_id: 1101, current_minute: 86 },
      events: [],
    });

    const poller = createPoller(deps);
    await poller.poll();
    await poller.poll();

    const minute85Calls = deps.liveFeed.processEvent.mock.calls.filter(
      ([input]) => input.eventType === "minute_85"
    );
    expect(minute85Calls).toHaveLength(1);
    expect(minute85Calls[0][0]).toEqual(
      expect.objectContaining({ smEventId: 1101 * 1000 + 902 })
    );
  });

  it("fires the halftime synthetic trigger only when provider state is HT", async () => {
    const deps = createDeps();
    deps.live.getLiveFixtures.mockResolvedValue([liveFixture()]);
    deps.sportMonks.getFixtureById.mockResolvedValue({
      fixture: {
        sm_fixture_id: 1101,
        provider_payload: { state: { developer_name: "HT" } },
      },
      events: [],
    });

    const poller = createPoller(deps);
    await poller.poll();

    const halftimeCalls = deps.liveFeed.processEvent.mock.calls.filter(
      ([input]) => input.eventType === "halftime"
    );
    expect(halftimeCalls).toHaveLength(1);
  });

  it("ignores a stale HT snapshot from the live list once fresh data says otherwise", async () => {
    const deps = createDeps();
    // patchLiveRows() never updates provider_payload, so the live-list snapshot
    // can be arbitrarily stale (e.g. still reading "HT" from an earlier tick,
    // or the last full hydration). Halftime detection must use the fresh
    // per-tick fetch, not this stale one, or it would fire forever.
    deps.live.getLiveFixtures.mockResolvedValue([
      liveFixture({ provider_payload: { state: { developer_name: "HT" } } }),
    ]);
    deps.sportMonks.getFixtureById.mockResolvedValue({
      fixture: {
        sm_fixture_id: 1101,
        provider_payload: { state: { developer_name: "2ND_HALF" } },
      },
      events: [],
    });

    const poller = createPoller(deps);
    await poller.poll();

    const halftimeCalls = deps.liveFeed.processEvent.mock.calls.filter(
      ([input]) => input.eventType === "halftime"
    );
    expect(halftimeCalls).toHaveLength(0);
  });

  it("fires the fulltime synthetic trigger when provider state reaches FT", async () => {
    const deps = createDeps();
    deps.live.getLiveFixtures.mockResolvedValue([liveFixture()]);
    deps.sportMonks.getFixtureById.mockResolvedValue({
      fixture: {
        sm_fixture_id: 1101,
        provider_payload: { state: { developer_name: "FT" } },
      },
      events: [],
    });

    const poller = createPoller(deps);
    await poller.poll();
    await poller.poll();

    const fulltimeCalls = deps.liveFeed.processEvent.mock.calls.filter(
      ([input]) => input.eventType === "fulltime"
    );
    expect(fulltimeCalls).toHaveLength(1);
    expect(fulltimeCalls[0][0]).toEqual(
      expect.objectContaining({ smEventId: 1101 * 1000 + 903 })
    );
  });

  it("fast-finalizes a fixture that drops out of the live list", async () => {
    const deps = createDeps();
    deps.sportMonks.getFixtureById.mockResolvedValue({ fixture: {}, events: [] });
    deps.live.getLiveFixtures.mockResolvedValueOnce([liveFixture()]);
    const poller = createPoller(deps);
    await poller.poll();

    expect(deps.hydration.hydrateFinishedFixtures).not.toHaveBeenCalled();

    deps.live.getLiveFixtures.mockResolvedValueOnce([]);
    await poller.poll();

    expect(deps.hydration.hydrateFinishedFixtures).toHaveBeenCalledWith(1, [8, 501]);
    expect(deps.weeklyScore.calculateAllFinished).toHaveBeenCalledTimes(1);
  });

  it("does nothing beyond the live-fixtures check when nothing is live", async () => {
    const deps = createDeps();
    deps.live.getLiveFixtures.mockResolvedValue([]);

    const poller = createPoller(deps);
    const result = await poller.poll();

    expect(result).toEqual({ liveCount: 0 });
    expect(deps.sportMonks.getFixtureById).not.toHaveBeenCalled();
    expect(deps.liveFeed.processEvent).not.toHaveBeenCalled();
  });
});
