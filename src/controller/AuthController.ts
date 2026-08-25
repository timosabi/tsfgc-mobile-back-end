import { Router, type Request, type Response } from "express";
import type { User } from "@supabase/supabase-js";
import AuthService from "../services/AuthService.js";
import { AppError, asyncHandler } from "../middleware/errorHandler.js";

export default class AuthController {
  public router = Router();

  constructor() {
    this.router.get("/me", this.me);
    this.router.post("/sign-in", this.signIn);
    this.router.post("/sign-up", this.signUp);
    this.router.post("/sign-out", this.signOut);
    this.router.get("/callback", this.callback);
    this.router.post("/verify-password", this.verifyPassword);
    this.router.put("/email", this.updateEmail);
    this.router.put("/password", this.updatePassword);
    this.router.delete("/me", this.deleteMe);
  }

  private async assertCurrentPassword(
    auth: AuthService,
    user: User,
    currentPassword?: string
  ) {
    if (!currentPassword) {
      throw new AppError("Current password is required", 400);
    }
    if (!user.email) throw new AppError("Account has no email on file", 400);

    const { error } = await auth.signIn(user.email, currentPassword);
    if (error) throw new AppError("Current password is incorrect", 401);
  }

  me = asyncHandler(async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    const user = await auth.requireUser();

    if (!user) throw new AppError("Unauthorized", 401);

    const profile = await auth.getProfile(user.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        app_metadata: user.app_metadata,
      },
      profile,
    });
  });

  getSession = asyncHandler(async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    const { data } = await auth.getSession();

    res.json({
      session: data.session,
      user: data.session?.user ?? null,
    });
  });

  signIn = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};

    if (!email || !password)
      throw new AppError("Email and password required", 400);

    const auth = AuthService.forRequest(req, res);

    const { data, error } = await auth.signIn(email, password);
    if (error) throw new AppError("Invalid email or password.", 401);

    const profile = data.user ? await auth.getProfile(data.user.id) : null;

    res.json({ user: data.user, profile });
  });

  signUp = asyncHandler(async (req: Request, res: Response) => {
    const { email, password, displayName, redirectTo } = req.body ?? {};

    if (!email || !password)
      throw new AppError("Email and password required", 400);

    const auth = AuthService.forRequest(req, res);

    const { data, error } = await auth.signUp(
      email,
      password,
      displayName,
      redirectTo
    );

    if (error) throw new AppError(error.message, 500);

    const profile = data.user
      ? await auth.upsertProfileForUser({
          userId: data.user.id,
          email: data.user.email,
          displayName,
        })
      : null;

    res.json({ user: data.user, session: data.session, profile });
  });

  signOut = asyncHandler(async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);

    const { error } = await auth.signOut("local");

    if (error) throw new AppError(error.message, 500);

    res.status(204).end();
  });

  callback = asyncHandler(async (req: Request, res: Response) => {
    const code = (req.query.code as string | undefined) ?? "";
    if (!code) throw new AppError("Missing code.", 400);

    const rawState = (req.query.state as string | undefined) ?? "/";
    const state = rawState.startsWith("/") ? rawState : "/";

    const auth = AuthService.forRequest(req, res);

    const { data, error } = await auth.exchangeCode(code);
    if (error) throw new AppError("Auth failed.", 401);

    if (data.user) {
      await auth.ensureProfileForUser({
        userId: data.user.id,
        email: data.user.email,
        displayName: data.user.user_metadata?.display_name,
      });
    }

    res.redirect(state);
  });

  verifyPassword = asyncHandler(async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    const user = await auth.requireUser();

    const { currentPassword } = req.body ?? {};
    await this.assertCurrentPassword(auth, user, currentPassword);

    res.json({ verified: true });
  });

  updateEmail = asyncHandler(async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    const user = await auth.requireUser();

    const { newEmail, currentPassword } = req.body ?? {};
    if (!newEmail) throw new AppError("New email is required", 400);

    await this.assertCurrentPassword(auth, user, currentPassword);

    const { data, error } = await auth.updateEmail(newEmail);
    if (error) throw new AppError(error.message, 400);

    res.json({
      message:
        "Confirmation emails sent to your current and new address. The change applies once both are confirmed.",
      user: data.user,
    });
  });

  updatePassword = asyncHandler(async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    const user = await auth.requireUser();

    const { currentPassword, newPassword } = req.body ?? {};
    if (!newPassword) throw new AppError("New password is required", 400);
    if (newPassword.length < 6) {
      throw new AppError("New password must be at least 6 characters", 400);
    }

    await this.assertCurrentPassword(auth, user, currentPassword);

    const { error } = await auth.updatePassword(newPassword);
    if (error) throw new AppError(error.message, 400);

    res.json({ message: "Password updated successfully" });
  });

  deleteMe = asyncHandler(async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    const user = await auth.requireUser();

    if (!user) throw new AppError("Unauthorized", 401);

    const targetId =
      (req.body?.userId as string | undefined) ??
      (req.query?.userId as string | undefined);
    if (targetId && targetId !== user.id) {
      throw new AppError("You can only delete your own account", 403);
    }

    const { error } = await auth.deleteUserAsAdmin(user.id);
    if (error) throw new AppError(error.message, 500);

    await auth.signOut("local").catch(() => void 0);

    res.status(204).end();
  });
}
