import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";

type MatchEventInsert = Database["public"]["Tables"]["match_events"]["Insert"];
type MatchEventRepositories = Pick<Repositories, "matchEvents">;

export default class MatchEventService {
  private readonly repositories: MatchEventRepositories;

  constructor(clientOrRepositories: SupabaseClient<Database> | MatchEventRepositories) {
    this.repositories = isMatchEventRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
  }

  async getMatchEvents(fixtureId: number) {
    return this.repositories.matchEvents.listByFixture(fixtureId);
  }

  async getFixtureGoalEvents(fixtureId: number) {
    return this.repositories.matchEvents.listGoalEvents(fixtureId);
  }

  async insertMatchEvent(payload: MatchEventInsert) {
    return this.repositories.matchEvents.insertEvent(payload);
  }

  async checkIfRedCardOccured(fixtureId: number) {
    return this.repositories.matchEvents.listRedCardIds(fixtureId);
  }
}

function isMatchEventRepositories(
  value: SupabaseClient<Database> | MatchEventRepositories
): value is MatchEventRepositories {
  return "matchEvents" in value;
}
