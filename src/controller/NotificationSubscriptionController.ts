import { Router, type Request, type Response } from "express";
import AuthService from "../services/AuthService.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { createRepositories } from "../repositories/index.js";
import PushNotificationService from "../services/PushNotificationService.js";
import { AppError, asyncHandler } from "../middleware/errorHandler.js";

const SUPPORTED_CHANNELS = new Set(["fcm", "apns"]);

export default class NotificationSubscriptionController {
  public router = Router();

  constructor() {
    this.router.post(
      "/notification-subscriptions",
      asyncHandler(this.register)
    );
    this.router.delete(
      "/notification-subscriptions/:id",
      asyncHandler(this.unregister)
    );
    this.router.get(
      "/notification-subscriptions/mine",
      asyncHandler(this.listMine)
    );
    this.router.post(
      "/notification-subscriptions/test",
      asyncHandler(this.sendTest)
    );
  }

  private createServices(req: Request, res: Response) {
    const auth = AuthService.forRequest(req, res);
    const client = auth.client as SupabaseClient<Database>;
    const repositories = createRepositories(client);
    const pushNotifications = new PushNotificationService(repositories);

    return { auth, repositories, pushNotifications };
  }

  register = async (req: Request, res: Response) => {
    const { auth, repositories } = this.createServices(req, res);
    const user = await auth.requireApprovedUser();

    const { channel, endpoint, friendsGroupId, deviceLabel, authSecret, p256dhKey } =
      req.body ?? {};

    if (typeof channel !== "string" || !SUPPORTED_CHANNELS.has(channel)) {
      throw new AppError("channel must be one of: fcm, apns", 400);
    }
    if (typeof endpoint !== "string" || !endpoint.trim()) {
      throw new AppError("endpoint is required", 400);
    }

    await repositories.notificationSubscriptions.upsertSubscription({
      user_id: user.id,
      friends_group_id: friendsGroupId ?? null,
      channel,
      endpoint,
      auth_secret: authSecret ?? null,
      p256dh_key: p256dhKey ?? null,
      device_label: deviceLabel ?? null,
    });

    return res.json({ data: { registered: true } });
  };

  unregister = async (req: Request, res: Response) => {
    const { auth, repositories } = this.createServices(req, res);
    const user = await auth.requireApprovedUser();

    const { id } = req.params;
    if (!id) throw new AppError("id is required", 400);

    const existing = await repositories.notificationSubscriptions.findById(id);
    if (!existing || existing.user_id !== user.id) {
      throw new AppError("Subscription not found", 404);
    }

    await repositories.notificationSubscriptions.deactivateById(id);

    return res.json({ data: { unregistered: true } });
  };

  listMine = async (req: Request, res: Response) => {
    const { auth, repositories } = this.createServices(req, res);
    const user = await auth.requireApprovedUser();

    const data = await repositories.notificationSubscriptions.findActiveByUserId(
      user.id
    );

    return res.json({ data });
  };

  sendTest = async (req: Request, res: Response) => {
    const { auth, pushNotifications } = this.createServices(req, res);
    const admin = await auth.requireAdmin();

    const { title, body } = req.body ?? {};

    const result = await pushNotifications.sendToUsers([admin.id], {
      title: typeof title === "string" && title ? title : "Test notification",
      body: typeof body === "string" && body ? body : "This is a test push from TSFGC.",
    });

    return res.json({ data: result });
  };
}
