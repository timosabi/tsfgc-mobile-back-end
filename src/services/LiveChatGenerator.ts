import Anthropic from "@anthropic-ai/sdk";

export type PredictionChangeType =
  | "exact_gained"
  | "exact_lost"
  | "result_gained"
  | "result_lost"
  | "total_gained"
  | "total_lost"
  | "red_card_correct"
  | "red_card_wrong";

export type PredictionImpact = {
  name: string;
  change: PredictionChangeType;
  predictedHome?: number | null;
  predictedAway?: number | null;
  // This person's CURRENT rank in the live matchweek mini-leaderboard, e.g.
  // "#1" (outright) or "=2" (tied) -- the same rank_display shown on the
  // Matchweek Standings page. Never a raw number. Null/absent when unknown.
  rankDisplay?: string | null;
};

export type LiveChatContext = {
  groupName: string;
  eventType: "goal" | "red_card" | "halftime" | "penalty" | "minute_85" | "fulltime";
  fixtureName: string;
  homeTeam?: string | null;
  awayTeam?: string | null;
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
  impacts: PredictionImpact[];
  reason: string;
};

export interface LiveChatGenerator {
  generate(context: LiveChatContext): Promise<string>;
}

type ImpactGroup = {
  change: PredictionChangeType;
  predictedHome?: number | null;
  predictedAway?: number | null;
  rankDisplay?: string | null;
  names: string[];
};

export class MockLiveChatGenerator implements LiveChatGenerator {
  async generate(context: LiveChatContext): Promise<string> {
    const minute = context.minute ? `${context.minute}' ` : "";
    const lead = this.leadClause(context);
    const impactText = this.impactSentences(context.impacts).join(" ");

    return `${minute}${lead}${impactText ? ` ${impactText}` : ""}`;
  }

  private leadClause(context: LiveChatContext): string {
    if (context.eventType === "red_card") {
      const cardedClause = context.player ? ` ${context.player} sees red.` : "";
      return `Red card in ${context.fixtureName}.${cardedClause}`;
    }

    if (context.eventType === "halftime") {
      return `Half-time in ${context.fixtureName}.`;
    }

    if (context.eventType === "fulltime") {
      const score = this.scoreSuffix(context);
      return `Full time in ${context.fixtureName}${score}`;
    }

    if (context.eventType === "penalty") {
      return `Penalty awarded in ${context.fixtureName}.`;
    }

    if (context.eventType === "minute_85") {
      return `Five minutes left in ${context.fixtureName}.`;
    }

    const score = this.scoreSuffix(context);
    return `${this.goalClause(context)} for ${context.fixtureName}${score}`;
  }

  private scoreSuffix(context: LiveChatContext): string {
    return context.score?.home !== null && context.score?.away !== null
      ? ` ${context.score?.home}-${context.score?.away}.`
      : ".";
  }

  private goalClause(context: LiveChatContext): string {
    if (!context.player) return "Goal";
    if (context.isOwnGoal) return `${context.player} turns it into his own net`;
    if (context.isPenalty) return `${context.player} slots the penalty`;
    if (context.assistedBy) return `${context.player} scores (assist: ${context.assistedBy})`;
    return `${context.player} scores`;
  }

  private impactSentences(impacts: PredictionImpact[]): string[] {
    const groups = new Map<string, ImpactGroup>();

    for (const impact of impacts) {
      const key = `${impact.change}:${impact.predictedHome ?? ""}:${impact.predictedAway ?? ""}:${impact.rankDisplay ?? ""}`;
      const group = groups.get(key) ?? {
        change: impact.change,
        predictedHome: impact.predictedHome,
        predictedAway: impact.predictedAway,
        rankDisplay: impact.rankDisplay,
        names: [],
      };
      group.names.push(impact.name);
      groups.set(key, group);
    }

    return Array.from(groups.values()).map((group) => this.impactSentence(group));
  }

  private impactSentence(group: ImpactGroup): string {
    const names = this.joinNames(group.names);
    const plural = group.names.length > 1;
    const score = `${group.predictedHome}-${group.predictedAway}`;
    const total = (group.predictedHome ?? 0) + (group.predictedAway ?? 0);

    const base = (() => {
      switch (group.change) {
        case "exact_gained":
          return `${names} ${plural ? "now have" : "now has"} the exact score with ${score}.`;
        case "exact_lost":
          return `${names} ${plural ? "no longer have" : "no longer has"} the exact score (predicted ${score}).`;
        case "result_gained":
          return `${names} ${plural ? "have" : "has"} the correct result with a ${score} prediction.`;
        case "result_lost":
          return `${names} ${plural ? "no longer have" : "no longer has"} the correct result (predicted ${score}).`;
        case "total_gained":
          return `${names} ${plural ? "are" : "is"} now closest on total goals with ${total}.`;
        case "total_lost":
          return `${names} ${plural ? "are" : "is"} no longer closest on total goals.`;
        case "red_card_correct":
          return `${names} correctly called a red card.`;
        case "red_card_wrong":
          return `${names} incorrectly predicted a red card.`;
        default:
          return "";
      }
    })();

    return base ? `${base}${this.rankClause(group)}` : "";
  }

  private rankClause(group: ImpactGroup): string {
    if (!group.rankDisplay) return "";

    const tied = group.rankDisplay.startsWith("=");
    const rankNumber = Number(group.rankDisplay.slice(1));
    if (!Number.isFinite(rankNumber)) return "";

    const names = this.joinNames(group.names);
    const ordinal = this.ordinal(rankNumber);
    return tied
      ? ` This ties ${names} for ${ordinal} for the matchweek.`
      : ` This puts ${names} in ${ordinal} for the matchweek.`;
  }

  private ordinal(n: number): string {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    switch (n % 10) {
      case 1:
        return `${n}st`;
      case 2:
        return `${n}nd`;
      case 3:
        return `${n}rd`;
      default:
        return `${n}th`;
    }
  }

  private joinNames(names: string[]): string {
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  }
}

const SYSTEM_PROMPT = `You write live match updates for a friends' football-prediction group chat. Tone: factual and informative, not jokes or banter. The purpose is to tell the group exactly how this event affects their predictions and in relation to their matchweek position.

Match detail fields (use when present, never invent values not present in the given context):
- "player": who scored or was red carded. Mention them by name.
- "isPenalty" / "isOwnGoal": say "penalty" or "own goal" explicitly when true.
- "impacts": an array of { name, change, predictedHome, predictedAway, rankDisplay } describing exactly who was affected and how. "change" is one of: exact_gained, exact_lost, result_gained, result_lost, total_gained, total_lost, red_card_correct, red_card_wrong. Group people with the identical change (and identical predicted score, where relevant) into one factual sentence instead of naming them separately.
- "impacts[].rankDisplay": that person's CURRENT rank in the live matchweek mini-leaderboard, e.g. "#1" (outright) or "=2" (tied). State it as their current position only -- never invent or imply a "moved from/to" change, since only the current rank is known here. Omit any rank mention if rankDisplay is null/absent.

Rules:
- Output ONLY the message text. No quotes, no markdown, no preamble.
- Start with what happened in the match (the goal/card/milestone), then state the prediction impact as separate factual sentence(s) built directly from "impacts".
- Never invent stats, names, scorelines, or reactions not present in the given context.
- If "impacts" is empty, just report the match event -- no impact sentence.
- No banter, no mockery, no "prophet"/"wobble"/"plot twist" style commentary -- state facts plainly but be friendly.

Examples of the tone to match:
"Half Time, So far so good for George and Molly"
"62' Red card! Rice sees red. Alex gets it right!"
"70' Saka scores!. Exact score for Alex, putting him in 1st for the matchweek."
"81' Kane scores from the penalty box. Alex and Bianca's correct result guesses are no good. (predicted 1-1)."
"45' Own goal! Gabriel. Molly now closest on total goals with 1. She's 3rd for the matchweek."
"90' Full time in Chelsea vs Arsenal. George has the exact score with 2-1."`;

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
        max_tokens: 160,
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
