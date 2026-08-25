import { Router, type Request, type Response } from "express";
import AuthService from "../services/AuthService.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import MembershipRequestService from "../services/MembershipRequestService.js";
import { AppError, asyncHandler } from "../middleware/errorHandler.js";

export default class MembershipRequestController {
  public router = Router();

  constructor() {
    this.router.get(
      "/membership-requests/pending",
      asyncHandler(this.getPendingRequests)
    );
    this.router.post(
      "/membership-requests/:userId/approve",
      asyncHandler(this.approveRequest)
    );
    this.router.post(
      "/membership-requests/:userId/reject",
      asyncHandler(this.rejectRequest)
    );
  }

  private createServices(req: Request, res: Response) {
    const auth = AuthService.forRequest(req, res);
    const client = auth.client as SupabaseClient<Database>;
    const membershipRequest = new MembershipRequestService(client);

    return { auth, membershipRequest };
  }

  getPendingRequests = async (req: Request, res: Response) => {
    const { auth, membershipRequest } = this.createServices(req, res);
    await auth.requireAdmin();

    const data = await membershipRequest.listPending();

    return res.json({ data });
  };

  approveRequest = async (req: Request, res: Response) => {
    const { auth, membershipRequest } = this.createServices(req, res);
    const admin = await auth.requireAdmin();

    const { userId } = req.params;
    if (!userId) throw new AppError("userId is required", 400);

    const { note } = req.body ?? {};

    const data = await membershipRequest.approve(userId, admin.id, note);

    return res.json({ data });
  };

  rejectRequest = async (req: Request, res: Response) => {
    const { auth, membershipRequest } = this.createServices(req, res);
    const admin = await auth.requireAdmin();

    const { userId } = req.params;
    if (!userId) throw new AppError("userId is required", 400);

    const { note } = req.body ?? {};

    const data = await membershipRequest.reject(userId, admin.id, note);

    return res.json({ data });
  };
}
