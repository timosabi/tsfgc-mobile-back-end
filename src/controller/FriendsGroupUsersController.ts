import { Router, Request, Response } from "express";
import FriendsGroupUsersService from "../services/FriendsGroupUsersService.js";
import FriendsGroupService from "../services/FriendsGroupService.js";
import AuthService from "../services/AuthService.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../integrations/supabase/types.js";
import { AppError, asyncHandler } from "../middleware/errorHandler.js";
import FriendsGroupJoinRequestService from "../services/FriendsGroupJoinRequestService.js";

export default class FriendsGroupUsersController {
  public router = Router();

  constructor() {
    this.router.get("/invite/:inviteToken", asyncHandler(this.getInvite));
    this.router.post("/invite/:inviteToken/join", asyncHandler(this.joinByInvite));
    this.router.delete(
      "/:friendsGroupId/leave",
      asyncHandler(this.removeUserFromFriendsGroup)
    );
    this.router.get(
      "/:friendsGroupId/members",
      asyncHandler(this.getOwnerMemberList)
    );
    this.router.delete(
      "/:friendsGroupId/members/:userId",
      asyncHandler(this.kickMember)
    );
    this.router.post(
      "/:friendsGroupId/transfer-ownership",
      asyncHandler(this.transferOwnership)
    );

    this.router.get("/me/groups", asyncHandler(this.getFriendsGroupsForUser));
  }

  private createServices(req: Request, res: Response) {
    const auth = AuthService.forRequest(req, res);
    const client = auth.client as SupabaseClient<Database>;
    const friendsGroup = new FriendsGroupService(client);
    const friendsGroupUsers = new FriendsGroupUsersService(client);
    const joinRequests = new FriendsGroupJoinRequestService(client);

    return { auth, friendsGroupUsers, friendsGroup, joinRequests };
  }

  getInvite = async (req: Request, res: Response) => {
    const { friendsGroup, friendsGroupUsers } = this.createServices(req, res);
    const { inviteToken } = req.params;
    if (!inviteToken) throw new AppError("inviteToken is required", 400);

    const group = await friendsGroup.getFriendsGroupByInviteToken(inviteToken);
    if (!group || group.status !== "approved") {
      throw new AppError("Invite link is invalid", 404);
    }

    const memberCount = await friendsGroupUsers.getNumberOfPlayers(group.id);
    return res.json({
      data: {
        id: group.id,
        name: group.name,
        slug: group.slug,
        accessType: group.is_open ? "open" : "private",
        memberCount: memberCount ?? 0,
      },
    });
  };

  joinByInvite = async (req: Request, res: Response) => {
    const { auth, friendsGroup, friendsGroupUsers, joinRequests } =
      this.createServices(req, res);
    const user = await auth.requireUser();
    if (!user) throw new AppError("Unauthorized", 401);

    const { inviteToken } = req.params;
    if (!inviteToken) throw new AppError("inviteToken is required", 400);

    const group = await friendsGroup.getFriendsGroupByInviteToken(inviteToken);
    if (!group || group.status !== "approved") {
      throw new AppError("Invite link is invalid", 404);
    }

    const membership = await friendsGroupUsers.getFriendsGroupUserId(
      group.id,
      user.id
    );
    if (membership) return res.json({ status: "member", friendsGroupId: group.id });

    if (group.is_open || group.created_by === user.id) {
      await friendsGroupUsers.joinFriendsGroup({
        friendsGroupId: group.id,
        userId: user.id,
        role: group.created_by === user.id ? "owner" : "member",
      });
      return res.json({ status: "joined", friendsGroupId: group.id });
    }

    await joinRequests.insertRequest({
      friendsGroupId: group.id,
      userId: user.id,
      message: req.body?.message,
      userDisplayName: req.body?.userDisplayName,
    });

    return res.status(202).json({
      status: "requested",
      friendsGroupId: group.id,
    });
  };

  getFriendsGroupsForUser = async (req: Request, res: Response) => {
    const { auth, friendsGroupUsers } = this.createServices(req, res);

    const user = await auth.requireUser();
    if (!user) throw new AppError("Unauthorized", 401);

    const groups = await friendsGroupUsers.getFriendsGroupsForUser(user.id);

    return res.json({
      data: groups.map((group) => ({
        ...group,
        friends_group: {
          ...group.friends_group,
          accessType: group.friends_group.is_open ? "open" : "private",
          joinLink: `/join/${group.friends_group.invite_token}`,
        },
      })),
    });
  };

  removeUserFromFriendsGroup = async (req: Request, res: Response) => {
    const { auth, friendsGroupUsers } = this.createServices(req, res);

    const user = await auth.requireUser();
    if (!user) throw new AppError("Unauthorized", 401);

    const { friendsGroupId } = req.params;

    const data = await friendsGroupUsers.removeUserFromFriendsGroup(
      user.id,
      friendsGroupId
    );

    return res.status(200).json({ data });
  };

  getOwnerMemberList = async (req: Request, res: Response) => {
    const { auth, friendsGroupUsers } = this.createServices(req, res);

    const user = await auth.requireUser();
    if (!user) throw new AppError("Unauthorized", 401);

    const { friendsGroupId } = req.params;
    if (!friendsGroupId) throw new AppError("friendsGroupId is required", 400);

    const data = await friendsGroupUsers.getOwnerMemberList({
      friendsGroupId,
      ownerUserId: user.id,
    });

    return res.status(200).json({ data });
  };

  kickMember = async (req: Request, res: Response) => {
    const { auth, friendsGroupUsers } = this.createServices(req, res);

    const user = await auth.requireUser();
    if (!user) throw new AppError("Unauthorized", 401);

    const { friendsGroupId, userId } = req.params;
    if (!friendsGroupId) throw new AppError("friendsGroupId is required", 400);
    if (!userId) throw new AppError("userId is required", 400);

    const data = await friendsGroupUsers.kickMember({
      friendsGroupId,
      ownerUserId: user.id,
      targetUserId: userId,
    });

    return res.status(200).json({ data });
  };

  transferOwnership = async (req: Request, res: Response) => {
    const { auth, friendsGroupUsers } = this.createServices(req, res);

    const user = await auth.requireUser();
    if (!user) throw new AppError("Unauthorized", 401);

    const { friendsGroupId } = req.params;
    if (!friendsGroupId) throw new AppError("friendsGroupId is required", 400);

    const newOwnerUserId =
      typeof req.body?.newOwnerUserId === "string"
        ? req.body.newOwnerUserId
        : undefined;
    if (!newOwnerUserId) {
      throw new AppError("newOwnerUserId is required", 400);
    }

    const data = await friendsGroupUsers.transferOwnership({
      friendsGroupId,
      currentOwnerUserId: user.id,
      newOwnerUserId,
    });

    return res.status(200).json({ data });
  };

}
