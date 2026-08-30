import cron from "node-cron";
import { createSportMonksServices } from "../integrations/sportmonks/index.js";
import { supabaseService } from "../integrations/supabase/supabaseClient.js";
import { createRepositories } from "../repositories/index.js";
import WeeklyScoreService from "../services/WeeklyScoreService.js";
import LiveFeedService from "../services/LiveFeedService.js";
import { ClaudeLiveChatGenerator } from "../services/LiveChatGenerator.js";
import LiveEventsPollerService from "../services/LiveEventsPollerService.js";
import PushNotificationService from "../services/PushNotificationService.js";
import DeadlineReminderService from "../services/DeadlineReminderService.js";
import MatchweekOverviewService from "../services/MatchweekOverviewService.js";

const { hydration, live, sportMonks } = createSportMonksServices(supabaseService);
const weeklyScore = new WeeklyScoreService(supabaseService);
const pushNotifications = new PushNotificationService(
  createRepositories(supabaseService)
);
const matchweekOverview = new MatchweekOverviewService(supabaseService);
const liveFeed = new LiveFeedService(
  supabaseService,
  new ClaudeLiveChatGenerator(),
  pushNotifications,
  matchweekOverview
);
const deadlineReminder = new DeadlineReminderService(
  supabaseService,
  pushNotifications
);
const livePollLeagueIds = (process.env.SPORTMONKS_CATALOG_LEAGUE_IDS ?? "8,501")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const livePoller = new LiveEventsPollerService({
  sportMonks,
  live,
  hydration,
  weeklyScore,
  liveFeed,
  leagueIds: livePollLeagueIds,
});
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

export async function runLivePoll() {
  if (!cronEnabled || !hasSportMonksToken) {
    return;
  }

  try {
    const { liveCount, skipped } = await livePoller.poll();
    if (skipped) {
      console.warn("[CRON] Live poll: previous tick still running, skipped");
    } else if (liveCount > 0) {
      console.log(`[CRON] Live poll: ${liveCount} fixture(s) live`);
    }
  } catch (e) {
    console.error("[CRON] Live poll error", e);
  }
}

export async function runDeadlineReminderCheck() {
  if (!cronEnabled) return;

  try {
    const { remindersSent } = await deadlineReminder.checkAndRemind();
    if (remindersSent > 0) {
      console.log(`[CRON] Deadline reminders: ${remindersSent} sent`);
    }
  } catch (e) {
    console.error("[CRON] Deadline reminder check error", e);
  }
}

// Every day at 03:00 UTC: catch postponements/reschedules/cancellations.
cron.schedule("0 3 * * *", runDailyScheduleRefresh);

// Every two hours: catch final scores/red cards without waiting a full day.
cron.schedule("0 */2 * * *", runRecentFinishedRefresh);

// Every 30s: live scores, match events, live chat, fast post-match finalization.
cron.schedule("*/30 * * * * *", runLivePoll);

// Every 15 minutes: check matchweek deadlines and remind non-submitted members.
cron.schedule("*/15 * * * *", runDeadlineReminderCheck);
