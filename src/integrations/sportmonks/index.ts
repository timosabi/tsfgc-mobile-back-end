import { SportMonksHydrationService } from "./hydration-service.js";
import { SportMonksLiveService } from "./live-service.js";
import SportMonksMockService from "./mock-service.js";
import SportMonksService from "./service.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types.js";

export function createSportMonksServices(supabase: SupabaseClient<Database>) {
  const useMock = process.env.SPORTMONKS_USE_MOCK === "true";
  const sportMonks = useMock
    ? new SportMonksMockService()
    : new SportMonksService({
        token:
          process.env.SPORTMONKS_TOKEN ||
          process.env.SPORTMONKS_API_TOKEN ||
          "",
        apiUrl:
          process.env.SPORTMONKS_API_URL ||
          "https://api.sportmonks.com/v3/football",
      });

  const hydration = new SportMonksHydrationService(sportMonks, supabase);
  const live = new SportMonksLiveService(sportMonks, supabase);

  return { hydration, live, sportMonks, useMock };
}
