import { Router, type Request, type Response } from "express";
import AuthService from "../services/AuthService.js";
import ProfileService from "../services/ProfileService.js";
import PlayerStatsService from "../services/PlayerStatsService.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { AppError, asyncHandler } from "../middleware/errorHandler.js";
import { containsProfanity } from "../utils/profanity.js";

export default class ProfileController {
  public router = Router();

  constructor() {
    this.router.get("/id", asyncHandler(this.getProfile));
    this.router.put("/id", asyncHandler(this.updateProfile));
    this.router.get("/id/stats", asyncHandler(this.getStats));
  }

  private createServices(req: Request, res: Response) {
    const auth = AuthService.forRequest(req, res);
    const client = auth.client as SupabaseClient<Database>;
    const profile = new ProfileService(client);
    const playerStats = new PlayerStatsService(client);

    return { auth, profile, playerStats };
  }

  getProfile = async (req: Request, res: Response) => {
    const { auth, profile } = this.createServices(req, res);
    const user = await auth.requireApprovedUser();
    if (!user) throw new AppError("Unauthorized", 401);

    const data = await profile.getProfileData(user.id);

    if (!data) throw new AppError("Profile not found", 404);

    return res.json({ data });
  };

  updateProfile = async (req: Request, res: Response) => {
    const { auth, profile } = this.createServices(req, res);
    const user = await auth.requireApprovedUser();
    if (!user) throw new AppError("Unauthorized", 401);

    const targetUserId = user.id;
    if (!targetUserId) throw new AppError("Invalid userId", 400);

    if (targetUserId !== user.id) {
      const admin = await auth.requireAdmin();
      if (!admin) throw new AppError("Forbidden", 403);
    }

    const {
      display_name,
      avatar_emoji,
      color_class,
      favorite_team,
      default_friends_group_id,
    } = req.body ?? {};

    if (display_name !== undefined) {
      if (typeof display_name !== "string" || display_name.trim().length === 0) {
        throw new AppError("Display name must be a non-empty string", 400);
      }
      if (display_name.length > 24) {
        throw new AppError("Display name must be 24 characters or fewer", 400);
      }
      if (/[<>]/.test(display_name)) {
        throw new AppError("Display name contains invalid characters", 400);
      }
      if (containsProfanity(display_name)) {
        throw new AppError("Display name contains inappropriate language", 400);
      }
    }

    await profile.updateProfileData({
      userId: targetUserId,
      data: {
        display_name,
        avatar_emoji,
        color_class,
        favorite_team,
        default_friends_group_id,
      },
    });

    return res.status(200).json({ message: "Profile updated successfully" });
  };

  getStats = async (req: Request, res: Response) => {
    const { auth, playerStats } = this.createServices(req, res);
    const user = await auth.requireApprovedUser();
    if (!user) throw new AppError("Unauthorized", 401);

    const data = await playerStats.getMyStats(user.id);

    return res.json({ data });
  };

}
