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
