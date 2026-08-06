import { Router, Request, Response } from "express";
import AuthService from "../services/AuthService.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../integrations/supabase/types.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { createSportMonksServices } from "../integrations/sportmonks/index.js";

export default class LiveController {
  public router = Router();

  constructor() {
    this.router.post("/fixtures/live/refresh", asyncHandler(this.refreshLive));
  }

  private getServices(req: Request, res: Response) {
    const auth = AuthService.forRequest(req, res);
    const supabase = auth.client as SupabaseClient<Database>;
    return {
      ...createSportMonksServices(supabase),
      supabase,
      auth,
    };
  }

  refreshLive = async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    await auth.requireAdmin();

    const { live } = this.getServices(req, res);
    const providerLeagueIds =
      (req.body?.providerLeagueIds as number[] | undefined) ?? undefined;
    const data = await live.getLiveFixtures(providerLeagueIds);
    res.json({ data });
  };
}
