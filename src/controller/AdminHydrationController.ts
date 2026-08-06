import { Router, Request, Response } from "express";
import AuthService from "../services/AuthService.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../integrations/supabase/types.js";
import { asyncHandler, AppError } from "../middleware/errorHandler.js";
import { createSportMonksServices } from "../integrations/sportmonks/index.js";
import WeeklyScoreService from "../services/WeeklyScoreService.js";

export default class AdminHydrationController {
  public router = Router();

  constructor() {
    this.router.post(
      "/fixtures/hydrate/full",
      asyncHandler(this.fullHydration)
    );
    this.router.post(
      "/fixtures/hydrate/matchweek",
      asyncHandler(this.hydrateMatchweek)
    );
    this.router.post(
      "/fixtures/hydrate/range",
      asyncHandler(this.hydrateRange)
    );
    this.router.post(
      "/fixtures/hydrate/upcoming",
      asyncHandler(this.hydrateUpcoming)
    );
    this.router.post(
      "/fixtures/hydrate/finished",
      asyncHandler(this.hydrateFinished)
    );
    this.router.post(
      "/fixtures/hydrate/league-season",
      asyncHandler(this.hydrateLeagueSeason)
    );
  }

  private getServices(req: Request, res: Response) {
    const auth = AuthService.forRequest(req, res);
    const supabase = auth.client as SupabaseClient<Database>;

    return {
      ...createSportMonksServices(supabase),
      weeklyScore: new WeeklyScoreService(supabase),
    };
  }

  fullHydration = async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    await auth.requireAdmin();

    const { hydration, weeklyScore } = this.getServices(req, res);
    const providerLeagueIds = req.body?.providerLeagueIds as
      | number[]
      | undefined;
    const stats = await hydration.fullHydration(providerLeagueIds);
    const scoring = await weeklyScore.calculateAllFinished();
    res.json({ ok: true, stats, scoring });
  };

  hydrateMatchweek = async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    await auth.requireAdmin();

    const { hydration } = this.getServices(req, res);
    const { matchweek } = req.body;
    if (!matchweek) throw new AppError("matchweek is required", 400);
    await hydration.hydrateMatchweek(matchweek);
    res.json({ ok: true });
  };

  hydrateRange = async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    await auth.requireAdmin();

    const { hydration, weeklyScore } = this.getServices(req, res);
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate)
      throw new AppError("startDate/endDate required", 400);
    await hydration.hydrateDateRange(startDate, endDate);
    const scoring = await weeklyScore.calculateAllFinished();
    res.json({ ok: true, scoring });
  };

  hydrateUpcoming = async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    await auth.requireAdmin();

    const { hydration } = this.getServices(req, res);
    const { days = 30, providerLeagueIds } = req.body as {
      days?: number;
      providerLeagueIds?: number[];
    };
    await hydration.hydrateUpcomingFixtures(days, providerLeagueIds);
    res.json({ ok: true });
  };

  hydrateFinished = async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    await auth.requireAdmin();

    const { hydration, weeklyScore } = this.getServices(req, res);
    const { days = 7 } = req.body as { days?: number };
    await hydration.hydrateFinishedFixtures(days);
    const scoring = await weeklyScore.calculateAllFinished();
    res.json({ ok: true, scoring });
  };

  hydrateLeagueSeason = async (req: Request, res: Response) => {
    const auth = AuthService.forRequest(req, res);
    await auth.requireAdmin();

    const { hydration, weeklyScore } = this.getServices(req, res);
    const providerLeagueId = Number(req.body?.providerLeagueId);
    const providerSeasonIdRaw = req.body?.providerSeasonId;
    const providerSeasonId =
      providerSeasonIdRaw === undefined || providerSeasonIdRaw === null
        ? null
        : Number(providerSeasonIdRaw);

    if (!Number.isFinite(providerLeagueId) || providerLeagueId <= 0) {
      throw new AppError("providerLeagueId is required", 400);
    }

    if (
      providerSeasonId !== null &&
      (!Number.isFinite(providerSeasonId) || providerSeasonId <= 0)
    ) {
      throw new AppError("providerSeasonId must be a positive number", 400);
    }

    const stats = await hydration.hydrateLeagueSeason(
      providerLeagueId,
      providerSeasonId
    );
    const scoring = await weeklyScore.calculateAllFinished();
    res.json({ ok: true, stats, scoring });
  };
}
