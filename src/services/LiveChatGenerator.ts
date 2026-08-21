import Anthropic from "@anthropic-ai/sdk";

export type LiveChatContext = {
  groupName: string;
  eventType: "goal" | "red_card" | "halftime" | "penalty" | "minute_85";
  fixtureName: string;
  matchweek?: string | null;
  minute: number | null;
  score?: {
    home: number | null;
    away: number | null;
  };
  affectedPositive: string[];
  affectedNegative: string[];
  reason: string;
};

export interface LiveChatGenerator {
  generate(context: LiveChatContext): Promise<string>;
}

export class MockLiveChatGenerator implements LiveChatGenerator {
  async generate(context: LiveChatContext): Promise<string> {
    const minute = context.minute ? `${context.minute}' ` : "";

    if (!context.affectedPositive.length && !context.affectedNegative.length) {
      if (context.eventType === "red_card") {
        return `${minute}Red card in ${context.fixtureName}. ${context.groupName} just got spicy.`;
      }

      const score =
        context.score?.home !== null && context.score?.away !== null
          ? ` ${context.score?.home}-${context.score?.away}.`
          : ".";
      return `${minute}Goal in ${context.fixtureName}${score} ${context.groupName} leaderboard may move.`;
    }

    const winners = context.affectedPositive.slice(0, 2).join(" and ");
    const losers = context.affectedNegative.slice(0, 2).join(" and ");

    if (context.eventType === "red_card") {
      if (winners && losers) {
        return `${minute}Red card chaos. ${winners} called it, ${losers} did not enjoy that plot twist.`;
      }

      if (winners) {
        return `${minute}Red card chaos. ${winners} saw it coming and now looks annoyingly wise.`;
      }

      return `${minute}Red card chaos. ${losers} backed calm football. Bad timing.`;
    }

    if (context.eventType === "halftime") {
      return `${minute}Half-time in ${context.fixtureName}. ${context.groupName} gets a breather and the predictions get judged silently.`;
    }

    if (context.eventType === "penalty") {
      return `${minute}Penalty drama in ${context.fixtureName}. Someone's prediction is about to sweat.`;
    }

    if (context.eventType === "minute_85") {
      return `${minute}Five-ish minutes left in ${context.fixtureName}. ${context.groupName}, this is where tables wobble.`;
    }

    if (winners && losers) {
      return `${minute}Goal. ${winners} move closer, ${losers} watch a nice prediction wobble.`;
    }

    if (winners) {
      return `${minute}Goal. ${winners} suddenly look like football prophets.`;
    }

    return `${minute}Goal. ${losers} just felt that prediction take damage.`;
  }
}

const SYSTEM_PROMPT = `You write one-line live match reactions for a friends' football-prediction group chat. Tone: fun, banter-y, a bit cheeky, never cruel. Always tie the event back to whose guess just got better or worse when player names are given.

Rules:
- Output ONLY the message text. No quotes, no markdown, no preamble.
- One or two short sentences, under 180 characters total.
- Mention named players from affectedPositive/affectedNegative when present; never invent stats, names, or scorelines not present in the given context.
- If no players are affected, write a generic reaction to the event for the group.

Examples of the tone to match:
"62' Red card chaos. George called it, Alex did not enjoy that plot twist."
"70' Goal. George suddenly looks like a football prophet."
"85' Five-ish minutes left in Thór vs Víkingur Reykjavík. Geo Iceland 2, this is where tables wobble."`;

export class ClaudeLiveChatGenerator implements LiveChatGenerator {
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly fallback: LiveChatGenerator;

  constructor(options?: {
    apiKey?: string;
    model?: string;
    fallback?: LiveChatGenerator;
  }) {
    const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model =
      options?.model ??
      process.env.LIVE_CHAT_MODEL ??
      "claude-haiku-4-5-20251001";
    this.fallback = options?.fallback ?? new MockLiveChatGenerator();
    this.client = apiKey ? new Anthropic({ apiKey, timeout: 8000 }) : null;
  }

  async generate(context: LiveChatContext): Promise<string> {
    if (!this.client) {
      return this.fallback.generate(context);
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 80,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(context) }],
      });

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      const message = textBlock?.text?.trim().replace(/^"|"$/g, "");

      if (!message) {
        throw new Error("Empty response from Claude");
      }

      return message;
    } catch (error) {
      console.warn("[LiveChat] Claude generation failed, using fallback:", error);
      return this.fallback.generate(context);
    }
  }
}
