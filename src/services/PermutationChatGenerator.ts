import Anthropic from "@anthropic-ai/sdk";

export type PermutationScenario = {
  // A short description of the outcome this scenario models, e.g.
  // "1-1 exactly (Sabi's call)" or "8+ total goals" or
  // "a red card in this match (Molly's pick)".
  outcome: string;
  // Display names of whoever ends up top of the matchweek under this
  // scenario (more than one if tied).
  leaders: string[];
  tied: boolean;
};

export type PermutationContext = {
  groupName: string;
  matchweek: string;
  fixtureName: string;
  // Who's ahead right now, before this fixture, ignoring anything this
  // fixture could still change (correct-result/exact-score only -- the Goal
  // Bonus can't be known yet).
  currentStandings: Array<{ name: string; points: number }>;
  scenarios: PermutationScenario[];
};

export interface PermutationGenerator {
  generate(context: PermutationContext): Promise<string>;
}

// Fallback for when Claude is unavailable/fails -- a plain, unvaried listing
// of the scenarios rather than the cascading "if X, Y; unless Z, W" prose
// ClaudeLiveChatGenerator produces, but the last game of the matchweek still
// gets a permutations message either way.
export class DeterministicPermutationGenerator implements PermutationGenerator {
  async generate(context: PermutationContext): Promise<string> {
    const intro = `Last game of the matchweek: ${context.fixtureName}.`;
    const lines = context.scenarios
      .slice(0, 3)
      .map((scenario) => {
        const who = scenario.leaders.join(scenario.tied ? " and " : "");
        const verb = scenario.tied ? "share the week" : "wins the week outright";
        return who ? `If it's ${scenario.outcome}, ${who} ${verb}.` : "";
      })
      .filter(Boolean);

    return [intro, ...lines].join(" ");
  }
}

const PERMUTATION_SYSTEM_PROMPT = `You write ONE short, chatty message for a friends' football-prediction group chat, previewing how the matchweek's final standings could shake out depending on the result of the LAST remaining fixture of the week (about to kick off).

You're given: "fixtureName" (the last game), "currentStandings" (who's ahead right now, before this game, ignoring anything it could still change), and "scenarios" -- an array of { outcome, leaders, tied }, each describing one possible way this game could go and who ends up top of the matchweek if it does.

Write in the cascading style of this example (do not copy it verbatim, match its structure and tone):
"Timosabi odds on to draw level and share the week with Alastair. 0-0 or 1-0 Leo shares the week. 7 goals or more and Alastair wins outright. Unless it's 1-1 in which case I win."

Guidance:
- Pick the 3-5 most narratively interesting scenarios from the array -- you don't need to mention all of them. Prioritize ones with different leaders/outcomes over near-duplicates.
- When "tied" is true, say the leaders "share"/"split" the week. When false, say the leader "wins outright"/"takes it".
- A scenario whose "outcome" mentions a red card is independent of the scoreline ones -- present it as its own aside ("if there's a red card in this one, ...").
- Never invent a name, number, or outcome not present in the given data.
- Tone: mostly factual, light and conversational, SHORT -- 1-3 sentences total. No forced jokes, never mean.

Rules:
- Output ONLY the message text. No quotes, no markdown, no preamble.
- Never mention "currentStandings"/"scenarios" as field names -- speak naturally.`;

export class ClaudePermutationGenerator implements PermutationGenerator {
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly fallback: PermutationGenerator;

  constructor(options?: { apiKey?: string; model?: string; fallback?: PermutationGenerator }) {
    const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model =
      options?.model ?? process.env.LIVE_CHAT_MODEL ?? "claude-haiku-4-5-20251001";
    this.fallback = options?.fallback ?? new DeterministicPermutationGenerator();
    this.client = apiKey ? new Anthropic({ apiKey, timeout: 8000 }) : null;
  }

  async generate(context: PermutationContext): Promise<string> {
    if (!this.client) {
      return this.fallback.generate(context);
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 220,
        system: PERMUTATION_SYSTEM_PROMPT,
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
      console.warn("[LiveChat] Permutation generation failed, using fallback:", error);
      return this.fallback.generate(context);
    }
  }
}
