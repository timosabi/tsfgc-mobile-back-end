import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import type { NotificationSubscriptionsRepository } from "../repositories/index.js";

type PushRepositories = { notificationSubscriptions: NotificationSubscriptionsRepository };

const MULTICAST_CHUNK_SIZE = 500;
const INVALID_TOKEN_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

let messaging: Messaging | null = null;
let initAttempted = false;

// Guarded singleton, mirroring the SportMonks mock-token gating pattern: local
// dev/CI never need real Firebase credentials, this just logs and no-ops.
function getMessagingClient(): Messaging | null {
  if (initAttempted) return messaging;
  initAttempted = true;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      "[PushNotificationService] Firebase credentials not configured; push sends will be skipped"
    );
    return null;
  }

  try {
    const app =
      getApps()[0] ??
      initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          // Env vars can't hold real newlines, so \n is escaped on the way in.
          privateKey: privateKey.replace(/\\n/g, "\n"),
        }),
      });
    messaging = getMessaging(app);
  } catch (error) {
    console.error("[PushNotificationService] Failed to initialize Firebase Admin", error);
    messaging = null;
  }

  return messaging;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export default class PushNotificationService {
  constructor(private readonly repositories: PushRepositories) {}

  async sendToUsers(
    userIds: string[],
    notification: { title: string; body: string; data?: Record<string, string> }
  ): Promise<{ sent: number; skipped: boolean }> {
    if (process.env.PUSH_ENABLED !== "true" || !userIds.length) {
      return { sent: 0, skipped: true };
    }

    const client = getMessagingClient();
    if (!client) return { sent: 0, skipped: true };

    const subscriptions =
      await this.repositories.notificationSubscriptions.findActiveByUserIds(userIds);
    const tokens = subscriptions.map((subscription) => subscription.endpoint);
    if (!tokens.length) return { sent: 0, skipped: false };

    let sent = 0;
    const invalidTokens: string[] = [];

    for (const tokenChunk of chunk(tokens, MULTICAST_CHUNK_SIZE)) {
      const response = await client.sendEachForMulticast({
        tokens: tokenChunk,
        notification: { title: notification.title, body: notification.body },
        data: notification.data ?? {},
      });

      sent += response.successCount;

      response.responses.forEach((result, index) => {
        if (!result.success && result.error && INVALID_TOKEN_ERROR_CODES.has(result.error.code)) {
          invalidTokens.push(tokenChunk[index]);
        }
      });
    }

    if (invalidTokens.length) {
      await this.repositories.notificationSubscriptions.deactivateByEndpoints(invalidTokens);
    }

    return { sent, skipped: false };
  }
}
