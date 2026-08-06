import { Router, Request, Response } from "express";
import AuthService from "../services/AuthService.js";
import FriendsGroupUsersService from "../services/FriendsGroupUsersService.js";
import MatchweekOverviewService from "../services/MatchweekOverviewService.js";
import PredictionSlipService from "../services/PredictionSlipService.js";
import { AppError, asyncHandler } from "../middleware/errorHandler.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../integrations/supabase/types.js";

export default class MatchweekPredictionController {
  public router = Router();

  constructor() {
    this.router.get(
      "/:friendsGroupId/matchweeks/current/overview",
      asyncHandler(this.getOverview)
    );
    this.router.get(
      "/:friendsGroupId/matchweeks/:matchweek/overview",
      asyncHandler(this.getOverview)
    );
    this.router.get(
      "/:friendsGroupId/matchweeks/:matchweek/predictions/mine",
      asyncHandler(this.getMine)
    );
    this.router.put(
      "/:friendsGroupId/matchweeks/:matchweek/predictions/mine",
      asyncHandler(this.saveMine)
    );
    this.router.post(
      "/:friendsGroupId/matchweeks/:matchweek/predictions/mine/submit",
      asyncHandler(this.submitMine)
    );
    this.router.delete(
      "/:friendsGroupId/matchweeks/:matchweek/predictions/mine",
      asyncHandler(this.deleteMine)
    );
  }

  private createServices(req: Request, res: Response) {
    const auth = AuthService.forRequest(req, res);
    const client = auth.client as SupabaseClient<Database>;
    return {
      auth,
      overview: new MatchweekOverviewService(client),
      slip: new PredictionSlipService(client),
      friendsGroupUsers: new FriendsGroupUsersService(client),
    };
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

  getMine = async (req: Request, res: Response) => {
    const { auth, slip, friendsGroupUsers } = this.createServices(req, res);
    const user = await auth.requireUser();
    const { friendsGroupId, matchweek } = req.params;
    await this.requireMember(friendsGroupUsers, friendsGroupId, user.id);
    const data = await slip.getMine({ userId: user.id, friendsGroupId, matchweek });
    res.json({ data });
  };

  getOverview = async (req: Request, res: Response) => {
    const { auth, overview, friendsGroupUsers } = this.createServices(req, res);
    const user = await auth.requireUser();
    const { friendsGroupId, matchweek } = req.params;
    await this.requireMember(friendsGroupUsers, friendsGroupId, user.id);
    const data = await overview.getOverview({
      userId: user.id,
      friendsGroupId,
      matchweek: matchweek ?? "current",
    });
    res.json({ data });
  };

  saveMine = async (req: Request, res: Response) => {
    const { auth, slip, friendsGroupUsers } = this.createServices(req, res);
    const user = await auth.requireUser();
    const { friendsGroupId, matchweek } = req.params;
    await this.requireMember(friendsGroupUsers, friendsGroupId, user.id);
    const data = await slip.saveMine({
      userId: user.id,
      friendsGroupId,
      matchweek,
      payload: req.body,
    });
    res.json({ data });
  };

  submitMine = async (req: Request, res: Response) => {
    const { auth, slip, friendsGroupUsers } = this.createServices(req, res);
    const user = await auth.requireUser();
    const { friendsGroupId, matchweek } = req.params;
    await this.requireMember(friendsGroupUsers, friendsGroupId, user.id);
    const data = await slip.submitMine({ userId: user.id, friendsGroupId, matchweek });
    res.json({ data });
  };

  deleteMine = async (req: Request, res: Response) => {
    const { auth, slip, friendsGroupUsers } = this.createServices(req, res);
    const user = await auth.requireUser();
    const { friendsGroupId, matchweek } = req.params;
    await this.requireMember(friendsGroupUsers, friendsGroupId, user.id);
    const data = await slip.deleteMine({ userId: user.id, friendsGroupId, matchweek });
    res.json({ data });
  };

}
