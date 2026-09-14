import MatchweekPermutationService from "../../../src/services/MatchweekPermutationService.js";
import type { Repositories } from "../../../src/repositories/index.js";
import { createRepositoryMock } from "../helpers/mockRepositories.js";

function fixture(overrides: Record<string, unknown>) {
  return {
    id: 0,
    sm_fixture_id: 0,
    sm_league_id: 8,
    sm_season_id: 23614,
    matchweek: "Matchweek 4",
    status: "scheduled",
    home_team: "Home",
    away_team: "Away",
    home_score: null,
    away_score: null,
    live_home_score: null,
    live_away_score: null,
    has_red_card: false,
    starting_at: null,
    match_date: "2026-09-14",
    match_time: "15:00:00",
    ...overrides,
  };
}

const FINISHED_FIXTURE = fixture({
  id: 201,
  starting_at: "2026-09-14T12:00:00.000Z",
  status: "finished",
  home_score: 1,
  away_score: 0,
});
const TARGET_FIXTURE = fixture({
  id: 202,
  starting_at: "2026-09-14T19:00:00.000Z",
  status: "live",
});

function createService() {
  const repositories = {
    predictions: createRepositoryMock<Pick<Repositories["predictions"], "listByGroupFixturesUsers">>([
      "listByGroupFixturesUsers",
    ]),
    redCardPredictions: createRepositoryMock<
      Pick<Repositories["redCardPredictions"], "listByGroupFixturesUsers">
    >(["listByGroupFixturesUsers"]),
    userSubmissions: createRepositoryMock<
      Pick<Repositories["userSubmissions"], "listSubmittedUserIds">
    >(["listSubmittedUserIds"]),
    profiles: createRepositoryMock<Pick<Repositories["profiles"], "listDisplayNamesByIds">>([
      "listDisplayNamesByIds",
    ]),
    liveFeedEvents: createRepositoryMock<Pick<Repositories["liveFeedEvents"], "upsertFeedEvent">>([
      "upsertFeedEvent",
    ]),
  };
  const generator = { generate: jest.fn().mockResolvedValue("mock permutations message") };

  repositories.userSubmissions.listSubmittedUserIds.mockResolvedValue([
    { user_id: "user-a" },
    { user_id: "user-b" },
  ]);
  repositories.redCardPredictions.listByGroupFixturesUsers.mockResolvedValue([]);
  repositories.profiles.listDisplayNamesByIds.mockResolvedValue([
    { id: "user-a", display_name: "Alastair" },
    { id: "user-b", display_name: "Leo" },
  ]);

  const service = new MatchweekPermutationService(
    repositories as unknown as ConstructorParameters<typeof MatchweekPermutationService>[0],
    generator
  );

  return { repositories, generator, service };
}

const GROUPS = [{ id: "group-1", name: "Los Muchachos" }];

describe("MatchweekPermutationService", () => {
  it("does nothing when the fixture isn't the last-scheduled one in the matchweek", async () => {
    const { repositories, generator, service } = createService();

    await service.checkAndNotify({
      fixtureId: FINISHED_FIXTURE.id,
      allMatchweekFixtures: [FINISHED_FIXTURE, TARGET_FIXTURE] as never,
      groups: GROUPS,
    });

    expect(repositories.userSubmissions.listSubmittedUserIds).not.toHaveBeenCalled();
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it("does nothing when another fixture in the matchweek is still unfinished", async () => {
    const { repositories, generator, service } = createService();
    const stillLive = fixture({ id: 203, starting_at: "2026-09-14T14:00:00.000Z", status: "live" });

    await service.checkAndNotify({
      fixtureId: TARGET_FIXTURE.id,
      allMatchweekFixtures: [FINISHED_FIXTURE, stillLive, TARGET_FIXTURE] as never,
      groups: GROUPS,
    });

    expect(repositories.userSubmissions.listSubmittedUserIds).not.toHaveBeenCalled();
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it("skips a group with no predictions at all for the target fixture", async () => {
    const { repositories, generator, service } = createService();
    repositories.predictions.listByGroupFixturesUsers.mockResolvedValue([
      { user_id: "user-a", fixture_id: FINISHED_FIXTURE.id, home_score_prediction: 1, away_score_prediction: 0 },
    ] as never);

    await service.checkAndNotify({
      fixtureId: TARGET_FIXTURE.id,
      allMatchweekFixtures: [FINISHED_FIXTURE, TARGET_FIXTURE] as never,
      groups: GROUPS,
    });

    expect(generator.generate).not.toHaveBeenCalled();
    expect(repositories.liveFeedEvents.upsertFeedEvent).not.toHaveBeenCalled();
  });

  it("an exact guess for the last fixture can flip the outright leader via correct-result + exact-score + goal bonus combined", async () => {
    const { repositories, generator, service } = createService();
    repositories.predictions.listByGroupFixturesUsers.mockResolvedValue([
      // Finished fixture (1-0): user-a called it exactly, user-b got it wrong.
      { user_id: "user-a", fixture_id: FINISHED_FIXTURE.id, home_score_prediction: 1, away_score_prediction: 0 },
      { user_id: "user-b", fixture_id: FINISHED_FIXTURE.id, home_score_prediction: 0, away_score_prediction: 1 },
      // Target fixture: user-a predicts 0-0, user-b predicts 2-2.
      { user_id: "user-a", fixture_id: TARGET_FIXTURE.id, home_score_prediction: 0, away_score_prediction: 0 },
      { user_id: "user-b", fixture_id: TARGET_FIXTURE.id, home_score_prediction: 2, away_score_prediction: 2 },
    ] as never);

    await service.checkAndNotify({
      fixtureId: TARGET_FIXTURE.id,
      allMatchweekFixtures: [FINISHED_FIXTURE, TARGET_FIXTURE] as never,
      groups: GROUPS,
    });

    expect(generator.generate).toHaveBeenCalledTimes(1);
    const context = generator.generate.mock.calls[0][0];

    // Before the last game: user-a leads outright on correct-result/exact-score alone.
    expect(context.currentStandings.map((row: { name: string }) => row.name)).toEqual([
      "Alastair",
    ]);

    // If it lands 2-2 exactly (Leo's call): Leo's exact score (3) + the Goal
    // Bonus (their predicted total of 1+4=5 across the week exactly matches
    // the actual 1+4=5, vs. Alastair's 1+0=1) overtakes Alastair's 3 (exact
    // 1-0) + 1 (correct-result only, since 0-0 vs 2-2 are both draws).
    const exactScenario = context.scenarios.find((scenario: { outcome: string }) =>
      scenario.outcome.includes("2-2")
    );
    expect(exactScenario).toBeDefined();
    expect(exactScenario.leaders).toEqual(["Leo"]);
    expect(exactScenario.tied).toBe(false);

    expect(repositories.liveFeedEvents.upsertFeedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        friends_group_id: "group-1",
        fixture_id: TARGET_FIXTURE.id,
        event_key: `${TARGET_FIXTURE.id}:permutations`,
        event_type: "permutations",
        ai_message: "mock permutations message",
      })
    );
  });

  it("adds a red card overlay scenario when a submitted user's pick is on the target fixture", async () => {
    const { repositories, generator, service } = createService();
    repositories.predictions.listByGroupFixturesUsers.mockResolvedValue([
      { user_id: "user-a", fixture_id: FINISHED_FIXTURE.id, home_score_prediction: 1, away_score_prediction: 0 },
      { user_id: "user-b", fixture_id: FINISHED_FIXTURE.id, home_score_prediction: 0, away_score_prediction: 1 },
      { user_id: "user-a", fixture_id: TARGET_FIXTURE.id, home_score_prediction: 1, away_score_prediction: 1 },
      { user_id: "user-b", fixture_id: TARGET_FIXTURE.id, home_score_prediction: 1, away_score_prediction: 1 },
    ] as never);
    repositories.redCardPredictions.listByGroupFixturesUsers.mockResolvedValue([
      { user_id: "user-b", fixture_id: TARGET_FIXTURE.id },
    ] as never);

    await service.checkAndNotify({
      fixtureId: TARGET_FIXTURE.id,
      allMatchweekFixtures: [FINISHED_FIXTURE, TARGET_FIXTURE] as never,
      groups: GROUPS,
    });

    const context = generator.generate.mock.calls[0][0];
    const redCardScenario = context.scenarios.find((scenario: { outcome: string }) =>
      scenario.outcome.includes("red card")
    );
    expect(redCardScenario).toBeDefined();
    expect(redCardScenario.outcome).toContain("Leo");
    // Baseline (user-a leads 3 to 0) + Leo's +5 red card bonus overtakes user-a.
    expect(redCardScenario.leaders).toEqual(["Leo"]);
  });

  it("omits the red card overlay when nobody's pick is on the target fixture", async () => {
    const { repositories, generator, service } = createService();
    repositories.predictions.listByGroupFixturesUsers.mockResolvedValue([
      { user_id: "user-a", fixture_id: FINISHED_FIXTURE.id, home_score_prediction: 1, away_score_prediction: 0 },
      { user_id: "user-a", fixture_id: TARGET_FIXTURE.id, home_score_prediction: 1, away_score_prediction: 1 },
    ] as never);
    repositories.redCardPredictions.listByGroupFixturesUsers.mockResolvedValue([
      { user_id: "user-a", fixture_id: FINISHED_FIXTURE.id },
    ] as never);

    await service.checkAndNotify({
      fixtureId: TARGET_FIXTURE.id,
      allMatchweekFixtures: [FINISHED_FIXTURE, TARGET_FIXTURE] as never,
      groups: GROUPS,
    });

    const context = generator.generate.mock.calls[0][0];
    const redCardScenario = context.scenarios.find((scenario: { outcome: string }) =>
      scenario.outcome.includes("red card")
    );
    expect(redCardScenario).toBeUndefined();
  });
});
