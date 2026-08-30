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
  type LiveChatContext,
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
      { name: "Alex", change: "exact_gained", predictedHome: 1, predictedAway: 0, rankDisplay: "#1" },
      { name: "Bianca", change: "exact_lost", predictedHome: 0, predictedAway: 0, rankDisplay: null },
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
      content: [{ type: "text", text: '  "27\' Goal. Alex looks like a genius."  ' }],
    });
    const generator = new ClaudeLiveChatGenerator({ apiKey: "test-key" });

    const result = await generator.generate(context());

    expect(result).toBe("27' Goal. Alex looks like a genius.");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 160,
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

describe("MockLiveChatGenerator", () => {
  it("names the scorer when player is present", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [],
      player: "Saka",
    });

    expect(message).toContain("Saka scores");
  });

  it("calls out a penalty explicitly", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      player: "Kane",
      isPenalty: true,
    });

    expect(message).toContain("Kane slots the penalty");
  });

  it("calls out an own goal explicitly", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      player: "Gabriel",
      isOwnGoal: true,
    });

    expect(message).toContain("Gabriel turns it into his own net");
  });

  it("mentions the assist when present on a normal goal", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [],
      player: "Saka",
      assistedBy: "Odegaard",
    });

    expect(message).toContain("Saka scores (assist: Odegaard)");
  });

  it("falls back to a generic goal message when no player is given", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [],
      player: null,
    });

    expect(message).toContain("Goal for Arsenal vs Chelsea");
  });

  it("mentions who was carded on a red card", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      eventType: "red_card",
      impacts: [],
      player: "Rice",
    });

    expect(message).toContain("Rice sees red");
  });

  it("mentions an outright matchweek rank", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [
        { name: "Alex", change: "exact_gained", predictedHome: 1, predictedAway: 0, rankDisplay: "#1" },
      ],
    });

    expect(message).toContain("This puts Alex in 1st for the matchweek.");
  });

  it("mentions a tied matchweek rank", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [
        { name: "Alex", change: "exact_gained", predictedHome: 1, predictedAway: 0, rankDisplay: "=2" },
      ],
    });

    expect(message).toContain("This ties Alex for 2nd for the matchweek.");
  });

  it("splits people with the same outcome into separate sentences when their rank differs", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [
        { name: "Alex", change: "exact_gained", predictedHome: 1, predictedAway: 0, rankDisplay: "#1" },
        { name: "Bianca", change: "exact_gained", predictedHome: 1, predictedAway: 0, rankDisplay: "#3" },
      ],
    });

    expect(message).toContain("This puts Alex in 1st for the matchweek.");
    expect(message).toContain("This puts Bianca in 3rd for the matchweek.");
    expect(message).not.toContain("Alex and Bianca");
  });

  it("still merges people with the same outcome when their rank is identical (a genuine tie)", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [
        { name: "Alex", change: "exact_gained", predictedHome: 1, predictedAway: 0, rankDisplay: "=1" },
        { name: "Bianca", change: "exact_gained", predictedHome: 1, predictedAway: 0, rankDisplay: "=1" },
      ],
    });

    expect(message).toContain("Alex and Bianca");
    expect(message).toContain("This ties Alex and Bianca for 1st for the matchweek.");
  });

  it("omits any rank clause when rankDisplay is null", async () => {
    const message = await new MockLiveChatGenerator().generate({
      ...context(),
      impacts: [
        { name: "Alex", change: "exact_gained", predictedHome: 1, predictedAway: 0, rankDisplay: null },
      ],
    });

    expect(message).not.toContain("matchweek");
  });
});
