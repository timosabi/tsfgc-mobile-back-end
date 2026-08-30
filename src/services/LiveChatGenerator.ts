import Anthropic from "@anthropic-ai/sdk";

// Only exact-score and red-card outcomes are compelling enough for the live
// feed -- a merely-correct result or a closest-total-goals shift isn't. And
// for red cards specifically, only a correct guess is worth mentioning: a
// group member whose single matchweek red-card pick was for some other
// fixture isn't meaningfully "wrong" just because a card happened here.
export type PredictionChangeType =
  | "exact_gained"
  | "exact_lost"
  | "red_card_correct";

export type PredictionImpact = {
  name: string;
  change: PredictionChangeType;
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

    return `${this.goalClause(context)}!`;
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
      const key = `${impact.change}:${impact.rankDisplay ?? ""}`;
      const group = groups.get(key) ?? {
        change: impact.change,
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

    const base = (() => {
      switch (group.change) {
        case "exact_gained":
          return `${names} ${plural ? "have" : "has"} hit their exact score!`;
        case "exact_lost":
          return `${names} ${plural ? "no longer have" : "no longer has"} their exact score.`;
        case "red_card_correct":
          return `${names} ${plural ? "pick up" : "picks up"} the Red Card bonus!`;
        default:
          return "";
      }
    })();

    return base ? `${base}${this.rankClause(group)}` : "";
  }

  // group.rankDisplay is already a plain phrase ("1st", "tied for 2nd") by
  // the time it reaches here -- see LiveFeedService.formatRankDisplay.
  private rankClause(group: ImpactGroup): string {
    if (!group.rankDisplay) return "";

    const names = this.joinNames(group.names);
    const plural = group.names.length > 1;
    return ` ${names} ${plural ? "are" : "is"} now ${group.rankDisplay} for the matchweek.`;
  }

  private joinNames(names: string[]): string {
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  }
}

const SYSTEM_PROMPT = `You write live match updates for a friends' football-prediction group chat. Tone: factual, friendly, and SHORT -- one short clause for what happened, plus one short clause per compelling impact. No banter, no mockery, no "prophet"/"wobble"/"plot twist" style commentary.

Match detail fields (use when present, never invent values not present in the given context):
- "player": who scored or was red carded. Mention them by name.
- "isPenalty" / "isOwnGoal": say "penalty" or "own goal" explicitly when true.
- "impacts": an array of { name, change, rankDisplay }. "change" is "exact_gained"/"exact_lost" (their exact-score prediction just became/stopped being correct) or "red_card_correct" (their red-card pick just hit). These are deliberately the ONLY outcomes worth reporting -- a merely-correct result, a closest-total-goals shift, or a wrong red-card guess is not included in this data at all, so never invent or infer one.
- "impacts[].rankDisplay": that person's CURRENT rank in the live matchweek mini-leaderboard, already formatted in words, e.g. "1st" or "tied for 2nd". Use it exactly as given -- never output a "#" or "=" symbol. State it as their current position only, never as a "moved from/to" change (only the current rank is known here). Omit any rank mention if rankDisplay is null/absent.

Rules:
- Output ONLY the message text. No quotes, no markdown, no preamble.
- Be brief. State what happened in the match in one short clause (e.g. "Maguire scores!", "Rice sees red."), then a separate short clause per person in "impacts". Do not add a plain score-recap sentence after a goal (e.g. never a standalone "Team A 2-1 Team B." sentence) -- the fixture and score are already shown elsewhere in the app.
- Never invent stats, names, scorelines, or reactions not present in the given context.
- If "impacts" is empty, just report the match event -- nothing more.
- A "fulltime" event marks the end of ONLY that one fixture, and should still state that fixture's final score. A matchweek has many fixtures, often spread across several days -- never say or imply that the matchweek itself has ended, is complete, or is over.

Examples of the tone to match:
"56' Maguire scores! Molly has hit their exact score, now 1st for the matchweek."
"62' Red card! Rice sees red. Alex picks up the Red Card bonus!"
"70' Saka scores! Alex no longer has their exact score."
"81' Kane scores from the penalty box."
"45' Own goal from Gabriel."
"90' Full time in Chelsea vs Arsenal 2-1."`;

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
