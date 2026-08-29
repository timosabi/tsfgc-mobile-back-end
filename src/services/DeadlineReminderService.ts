import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories, type Repositories } from "../repositories/index.js";
import PushNotificationService from "./PushNotificationService.js";

type DeadlineReminderRepositories = Pick<
  Repositories,
  | "friendsGroupSubscriptions"
  | "fixtures"
  | "friendsGroupUsers"
  | "userSubmissions"
  | "friendsGroups"
  | "notificationSubscriptions"
>;

// Hours-before-lock at which a reminder fires. Checked as "crossed below this
// threshold", not an exact window match, so a missed/delayed cron tick can't
// skip a reminder entirely.
const REMINDER_THRESHOLDS_HOURS = [24, 2];

export default class DeadlineReminderService {
  private readonly repositories: DeadlineReminderRepositories;
  private readonly pushNotifications: PushNotificationService;

  // In-process dedup, same pattern as LiveEventsPollerService's firedSynthetic --
  // fine because this backend runs as a single instance (confirmed, no replicas).
  // Worst case on a restart: one reminder re-sent, never a silently dropped one.
  private readonly remindedKeys = new Set<string>();

  constructor(
    clientOrRepositories: SupabaseClient<Database> | DeadlineReminderRepositories,
    pushNotifications?: PushNotificationService
  ) {
    this.repositories = isDeadlineReminderRepositories(clientOrRepositories)
      ? clientOrRepositories
      : createRepositories(clientOrRepositories);
    this.pushNotifications =
      pushNotifications ?? new PushNotificationService(this.repositories);
  }

  async checkAndRemind(): Promise<{ remindersSent: number }> {
    const targets = await this.repositories.friendsGroupSubscriptions.listActiveTargets();
    let remindersSent = 0;

    for (const target of targets) {
      remindersSent += await this.checkSubscription(target);
    }

    return { remindersSent };
  }

  private async checkSubscription(target: {
    friends_group_id: string;
    provider_league_id: number;
    provider_season_id: number | null;
  }): Promise<number> {
    const openMatchweeks = await this.repositories.fixtures.listOpenMatchweeks({
      providerLeagueId: target.provider_league_id,
      providerSeasonId: target.provider_season_id,
    });
    if (!openMatchweeks.length) return 0;

    // The most recently opened matchweek is the one currently accepting
    // predictions; earlier ones are already locked/finished.
    const matchweek = openMatchweeks[openMatchweeks.length - 1];

    const fixtures = await this.repositories.fixtures.listForSubscription({
      providerLeagueId: target.provider_league_id,
      providerSeasonId: target.provider_season_id,
      matchweek,
    });
    if (!fixtures.length) return 0;

    const locksAt = Math.min(...fixtures.map((fixture) => this.fixtureStartTime(fixture)));
    const hoursRemaining = (locksAt - Date.now()) / (60 * 60 * 1000);
    if (hoursRemaining <= 0) return 0; // already locked/live -- nothing to remind

    let sentCount = 0;

    for (const thresholdHours of REMINDER_THRESHOLDS_HOURS) {
      if (hoursRemaining > thresholdHours) continue;

      const key = `${target.friends_group_id}:${matchweek}:${thresholdHours}`;
      if (this.remindedKeys.has(key)) continue;
      this.remindedKeys.add(key);

      const sent = await this.remindNonSubmittedMembers(
        target.friends_group_id,
        matchweek,
        thresholdHours
      );
      if (sent) sentCount += 1;
    }

    return sentCount;
  }

  private async remindNonSubmittedMembers(
    friendsGroupId: string,
    matchweek: string,
    thresholdHours: number
  ): Promise<boolean> {
    const [members, submitted, group] = await Promise.all([
      this.repositories.friendsGroupUsers.listMembers(friendsGroupId),
      this.repositories.userSubmissions.listSubmittedUserIds(friendsGroupId, matchweek),
      this.repositories.friendsGroups.findById(friendsGroupId),
    ]);

    const submittedUserIds = new Set(submitted.map((row) => row.user_id));
    const nonSubmittedUserIds = members
      .map((member) => member.user_id)
      .filter((userId) => !submittedUserIds.has(userId));

    if (!nonSubmittedUserIds.length || !group) return false;

    const hoursLabel = thresholdHours === 1 ? "1 hour" : `${thresholdHours} hours`;

    await this.pushNotifications.sendToUsers(nonSubmittedUserIds, {
      title: "Predictions lock soon",
      body: `${matchweek} predictions for ${group.name} lock in ${hoursLabel}`,
      data: {
        type: "deadline_reminder",
        friendsGroupId,
        slug: group.slug,
      },
    });

    return true;
  }

  private fixtureStartTime(fixture: {
    starting_at: string | null;
    match_date: string;
    match_time: string;
  }): number {
    if (fixture.starting_at) return new Date(fixture.starting_at).getTime();
    return new Date(`${fixture.match_date}T${fixture.match_time}Z`).getTime();
  }
}

function isDeadlineReminderRepositories(
  value: SupabaseClient<Database> | DeadlineReminderRepositories
): value is DeadlineReminderRepositories {
  return "friendsGroupSubscriptions" in value && "fixtures" in value;
}
