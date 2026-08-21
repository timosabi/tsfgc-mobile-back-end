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
    affectedPositive: ["Alex"],
    affectedNegative: ["Bianca"],
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
        max_tokens: 80,
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
