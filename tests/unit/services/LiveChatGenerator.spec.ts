const createMock = jest.fn();

jest.mock("@anthropic-ai/sdk", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: createMock },
    })),
  };
});

import {
  ClaudeLiveChatGenerator,
  MockLiveChatGenerator,
  buildFactualMessage,
  buildOverturnedMessage,
  filterImpactsForMessage,
  type LiveChatContext,
  type PredictionImpact,
} from "../../../src/services/LiveChatGenerator.js";

function context(): LiveChatContext {
  return {
    groupName: "Los Muchachos",
    eventType: "goal",
    fixtureName: "Arsenal vs Chelsea",
    matchweek: "Matchweek 2",
    minute: 27,
    score: { home: 1, away: 0 },
    impacts: [
      { name: "Alex", change: "exact_gained", rankDisplay: "1st" },
      { name: "Bianca", change: "exact_lost", rankDisplay: null },
    ],
    reason: "score_prediction_changed",
  };
}

describe("ClaudeLiveChatGenerator", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("falls back to the mock generator when no API key is configured", async () => {
    const fallback = new MockLiveChatGenerator();
    const generator = new ClaudeLiveChatGenerator({ apiKey: undefined, fallback });

    const result = await generator.generate(context());

    expect(result).toEqual(await fallback.generate(context()));
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns Claude's message, trimmed and unquoted", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: '  "Molly has hit their exact score, now 1st."  ' }],
    });
    const generator = new ClaudeLiveChatGenerator({ apiKey: "test-key" });

    const result = await generator.generate(context());

    expect(result).toBe("Molly has hit their exact score, now 1st.");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 120,
        messages: [{ role: "user", content: JSON.stringify(context()) }],
      })
    );
  });

  it("falls back to the mock generator when the Claude call fails", async () => {
    createMock.mockRejectedValue(new Error("rate limited"));
    const fallback = new MockLiveChatGenerator();
    const generator = new ClaudeLiveChatGenerator({ apiKey: "test-key", fallback });

    const result = await generator.generate(context());

    expect(result).toEqual(await fallback.generate(context()));
  });

  it("falls back when Claude returns an empty response", async () => {
    createMock.mockResolvedValue({ content: [] });
    const fallback = new MockLiveChatGenerator();
    const generator = new ClaudeLiveChatGenerator({ apiKey: "test-key", fallback });

    const result = await generator.generate(context());

    expect(result).toEqual(await fallback.generate(context()));
  });
});

describe("buildFactualMessage", () => {
  it("announces kick off", () => {
    const message = buildFactualMessage({
      ...context(),
      eventType: "kickoff",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
    });

    expect(message).toBe("KICK OFF. Arsenal v Chelsea");
  });

  it("names the scorer when player is present", () => {
    const message = buildFactualMessage({ ...context(), player: "Saka" });

    expect(message).toContain("GOAL!");
    expect(message).toContain("Saka scores");
  });

  it("calls out a penalty explicitly", () => {
    const message = buildFactualMessage({ ...context(), player: "Kane", isPenalty: true });

    expect(message).toContain("Kane slots the penalty");
  });

  it("calls out an own goal explicitly", () => {
    const message = buildFactualMessage({ ...context(), player: "Gabriel", isOwnGoal: true });

    expect(message).toContain("Gabriel turns it into his own net");
  });

  it("mentions the assist when present on a normal goal", () => {
    const message = buildFactualMessage({
      ...context(),
      player: "Saka",
      assistedBy: "Odegaard",
    });

    expect(message).toContain("Saka scores (assist: Odegaard)");
  });

  it("falls back to a generic goal message when no player is given", () => {
    const message = buildFactualMessage({ ...context(), player: null });

    expect(message).toBe("GOAL!");
  });

  it("says a team takes the lead when the score was level beforehand", () => {
    const message = buildFactualMessage({
      ...context(),
      player: "Rogers",
      team: "Chelsea",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      previousScore: { home: 0, away: 0 },
      score: { home: 0, away: 1 },
    });

    expect(message).toContain("Chelsea take the lead.");
  });

  it("says a team levels things up when the goal creates a new tie", () => {
    const message = buildFactualMessage({
      ...context(),
      player: "Calafiori",
      team: "Arsenal",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      previousScore: { home: 0, away: 1 },
      score: { home: 1, away: 1 },
    });

    expect(message).toContain("Arsenal level things up.");
  });

  it("says a team extends their lead when they were already ahead", () => {
    const message = buildFactualMessage({
      ...context(),
      player: "Saka",
      team: "Arsenal",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      previousScore: { home: 1, away: 0 },
      score: { home: 2, away: 0 },
    });

    expect(message).toContain("Arsenal extend their lead.");
  });

  it("says a team pulls one back when they score but are still behind", () => {
    const message = buildFactualMessage({
      ...context(),
      player: "Jesus",
      team: "Arsenal",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      previousScore: { home: 0, away: 2 },
      score: { home: 1, away: 2 },
    });

    expect(message).toContain("Arsenal pull one back.");
  });

  it("omits the lead clause when there isn't enough score data", () => {
    const message = buildFactualMessage({
      ...context(),
      player: "Saka",
      team: "Arsenal",
      previousScore: undefined,
      score: undefined,
    });

    expect(message).toBe("GOAL! 27' Saka scores!");
  });

  it("mentions who was carded on a red card", () => {
    const message = buildFactualMessage({ ...context(), eventType: "red_card", player: "Rice" });

    expect(message).toContain("RED CARD!");
    expect(message).toContain("Rice sees red");
  });

  it("reports half time with the current score", () => {
    const message = buildFactualMessage({
      ...context(),
      eventType: "halftime",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      score: { home: 1, away: 0 },
    });

    expect(message).toBe("HALF TIME. Arsenal 1 Chelsea 0");
  });

  it("reports full time with the final score", () => {
    const message = buildFactualMessage({
      ...context(),
      eventType: "fulltime",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      score: { home: 1, away: 1 },
    });

    expect(message).toBe("FULL TIME. Arsenal 1 Chelsea 1");
  });
});

describe("buildOverturnedMessage", () => {
  it("reports a disallowed goal", () => {
    expect(buildOverturnedMessage("goal")).toBe("NO GOAL. As we were. Calm down.");
  });

  it("reports a rescinded red card", () => {
    expect(buildOverturnedMessage("red_card")).toBe("CARD RESCINDED. As we were.");
  });
});

describe("filterImpactsForMessage", () => {
  it("keeps only exact_gained entries when any are present, dropping result_gained", () => {
    const impacts: PredictionImpact[] = [
      { name: "Molly", change: "exact_gained", rankDisplay: "1st" },
      { name: "Tim", change: "result_gained", rankMovement: "none" },
    ];

    expect(filterImpactsForMessage(impacts)).toEqual([
      { name: "Molly", change: "exact_gained", rankDisplay: "1st" },
    ]);
  });

  it("falls back to result_gained entries when there is no exact_gained", () => {
    const impacts: PredictionImpact[] = [
      { name: "Molly", change: "result_gained", rankMovement: "up" },
      { name: "Tim", change: "result_gained", rankMovement: "up" },
    ];

    expect(filterImpactsForMessage(impacts)).toEqual(impacts);
  });

  it("returns an empty list when only _lost changes are present", () => {
    const impacts: PredictionImpact[] = [
      { name: "Molly", change: "exact_lost", rankDisplay: null },
      { name: "Tim", change: "result_lost", rankMovement: "down" },
    ];

    expect(filterImpactsForMessage(impacts)).toEqual([]);
  });

  it("passes red_card_correct entries through unfiltered", () => {
    const impacts: PredictionImpact[] = [
      { name: "Molly", change: "red_card_correct", rankDisplay: "2nd" },
    ];

    expect(filterImpactsForMessage(impacts)).toEqual(impacts);
  });

  it("returns an empty list for an empty input", () => {
    expect(filterImpactsForMessage([])).toEqual([]);
  });
});

describe("MockLiveChatGenerator", () => {
  it("mentions an exact-score gain and loss without any score numbers", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [
        { name: "Alex", change: "exact_gained", rankDisplay: null },
        { name: "Bianca", change: "exact_lost", rankDisplay: null },
      ],
    });

    expect(message).toContain("Alex has hit their exact score!");
    expect(message).toContain("Bianca no longer has their exact score.");
  });

  it("mentions the Red Card bonus points being picked up", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      eventType: "red_card",
      impacts: [{ name: "Alex", change: "red_card_correct", rankDisplay: null }],
    });

    expect(message).toContain("Alex has their red! 5 points.");
  });

  it("mentions an outright matchweek rank", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [{ name: "Alex", change: "exact_gained", rankDisplay: "1st" }],
    });

    expect(message).toContain("Alex is now 1st for the matchweek.");
  });

  it("mentions a tied matchweek rank", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [{ name: "Alex", change: "exact_gained", rankDisplay: "tied for 2nd" }],
    });

    expect(message).toContain("Alex is now tied for 2nd for the matchweek.");
  });

  it("splits people with the same outcome into separate sentences when their rank differs", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [
        { name: "Alex", change: "exact_gained", rankDisplay: "1st" },
        { name: "Bianca", change: "exact_gained", rankDisplay: "3rd" },
      ],
    });

    expect(message).toContain("Alex is now 1st for the matchweek.");
    expect(message).toContain("Bianca is now 3rd for the matchweek.");
    expect(message).not.toContain("Alex and Bianca");
  });

  it("still merges people with the same outcome when their rank is identical (a genuine tie)", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [
        { name: "Alex", change: "exact_gained", rankDisplay: "tied for 1st" },
        { name: "Bianca", change: "exact_gained", rankDisplay: "tied for 1st" },
      ],
    });

    expect(message).toContain("Alex and Bianca");
    expect(message).toContain("Alex and Bianca are now tied for 1st for the matchweek.");
  });

  it("omits any rank clause when rankDisplay is null", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [{ name: "Alex", change: "exact_gained", rankDisplay: null }],
    });

    expect(message).not.toContain("matchweek");
  });

  it("combines several people's names into one sentence when they all gained the result with no meaningful rank change", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [
        { name: "Molly", change: "result_gained", rankMovement: "none" },
        { name: "Sabi", change: "result_gained", rankMovement: "none" },
        { name: "Alastair", change: "result_gained", rankMovement: "none" },
        { name: "Leo", change: "result_gained", rankMovement: "none" },
      ],
    });

    expect(message).toContain("Molly, Sabi, Alastair, and Leo have the result right.");
    expect(message).toContain("No meaningful change.");
  });

  it("combines exactly two people's names with 'and', no comma", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [
        { name: "Molly", change: "result_gained", rankMovement: "up" },
        { name: "Sabi", change: "result_gained", rankMovement: "up" },
      ],
    });

    expect(message).toContain("Molly and Sabi have the result right.");
    expect(message).toContain("Up as it stands.");
  });

  it("splits people who gained the result into separate sentences when the rank movement differs", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [
        { name: "Molly", change: "result_gained", rankMovement: "up" },
        { name: "Sabi", change: "result_gained", rankMovement: "none" },
      ],
    });

    expect(message).not.toContain("Molly and Sabi");
    expect(message).toContain("Molly has the result right. Up as it stands.");
    expect(message).toContain("Sabi has the result right. No meaningful change.");
  });

  it("reports a lost result with a 'down' movement distinctly from 'none'", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [{ name: "Alex", change: "result_lost", rankMovement: "down" }],
    });

    expect(message).toContain("Alex no longer has the result right.");
    expect(message).toContain("Down as it stands.");
  });

  it("never mixes a numeric rank into a result_gained/result_lost sentence", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [{ name: "Alex", change: "result_gained", rankMovement: "up", rankDisplay: "1st" }],
    });

    expect(message).not.toContain("1st");
    expect(message).not.toContain("matchweek");
  });
});
