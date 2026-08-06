import { Router, Request, Response } from "express";
import MatchEventService from "../services/MatchEventService.js";
import AuthService from "../services/AuthService.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../integrations/supabase/types.js";
import { asyncHandler } from "../middleware/errorHandler.js";

export default class MatchEventController {
  public router = Router();

  constructor() {
    this.router.post("/", asyncHandler(this.insertMatchEvent));
  }

  private createServices(req: Request, res: Response) {
    const auth = AuthService.forRequest(req, res);
    const client = auth.client as SupabaseClient<Database>;
    const matchEvent = new MatchEventService(client);

    return { auth, matchEvent };
  }

  insertMatchEvent = async (req: Request, res: Response) => {
    const { auth, matchEvent } = this.createServices(req, res);
    await auth.requireAdmin();

    const payload = req.body;

    const existingEvents = await matchEvent.insertMatchEvent(payload);

    return res.json({ data: existingEvents });
  };
}
