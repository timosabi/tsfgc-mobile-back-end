import cron from "node-cron";
import { createSportMonksServices } from "../integrations/sportmonks/index.js";
import { supabaseService } from "../integrations/supabase/supabaseClient.js";
import WeeklyScoreService from "../services/WeeklyScoreService.js";

const { hydration } = createSportMonksServices(supabaseService);
const weeklyScore = new WeeklyScoreService(supabaseService);
const hasSportMonksToken =
  process.env.SPORTMONKS_USE_MOCK === "true" ||
  Boolean(process.env.SPORTMONKS_TOKEN) ||
  Boolean(process.env.SPORTMONKS_API_TOKEN);
const cronEnabled = process.env.CRON_ENABLED === "true";

async function runCronJob(name: string, fn: () => Promise<unknown>) {
  if (!cronEnabled) {
    return;
  }

  if (!hasSportMonksToken) {
    console.warn("[CRON] SportMonks token missing; hydration skipped");
    return;
  }

  try {
    console.log(`[CRON] ${name} started`);
    await fn();
    await weeklyScore.calculateAllFinished();
    console.log(`[CRON] ${name} done`);
  } catch (e) {
    console.error(`[CRON] ${name} error`, e);
  }
}

export async function runDailyScheduleRefresh() {
  return runCronJob("Daily subscribed schedule refresh", async () => {
    return hydration.hydrateActiveSubscriptionSchedules();
  });
}

export async function runRecentFinishedRefresh() {
  return runCronJob("Recent subscribed finished refresh", async () => {
    return hydration.hydrateRecentFinishedForActiveSubscriptions(2);
  });
}

// Every day at 03:00 UTC: catch postponements/reschedules/cancellations.
cron.schedule("0 3 * * *", runDailyScheduleRefresh);

// Every two hours: catch final scores/red cards without waiting a full day.
cron.schedule("0 */2 * * *", runRecentFinishedRefresh);
