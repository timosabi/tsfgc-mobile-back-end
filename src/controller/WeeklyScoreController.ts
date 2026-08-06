import { Router, Request, Response } from "express";
import WeeklyScoreService from "../services/WeeklyScoreService.js";
import AuthService from "../services/AuthService.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../integrations/supabase/types.js";
import { AppError, asyncHandler } from "../middleware/errorHandler.js";
import FriendsGroupUsersService from "../services/FriendsGroupUsersService.js";

export default class WeeklyScoreController {
  public router = Router();

  constructor() {
    this.router.get(
      "/:friendsGroupId/leaderboard",
      asyncHandler(this.getLeaderboard)
    );
    this.router.post(
      "/:friendsGroupId/calculate",
      asyncHandler(this.calculateMatchweek)
    );
    this.router.post("/calculate-all", asyncHandler(this.calculateAllFinished));
    this.router.post("/upsert", asyncHandler(this.upsertWeeklyScore));
  }

  private createServices(req: Request, res: Response) {
    const auth = AuthService.forRequest(req, res);
    const client = auth.client as SupabaseClient<Database>;
    const weeklyScore = new WeeklyScoreService(client);
    const friendsGroupUsers = new FriendsGroupUsersService(client);

    return { auth, weeklyScore, friendsGroupUsers };
  }

  private async requireMember(
    friendsGroupUsers: FriendsGroupUsersService,
    friendsGroupId: string,
    userId: string
  ) {
    const membership = await friendsGroupUsers.getFriendsGroupUserId(
      friendsGroupId,
      userId
    );
    if (!membership) throw new AppError("Not a member of this friends group", 403);
  }

  upsertWeeklyScore = async (req: Request, res: Response) => {
    const { auth, weeklyScore } = this.createServices(req, res);
    await auth.requireAdmin();

    const payload = req.body;

    const weeklyScoreResult = await weeklyScore.upsertWeeklyScore(payload);

    return res.json({ data: weeklyScoreResult });
  };

  getLeaderboard = async (req: Request, res: Response) => {
    const { auth, weeklyScore, friendsGroupUsers } = this.createServices(req, res);
    const user = await auth.requireUser();

    const { friendsGroupId } = req.params;
    if (!friendsGroupId) throw new AppError("friendsGroupId is required", 400);
    await this.requireMember(friendsGroupUsers, friendsGroupId, user.id);

    const data = await weeklyScore.getLeaderboard(friendsGroupId);
    return res.json({ data });
  };

  calculateMatchweek = async (req: Request, res: Response) => {
    const { auth, weeklyScore } = this.createServices(req, res);
    await auth.requireAdmin();

    const { friendsGroupId } = req.params;
    const { matchweek } = req.body ?? {};
    if (!friendsGroupId) throw new AppError("friendsGroupId is required", 400);
    if (!matchweek) throw new AppError("matchweek is required", 400);

    const data = await weeklyScore.calculateForFriendsGroupMatchweek(
      friendsGroupId,
      matchweek
    );
    return res.json({ data });
  };

  calculateAllFinished = async (req: Request, res: Response) => {
    const { auth, weeklyScore } = this.createServices(req, res);
    await auth.requireAdmin();

    const data = await weeklyScore.calculateAllFinished();
    return res.json({ data });
  };
}
