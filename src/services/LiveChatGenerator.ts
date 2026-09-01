import Anthropic from "@anthropic-ai/sdk";

// Exact-score and red-card outcomes, plus a plain correct/incorrect RESULT
// guess (win/draw/loss, not the exact score), are the only outcomes worth
// surfacing in the live feed -- a closest-total-goals shift isn't. A
// result_gained/result_lost impact is only emitted for a person whose exact-
// score status did NOT also change on the same event (see LiveFeedService) --
// otherwise the more specific exact_gained/exact_lost already says it. For
// red cards specifically, only a correct guess is worth mentioning: a group
// member whose single matchweek red-card pick was for some other fixture
// isn't meaningfully "wrong" just because a card happened here.
export type PredictionChangeType =
  | "exact_gained"
  | "exact_lost"
  | "result_gained"
  | "result_lost"
  | "red_card_correct";

export type PredictionImpact = {
  name: string;
  change: PredictionChangeType;
  // This person's CURRENT rank in the live matchweek mini-leaderboard, e.g.
  // "#1" (outright) or "=2" (tied) -- the same rank_display shown on the
  // Matchweek Standings page. Never a raw number. Null/absent when unknown.
  rankDisplay?: string | null;
  // result_gained/result_lost only: whether THIS event's rank recalculation
  // actually moved this person in the live matchweek table ("up"/"down") or
  // left them where they were ("none") -- lets commentary distinguish "this
  // mattered" from "everyone already had this coming".
  rankMovement?: "up" | "down" | "none";
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
  // The score immediately BEFORE this event (goal events only) -- without
  // this, the model has no way to know whether a goal opened the scoring,
  // extended an existing lead, or leveled things up, and will guess.
  previousScore?: {
    home: number | null;
    away: number | null;
  } | null;
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
  rankMovement?: "up" | "down" | "none";
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
      const isResultChange =
        impact.change === "result_gained" || impact.change === "result_lost";
      // Result changes group by whether the rank move was actually meaningful
      // (up/down/none), not the exact rank value -- several people can share
      // "no meaningful change" while sitting at different ranks. Everything
      // else keeps grouping by the exact current rank, as before.
      const key = isResultChange
        ? `${impact.change}:${impact.rankMovement ?? "none"}`
        : `${impact.change}:${impact.rankDisplay ?? ""}`;
      const group = groups.get(key) ?? {
        change: impact.change,
        rankDisplay: impact.rankDisplay,
        rankMovement: impact.rankMovement,
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
        case "result_gained":
          return `${names} ${plural ? "have" : "has"} the result right.`;
        case "result_lost":
          return `${names} ${plural ? "no longer have" : "no longer has"} the result right.`;
        case "red_card_correct":
          return `${names} ${plural ? "pick up" : "picks up"} the Red Card bonus!`;
        default:
          return "";
      }
    })();

    if (!base) return "";

    const isResultChange =
      group.change === "result_gained" || group.change === "result_lost";
    return `${base}${isResultChange ? this.movementClause(group) : this.rankClause(group)}`;
  }

  // group.rankDisplay is already a plain phrase ("1st", "tied for 2nd") by
  // the time it reaches here -- see LiveFeedService.formatRankDisplay.
  private rankClause(group: ImpactGroup): string {
    if (!group.rankDisplay) return "";

    const names = this.joinNames(group.names);
    const plural = group.names.length > 1;
    return ` ${names} ${plural ? "are" : "is"} now ${group.rankDisplay} for the matchweek.`;
  }

  private movementClause(group: ImpactGroup): string {
    switch (group.rankMovement) {
      case "up":
        return " Up as it stands.";
      case "down":
        return " Down as it stands.";
      default:
        return " No meaningful change.";
    }
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
- "score" vs "previousScore": compare these before describing the goal's effect on the scoreline. Only say a team "extends"/"restores" their lead if "previousScore" already shows them ahead. If "previousScore" was level (including 0-0), say they "take the lead" or "go ahead" -- never "extend" a lead that didn't exist. If the scoring team was behind in "previousScore" and still is, say they "pull one back" or similar, not "extend" or "take the lead". If "previousScore" is null/absent, don't make any claim about the state of the lead at all.
- "impacts": an array of { name, change, rankDisplay, rankMovement }. "change" is "exact_gained"/"exact_lost" (their exact-score prediction just became/stopped being correct), "result_gained"/"result_lost" (their plain win/draw/loss result guess just became/stopped being correct -- NOT the exact score), or "red_card_correct" (their red-card pick just hit). These are deliberately the ONLY outcomes worth reporting -- a closest-total-goals shift or a wrong red-card guess is not included in this data at all, so never invent or infer one. A person only ever appears once per event: if their exact score changed, that's reported instead of a separate result_gained/result_lost for the same person.
- "impacts[].rankDisplay": (exact_gained/exact_lost/red_card_correct only) that person's CURRENT rank in the live matchweek mini-leaderboard, already formatted in words, e.g. "1st" or "tied for 2nd". Use it exactly as given -- never output a "#" or "=" symbol. State it as their current position only, never as a "moved from/to" change. Omit any rank mention if rankDisplay is null/absent.
- "impacts[].rankMovement": (result_gained/result_lost only) one of "up", "down", or "none" -- whether this specific event actually moved that person in the live matchweek table. Never state a specific rank number or position for a result_gained/result_lost person (no rankDisplay is given for them) -- just convey whether it mattered: "up" reads as something like "up as it stands" or "climbing the table"; "down" as "slipping"/"down as it stands"; "none" as "no meaningful change" / "as it stands". Keep this part short -- a few words, not a full sentence.
- When several people in "impacts" share the exact same change (and, for result_gained/result_lost, the same rankMovement), combine their names into ONE sentence rather than repeating a sentence per person -- e.g. "Molly, Sabi, Alastair and Leo have the result right -- no meaningful change." (comma-separated, "and" before the last name). Only split into separate sentences when the change or outcome genuinely differs between people.

Rules:
- Output ONLY the message text. No quotes, no markdown, no preamble.
- Be brief. State what happened in the match in one short clause (e.g. "Maguire scores!", "Rice sees red."), then a separate short clause per distinct outcome in "impacts" (combining names as above). Do not add a plain score-recap sentence after a goal (e.g. never a standalone "Team A 2-1 Team B." sentence) -- the fixture and score are already shown elsewhere in the app.
- Never invent stats, names, scorelines, or reactions not present in the given context.
- If "impacts" is empty, just report the match event -- nothing more.
- A "fulltime" event marks the end of ONLY that one fixture, and should still state that fixture's final score. A matchweek has many fixtures, often spread across several days -- never say or imply that the matchweek itself has ended, is complete, or is over.

Examples of the tone to match:
"56' Maguire scores! Molly has hit their exact score, now 1st for the matchweek."
"62' Red card! Rice sees red. Alex picks up the Red Card bonus!"
"70' Saka scores! Alex no longer has their exact score."
"59' Saka scores! Arsenal take the lead." (previousScore was 0-0 -- this is the first goal, not an extended lead)
"77' Saka scores! Arsenal extend their lead." (previousScore already had Arsenal ahead)
"59' Saka scores! Molly, Sabi, Alastair and Leo have the result right -- no meaningful change."
"73' Odegaard scores! Molly and Sabi have the result right, up as it stands."
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
