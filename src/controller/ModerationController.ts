import { Router, type Request, type Response } from "express";
import AuthService from "../services/AuthService.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import ModerationService from "../services/ModerationService.js";
import { AppError, asyncHandler } from "../middleware/errorHandler.js";

export default class ModerationController {
  public router = Router();

  constructor() {
    this.router.post("/moderation/reports", asyncHandler(this.createReport));
    this.router.get(
      "/admin/moderation/reports/pending",
      asyncHandler(this.listPendingReports)
    );
    this.router.post(
      "/admin/moderation/reports/:id/resolve",
      asyncHandler(this.resolveReport)
    );
    this.router.post("/moderation/blocks", asyncHandler(this.blockMember));
    this.router.delete(
      "/moderation/blocks/:blockedUserId",
      asyncHandler(this.unblockMember)
    );
    this.router.get("/moderation/blocks", asyncHandler(this.listBlocked));
  }

  private createServices(req: Request, res: Response) {
    const auth = AuthService.forRequest(req, res);
    const client = auth.client as SupabaseClient<Database>;
    const moderation = new ModerationService(client);

    return { auth, moderation };
  }

  createReport = async (req: Request, res: Response) => {
    const { auth, moderation } = this.createServices(req, res);
    const user = await auth.requireApprovedUser();

    const { reportedUserId, friendsGroupId } = req.body ?? {};
    if (!reportedUserId || !friendsGroupId) {
      throw new AppError("reportedUserId and friendsGroupId are required", 400);
    }
    if (reportedUserId === user.id) {
      throw new AppError("You cannot report yourself", 400);
    }

    const data = await moderation.reportDisplayName({
      reporterUserId: user.id,
      reportedUserId,
      friendsGroupId,
    });

    return res.json({ data });
  };

  listPendingReports = async (req: Request, res: Response) => {
    const { auth, moderation } = this.createServices(req, res);
    await auth.requireAdmin();

    const data = await moderation.listPendingReports();

    return res.json({ data });
  };

  resolveReport = async (req: Request, res: Response) => {
    const { auth, moderation } = this.createServices(req, res);
    const admin = await auth.requireAdmin();

    const { id } = req.params;
    if (!id) throw new AppError("Report id is required", 400);

    const { action, note, lockOffender } = req.body ?? {};
    if (action !== "actioned" && action !== "dismissed") {
      throw new AppError('action must be "actioned" or "dismissed"', 400);
    }

    const data = await moderation.resolveReport(id, admin.id, {
      action,
      note,
      lockOffender: Boolean(lockOffender),
    });

    return res.json({ data });
  };

  blockMember = async (req: Request, res: Response) => {
    const { auth, moderation } = this.createServices(req, res);
    const user = await auth.requireApprovedUser();

    const { blockedUserId } = req.body ?? {};
    if (!blockedUserId) throw new AppError("blockedUserId is required", 400);
    if (blockedUserId === user.id) {
      throw new AppError("You cannot block yourself", 400);
    }

    await moderation.blockMember(user.id, blockedUserId);

    return res.status(204).end();
  };

  unblockMember = async (req: Request, res: Response) => {
    const { auth, moderation } = this.createServices(req, res);
    const user = await auth.requireApprovedUser();

    const { blockedUserId } = req.params;
    if (!blockedUserId) throw new AppError("blockedUserId is required", 400);

    await moderation.unblockMember(user.id, blockedUserId);

    return res.status(204).end();
  };

  listBlocked = async (req: Request, res: Response) => {
    const { auth, moderation } = this.createServices(req, res);
    const user = await auth.requireApprovedUser();

    const data = await moderation.listBlockedIds(user.id);

    return res.json({ data });
  };
}
