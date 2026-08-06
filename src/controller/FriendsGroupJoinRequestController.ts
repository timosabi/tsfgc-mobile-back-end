import { Router, type Request, type Response } from "express";
import AuthService from "../services/AuthService.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import FriendsGroupJoinRequestService from "../services/FriendsGroupJoinRequestService.js";
import { AppError, asyncHandler } from "../middleware/errorHandler.js";
import FriendsGroupService from "../services/FriendsGroupService.js";
import FriendsGroupUsersService from "../services/FriendsGroupUsersService.js";

export default class FriendsGroupJoinRequestController {
  public router = Router();

  constructor() {
    this.router.get(
      "/:friendsGroupId/request/status",
      asyncHandler(this.getRequestStatus)
    );
    this.router.post(
      "/requests/:requestId/approve",
      asyncHandler(this.approveRequest)
    );
    this.router.post(
      "/requests/:requestId/reject",
      asyncHandler(this.rejectRequest)
    );
    this.router.get(
      "/:friendsGroupId/requests/pending",
      asyncHandler(this.getPendingRequest)
    );
  }

  private createServices(req: Request, res: Response) {
    const auth = AuthService.forRequest(req, res);
    const client = auth.client as SupabaseClient<Database>;
    const friendsGroupJoinRequest = new FriendsGroupJoinRequestService(client);
    const friendsGroup = new FriendsGroupService(client);
    const friendsGroupUsers = new FriendsGroupUsersService(client);

    return { auth, friendsGroupJoinRequest, friendsGroup, friendsGroupUsers };
  }

  private async requireOwnerOrAdmin(
    auth: AuthService,
    friendsGroup: FriendsGroupService,
    friendsGroupId: string,
    userId: string
  ) {
    const group = await friendsGroup.getFriendsGroupRecord(friendsGroupId);
    if (!group) throw new AppError("Friends group not found", 404);

    if (group.created_by !== userId) await auth.requireAdmin();
    return group;
  }

  getRequestStatus = async (req: Request, res: Response) => {
    const { auth, friendsGroupJoinRequest, friendsGroupUsers } =
      this.createServices(req, res);

    const user = await auth.requireUser();
    if (!user) throw new AppError("Unauthorized", 401);

    const { friendsGroupId } = req.params;
    if (!friendsGroupId) throw new AppError("Invalid friendsGroupId", 400);

    const membership = await friendsGroupUsers.getFriendsGroupUserId(
      friendsGroupId,
      user.id
    );
    if (membership) {
      return res.status(200).json({ message: "Already a member" });
    }

    const data = await friendsGroupJoinRequest.getRequestStatus(user.id, friendsGroupId);

    return res.json({ data });
  };

  getPendingRequest = async (req: Request, res: Response) => {
    const { auth, friendsGroupJoinRequest, friendsGroup } =
      this.createServices(req, res);

    const user = await auth.requireUser();
    if (!user) throw new AppError("Unauthorized", 401);

    const { friendsGroupId } = req.params;
    await this.requireOwnerOrAdmin(auth, friendsGroup, friendsGroupId, user.id);

    const data = await friendsGroupJoinRequest.getPendingRequest(friendsGroupId);

    return res.json({ data });
  };

  approveRequest = async (req: Request, res: Response) => {
    const { auth, friendsGroupJoinRequest, friendsGroup, friendsGroupUsers } =
      this.createServices(req, res);

    const user = await auth.requireUser();
    const { requestId } = req.params;
    if (!requestId) throw new AppError("requestId is required", 400);

    const request = await friendsGroupJoinRequest.getJoinRequest(requestId);
    await this.requireOwnerOrAdmin(
      auth,
      friendsGroup,
      request.friends_group_id,
      user.id
    );

    const data = await friendsGroupJoinRequest.updateRequestStatus({
      requestId,
      status: "approved",
      processedBy: user.id,
    });

    await friendsGroupUsers.joinFriendsGroup({
      friendsGroupId: data.friends_group_id,
      userId: data.user_id,
    });

    return res.json({ data });
  };

  rejectRequest = async (req: Request, res: Response) => {
    const { auth, friendsGroupJoinRequest, friendsGroup } =
      this.createServices(req, res);

    const user = await auth.requireUser();
    const { requestId } = req.params;
    if (!requestId) throw new AppError("requestId is required", 400);

    const request = await friendsGroupJoinRequest.getJoinRequest(requestId);
    await this.requireOwnerOrAdmin(
      auth,
      friendsGroup,
      request.friends_group_id,
      user.id
    );

    const data = await friendsGroupJoinRequest.updateRequestStatus({
      requestId,
      status: "rejected",
      processedBy: user.id,
    });

    return res.json({ data });
  };
}
