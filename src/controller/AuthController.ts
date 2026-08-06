import { Router, type Request, type Response } from "express";
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
    this.router.delete("/me", this.deleteMe);
  }

  me = asyncHandler(async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    const user = await auth.requireUser();

    if (!user) throw new AppError("Unauthorized", 401);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        app_metadata: user.app_metadata,
      },
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

    res.json({ user: data.user });
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

    const { error } = await auth.exchangeCode(code);
    if (error) throw new AppError("Auth failed.", 401);

    res.redirect(state);
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
