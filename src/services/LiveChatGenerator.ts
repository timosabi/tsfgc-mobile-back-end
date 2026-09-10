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
  eventType:
    | "kickoff"
    | "goal"
    | "red_card"
    | "halftime"
    | "penalty"
    | "minute_85"
    | "fulltime";
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
  // this, there's no way to know whether a goal opened the scoring, extended
  // an existing lead, or leveled things up.
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

// Mirrors WeeklyScoreService's fixed red-card bonus (+5 points). Kept as a
// literal here rather than imported, consistent with this codebase's existing
// tolerance for small cross-service constant duplication (see
// weekNumberFromMatchweek, independently duplicated in WeeklyScoreService,
// MatchweekOverviewService, and PlayerStatsService).
export const RED_CARD_BONUS_POINTS = 5;

// --- Deterministic "what happened" messages -------------------------------
//
// Score Updates, kickoff/half-time/full-time markers, and VAR-overturn
// corrections are all purely factual -- nothing here depends on any
// particular group's predictions, so every group watching a fixture gets the
// identical text. No AI call is needed or wanted for these: they're short,
// mechanical, and need to appear the instant the event is detected (the
// Impact message below is the one that waits and varies).

function playerClause(context: Pick<LiveChatContext, "player" | "isOwnGoal" | "isPenalty" | "assistedBy">): string {
  if (!context.player) return "GOAL!";
  if (context.isOwnGoal) return `GOAL! ${context.player} turns it into his own net!`;
  if (context.isPenalty) return `GOAL! ${context.player} slots the penalty!`;
  if (context.assistedBy) return `GOAL! ${context.player} scores (assist: ${context.assistedBy})!`;
  return `GOAL! ${context.player} scores!`;
}

// Compares before/after scores to describe the goal's effect on the
// scoreline, mirroring the rule the AI prompt used to apply itself: breaking
// a tie is "take the lead", extending an existing lead is "extend their
// lead", the team that was behind scoring but still trailing is "pull one
// back", and a goal that creates a new tie is "level things up". Returns null
// when there isn't enough score data to say anything (e.g. a scoreless-goal
// edge case), in which case the caller omits the clause entirely rather than
// guessing.
function leadDescriptionClause(params: {
  scoringTeamName: string;
  prevHome: number;
  prevAway: number;
  home: number;
  away: number;
  scoringTeamIsHome: boolean;
}): string | null {
  const wasLevel = params.prevHome === params.prevAway;
  const isLevel = params.home === params.away;
  const scoringTeamWasAhead = params.scoringTeamIsHome
    ? params.prevHome > params.prevAway
    : params.prevAway > params.prevHome;

  if (wasLevel) return `${params.scoringTeamName} take the lead`;
  if (isLevel) return `${params.scoringTeamName} level things up`;
  if (scoringTeamWasAhead) return `${params.scoringTeamName} extend their lead`;
  return `${params.scoringTeamName} pull one back`;
}

function buildGoalFactualMessage(context: LiveChatContext): string {
  const minute = context.minute ? `${context.minute}' ` : "";
  const clause = playerClause(context).replace(/^GOAL! /, `GOAL! ${minute}`);

  const scoringTeamName = context.team ?? null;
  const scoringTeamIsHome = scoringTeamName != null && scoringTeamName === context.homeTeam;
  const hasScoreData =
    scoringTeamName != null &&
    context.previousScore?.home != null &&
    context.previousScore?.away != null &&
    context.score?.home != null &&
    context.score?.away != null;

  const lead = hasScoreData
    ? leadDescriptionClause({
        scoringTeamName: scoringTeamName as string,
        prevHome: context.previousScore!.home as number,
        prevAway: context.previousScore!.away as number,
        home: context.score!.home as number,
        away: context.score!.away as number,
        scoringTeamIsHome,
      })
    : null;

  return lead ? `${clause} ${lead}.` : clause;
}

function buildRedCardFactualMessage(context: LiveChatContext): string {
  const minute = context.minute ? `${context.minute}' ` : "";
  const player = context.player ? ` ${context.player} sees red!` : "";
  return `RED CARD! ${minute}${player}`.replace(/\s+/g, " ").trim();
}

function scoreLine(context: LiveChatContext): string {
  if (context.score?.home == null || context.score?.away == null) return "";
  return ` ${context.homeTeam ?? "Home"} ${context.score.home} ${context.awayTeam ?? "Away"} ${context.score.away}`;
}

export function buildFactualMessage(context: LiveChatContext): string {
  switch (context.eventType) {
    case "kickoff":
      return `KICK OFF. ${context.homeTeam ?? "Home"} v ${context.awayTeam ?? "Away"}`;
    case "goal":
      return buildGoalFactualMessage(context);
    case "red_card":
      return buildRedCardFactualMessage(context);
    case "halftime":
      return `HALF TIME.${scoreLine(context)}`.trim();
    case "minute_85":
      return `Five minutes left in ${context.fixtureName}.`;
    case "fulltime":
      return `FULL TIME.${scoreLine(context)}`.trim();
    default:
      return context.fixtureName;
  }
}

// A VAR overturn is the one thing the live poller can detect after the fact
// (the fixture's score/card state reverting) with no forward warning -- this
// is the correction message written instead of an Impact message when that
// happens during the verification window.
export function buildOverturnedMessage(eventType: "goal" | "red_card"): string {
  if (eventType === "red_card") return "CARD RESCINDED. As we were.";
  return "NO GOAL. As we were. Calm down.";
}

// --- Impact message priority rule ------------------------------------------
//
// Applied BEFORE anything reaches the AI generator (or its fallback): an
// exact-score hit is always the headline and suppresses every plain
// correct-result mention in the same batch, to keep the message short. If
// nobody hit the exact score, correct-result mentions are shown instead.
// _lost changes are never surfaced (keeps the feed upbeat/short, per the
// examples given). red_card_correct entries pass straight through -- a red
// card event's impacts are never mixed with goal-outcome types.
export function filterImpactsForMessage(impacts: PredictionImpact[]): PredictionImpact[] {
  const exactGained = impacts.filter((impact) => impact.change === "exact_gained");
  if (exactGained.length) return exactGained;

  const resultGained = impacts.filter((impact) => impact.change === "result_gained");
  if (resultGained.length) return resultGained;

  return impacts.filter((impact) => impact.change === "red_card_correct");
}

type ImpactGroup = {
  change: PredictionChangeType;
  rankDisplay?: string | null;
  rankMovement?: "up" | "down" | "none";
  names: string[];
};

// The Impact message: who a goal/red card just mattered for, and how. Kept
// AI-generated (Claude, with this deterministic template as its fallback)
// specifically so the phrasing can vary and grow richer over time -- unlike
// the factual messages above, there's no "correct" fixed wording for this
// one. Callers apply filterImpactsForMessage first and skip calling this
// entirely when the result is empty (nothing meaningful happened).
export class MockLiveChatGenerator implements LiveChatGenerator {
  async generate(context: LiveChatContext): Promise<string> {
    return this.impactSentences(context.impacts).join(" ").trim();
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
          return `${names} ${plural ? "have" : "has"} their red! ${RED_CARD_BONUS_POINTS} points.`;
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
    if (group.change === "red_card_correct") return "";

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

const IMPACT_SYSTEM_PROMPT = `You write ONE short, standalone update for a friends' football-prediction group chat, reporting how a goal or red card that JUST happened changed the group's standings. Someone else already told the group what happened in the match itself (the goal, the card) -- your job is ONLY the impact on people's predictions, never a restatement of the match event.

Tone: factual, friendly, and SHORT -- a single short sentence or two, no banter, no mockery, no "prophet"/"wobble"/"plot twist" style commentary.

The "impacts" field is an array of { name, change, rankDisplay, rankMovement }, already filtered to the ONE thing worth reporting:
- If it contains "exact_gained" entries, that's the entire story -- everyone listed just hit the exact score. Report only that.
- Otherwise, if it contains "result_gained" entries, everyone listed just got the plain win/draw/loss result right (not the exact score).
- Otherwise it contains "red_card_correct" entries -- everyone listed just had their red-card pick confirmed correct.
- "rankDisplay" (exact_gained/red_card_correct only): that person's CURRENT rank in the live matchweek mini-leaderboard, already formatted in words, e.g. "1st" or "tied for 2nd". State it as their current position only, never as a "moved from/to" change. Omit if null/absent. Never output a "#" or "=" symbol.
- "rankMovement" (result_gained only): one of "up", "down", or "none" -- whether this specific event actually moved that person in the live matchweek table. Never state a specific rank number for a result_gained person. Keep this part short: "up as it stands" / "slipping" / "no meaningful change".
- When several people share the exact same change (and, for result_gained, the same rankMovement), combine their names into ONE sentence -- e.g. "Molly, Sabi, Alastair and Leo have the result right -- no meaningful change." Only split into separate sentences when the outcome genuinely differs between people.
- For red_card_correct, mention the fixed +${RED_CARD_BONUS_POINTS}-point bonus each of them just earned.

Rules:
- Output ONLY the message text. No quotes, no markdown, no preamble.
- Never restate the match event itself (no "Maguire scores" style clause) -- that's already been shown separately.
- Never invent stats, names, or outcomes not present in "impacts".
- "impacts" will never be empty when you're called -- if it somehow is, output nothing.

Examples of the tone to match:
"Molly has hit their exact score, now 1st for the matchweek."
"Alex picks up the Red Card bonus -- ${RED_CARD_BONUS_POINTS} points!"
"Molly, Sabi, Alastair and Leo have the result right -- no meaningful change."
"Molly and Sabi have the result right, up as it stands."`;

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
        max_tokens: 120,
        system: IMPACT_SYSTEM_PROMPT,
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
