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
  player?: string | null;
  assistedBy?: string | null;
  team?: string | null;
  isPenalty?: boolean;
  isOwnGoal?: boolean;
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
    const goalClause = this.goalClause(context);
    const cardedClause = context.player ? ` ${context.player} sees red.` : "";

    if (!context.affectedPositive.length && !context.affectedNegative.length) {
      if (context.eventType === "red_card") {
        return `${minute}Red card in ${context.fixtureName}.${cardedClause} ${context.groupName} just got spicy.`;
      }

      const score =
        context.score?.home !== null && context.score?.away !== null
          ? ` ${context.score?.home}-${context.score?.away}.`
          : ".";
      return `${minute}${goalClause} for ${context.fixtureName}${score} ${context.groupName} leaderboard may move.`;
    }

    const winners = context.affectedPositive.slice(0, 2).join(" and ");
    const losers = context.affectedNegative.slice(0, 2).join(" and ");

    if (context.eventType === "red_card") {
      if (winners && losers) {
        return `${minute}Red card chaos.${cardedClause} ${winners} called it, ${losers} did not enjoy that plot twist.`;
      }

      if (winners) {
        return `${minute}Red card chaos.${cardedClause} ${winners} saw it coming and now looks annoyingly wise.`;
      }

      return `${minute}Red card chaos.${cardedClause} ${losers} backed calm football. Bad timing.`;
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
      return `${minute}${goalClause}. ${winners} move closer, ${losers} watch a nice prediction wobble.`;
    }

    if (winners) {
      return `${minute}${goalClause}. ${winners} suddenly look like football prophets.`;
    }

    return `${minute}${goalClause}. ${losers} just felt that prediction take damage.`;
  }

  private goalClause(context: LiveChatContext): string {
    if (!context.player) return "Goal";
    if (context.isOwnGoal) return `${context.player} turns it into his own net`;
    if (context.isPenalty) return `${context.player} slots the penalty`;
    if (context.assistedBy) return `${context.player} scores (assist: ${context.assistedBy})`;
    return `${context.player} scores`;
  }
}

const SYSTEM_PROMPT = `You write one-line live match reactions for a friends' football-prediction group chat. Tone: fun, banter-y, a bit cheeky, never cruel. Always tie the event back to whose guess just got better or worse when player names are given.

Match detail fields (use when present, never invent values not present in the given context):
- "player": who scored or was carded. Mention them by name.
- "assistedBy": who set up the goal. Mention it only when it adds color, not every time.
- "isPenalty" / "isOwnGoal": say "penalty" or "own goal" explicitly when true — these change the story (an own goal is bad luck for the scoring team, not skill).
- "team": which side the event belongs to, for context if the fixture name alone is ambiguous.

Rules:
- Output ONLY the message text. No quotes, no markdown, no preamble.
- One or two short sentences, under 180 characters total.
- Mention named players from "player"/affectedPositive/affectedNegative when present; never invent stats, names, or scorelines not present in the given context.
- If no players are affected, write a generic reaction to the event for the group, still naming the scorer if "player" is present.

Examples of the tone to match:
"62' Red card chaos. George called it, Alex did not enjoy that plot twist."
"70' Saka scores! George suddenly looks like a football prophet."
"81' Penalty converted by Kane, assisted by nobody but his own nerve. Alex's exact-score guess just died."
"45' Own goal from Gabriel — brutal way to go 1-0 down. Someone's defence prediction just aged badly."
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
