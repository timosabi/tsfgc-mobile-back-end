import { Router, type Request, type Response } from "express";
import AuthService from "../services/AuthService.js";
import FriendsGroupService from "../services/FriendsGroupService.js";
import FriendsGroupSubscriptionService from "../services/FriendsGroupSubscriptionService.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";
import { AppError, asyncHandler } from "../middleware/errorHandler.js";
import { createSportMonksServices } from "../integrations/sportmonks/index.js";
import FriendsGroupUsersService from "../services/FriendsGroupUsersService.js";

export default class FriendsGroupController {
  public router = Router();

  constructor() {
    this.router.get("/competitions", asyncHandler(this.listCompetitions));
    this.router.get("/check-slug/:slug", asyncHandler(this.checkSlugExists));
    this.router.get("/admin/all", asyncHandler(this.listAllGroupsForAdmin));
    this.router.post("/", asyncHandler(this.createFriendsGroup));
  }

  private createServices(req: Request, res: Response) {
    const auth = AuthService.forRequest(req, res);
    const client = auth.client as SupabaseClient<Database>;
    const friendsGroup = new FriendsGroupService(client);
    const subscriptionService = new FriendsGroupSubscriptionService(client);
    const friendsGroupUsers = new FriendsGroupUsersService(client);

    return { auth, friendsGroup, subscriptionService, friendsGroupUsers, client };
  }

  private parseSubscriptionPayload(body: unknown) {
    const bodyRecord = this.asRecord(body);
    const payloadRecord = this.asRecord(bodyRecord?.payload);
    const raw =
      this.asRecord(bodyRecord?.subscription) ??
      this.asRecord(payloadRecord?.subscription) ??
      bodyRecord;

    const providerLeagueId = Number(raw?.providerLeagueId);

    if (!Number.isFinite(providerLeagueId) || providerLeagueId <= 0) {
      return null;
    }

    return {
      providerLeagueId,
      competitionName:
        this.asOptionalString(raw?.competitionName) ??
        this.asOptionalString(raw?.name) ??
        this.asOptionalString(raw?.leagueName) ??
        `SportMonks competition ${providerLeagueId}`,
      countryName: this.asOptionalString(raw?.countryName) ?? null,
      logoUrl:
        this.asOptionalString(raw?.logoUrl) ??
        this.asOptionalString(raw?.imagePath) ??
        null,
      seasonName: this.asOptionalString(raw?.seasonName) ?? null,
    };
  }

  private async resolveSubscriptionPayload(
    client: SupabaseClient<Database>,
    subscriptionService: FriendsGroupSubscriptionService,
    parsedPayload: NonNullable<ReturnType<typeof this.parseSubscriptionPayload>>
  ) {
    await this.ensureCompetitionCatalogForLeague(
      client,
      subscriptionService,
      parsedPayload.providerLeagueId
    );

    const competition = await subscriptionService.getCompetition(
      parsedPayload.providerLeagueId
    );
    if (!competition) {
      throw new AppError("Selected competition is not available", 422);
    }

    const currentSeasonId = competition?.current_provider_season_id ?? null;
    const currentSeason = (competition.seasons ?? []).find(
      (season) => season.provider_season_id === currentSeasonId
    );

    if (!currentSeasonId || !currentSeason) {
      throw new AppError(
        "Current season is not available for selected competition",
        422
      );
    }

    return {
      ...parsedPayload,
      competitionName: competition.name,
      countryName: competition.country_name,
      logoUrl: competition.logo_url,
      providerSeasonId: currentSeasonId,
      seasonName: currentSeason.name,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  }

  private asOptionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private async hydrateSubscription(
    client: SupabaseClient<Database>,
    providerLeagueId: number,
    providerSeasonId?: number | null
  ) {
    const useMock = process.env.SPORTMONKS_USE_MOCK === "true";
    if (
      !useMock &&
      !process.env.SPORTMONKS_TOKEN &&
      !process.env.SPORTMONKS_API_TOKEN
    ) {
      return {
        skipped: true,
        reason: "SPORTMONKS_TOKEN or SPORTMONKS_API_TOKEN is not configured",
      };
    }

    const { hydration } = createSportMonksServices(client);
    return hydration.hydrateLeagueSeason(providerLeagueId, providerSeasonId);
  }

  private shouldSyncCompetitionCatalog(data: unknown[]) {
    if (data.length === 0) return true;

    return data.some((row) => {
      const record = this.asRecord(row);
      const seasons = Array.isArray(record?.seasons) ? record.seasons : [];
      return !record?.current_provider_season_id || seasons.length === 0;
    });
  }

  private catalogLeagueIds() {
    const raw = process.env.SPORTMONKS_CATALOG_LEAGUE_IDS;
    if (!raw) return [501, 271];

    const parsed = raw
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    return parsed.length > 0 ? parsed : [501, 271];
  }

  private async syncCompetitionCatalog(
    client: SupabaseClient<Database>,
    subscriptionService: FriendsGroupSubscriptionService
  ) {
    return this.syncCompetitionCatalogForLeagues(
      client,
      subscriptionService,
      this.catalogLeagueIds()
    );
  }

  private async ensureCompetitionCatalogForLeague(
    client: SupabaseClient<Database>,
    subscriptionService: FriendsGroupSubscriptionService,
    providerLeagueId: number
  ) {
    const competition = await subscriptionService.getCompetition(providerLeagueId);
    const seasons = competition?.seasons ?? [];
    if (competition?.current_provider_season_id && seasons.length > 0) {
      return;
    }

    await this.syncCompetitionCatalogForLeagues(client, subscriptionService, [
      providerLeagueId,
    ]);
  }

  private async syncCompetitionCatalogForLeagues(
    client: SupabaseClient<Database>,
    subscriptionService: FriendsGroupSubscriptionService,
    providerLeagueIds: number[]
  ) {
    const useMock = process.env.SPORTMONKS_USE_MOCK === "true";
    if (
      !useMock &&
      !process.env.SPORTMONKS_TOKEN &&
      !process.env.SPORTMONKS_API_TOKEN
    ) {
      return { skipped: true, reason: "SportMonks token not configured" };
    }

    const { sportMonks } = createSportMonksServices(client);
    const countryByLeague = new Map([
      [501, "Scotland"],
      [271, "Denmark"],
    ]);
    const entries = [];

    for (const providerLeagueId of providerLeagueIds) {
      const { league, currentSeason } =
        await sportMonks.getLeagueWithCurrentSeason(providerLeagueId);

      entries.push({
        providerLeagueId,
        providerSeasonId: currentSeason?.id ?? null,
        competitionName: league.name,
        countryName: countryByLeague.get(providerLeagueId) ?? null,
        logoUrl: league.image_path ?? null,
        seasonName: currentSeason?.name ?? null,
      });
    }

    await subscriptionService.syncCompetitionCatalog(entries);
    return { skipped: false, synced: entries.length };
  }

  checkSlugExists = async (req: Request, res: Response) => {
    const { friendsGroup } = this.createServices(req, res);

    const { slug } = req.params;

    if (!slug) throw new AppError("Invalid slug", 400);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new AppError("Friends group slug must be lowercase kebab-case", 400);
    }

    const available = await friendsGroup.isSlugAvailable(slug);

    return res.json({ data: { available } });
  };

  listAllGroupsForAdmin = async (req: Request, res: Response) => {
    const { auth, friendsGroup } = this.createServices(req, res);

    await auth.requireAdmin();

    const data = await friendsGroup.listAllGroupsForAdmin();

    return res.json({ data });
  };

  createFriendsGroup = async (req: Request, res: Response) => {
    const { auth, friendsGroup, subscriptionService, friendsGroupUsers, client } =
      this.createServices(req, res);

    const user = await auth.requireUser();

    if (!user) throw new AppError("Unauthorized", 401);

    const { payload } = req.body;

    if (!payload) {
      throw new AppError("Invalid friends group payload (required)", 400);
    }

    const name = this.asOptionalString(payload.name)?.trim();
    const slug = this.asOptionalString(payload.slug)?.trim();
    const accessType = this.asOptionalString(payload.accessType);

    if (!name) throw new AppError("Friends group name is required", 400);
    if (!slug) throw new AppError("Friends group slug is required", 400);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new AppError("Friends group slug must be lowercase kebab-case", 400);
    }
    if (!(await friendsGroup.isSlugAvailable(slug))) {
      throw new AppError("Friends group slug is already taken", 409);
    }

    const isOpen =
      accessType === "open"
        ? true
        : accessType === "private"
        ? false
        : false;
    const payloadForInsert = {
      name,
      slug,
      created_by: user.id,
      is_open: isOpen,
      status: "approved",
    };

    const data = await friendsGroup.createFriendsGroup(payloadForInsert);
    await friendsGroupUsers.joinFriendsGroup({
      friendsGroupId: data.id,
      userId: user.id,
      role: "owner",
    });

    const parsedSubscriptionPayload = this.parseSubscriptionPayload(req.body);
    if (!parsedSubscriptionPayload) {
      return res.json({
        data,
        joinLink: `/join/${data.invite_token}`,
      });
    }
    const subscriptionPayload = await this.resolveSubscriptionPayload(
      client,
      subscriptionService,
      parsedSubscriptionPayload
    );

    const subscriptionResult = await subscriptionService.subscribe({
      friendsGroupId: data.id,
      createdBy: user.id,
      status: "active",
      ...subscriptionPayload,
    });

    const hydration = await this.hydrateSubscription(
      client,
      subscriptionPayload.providerLeagueId,
      subscriptionPayload.providerSeasonId
    );

    return res.json({
      data,
      joinLink: `/join/${data.invite_token}`,
      competition: subscriptionResult.competition,
      subscription: subscriptionResult.subscription,
      hydration,
    });
  };

  listCompetitions = async (req: Request, res: Response) => {
    const { subscriptionService, client } = this.createServices(req, res);
    let data = await subscriptionService.listCompetitions();

    if (this.shouldSyncCompetitionCatalog(data as unknown[])) {
      try {
        await this.syncCompetitionCatalog(client, subscriptionService);
        data = await subscriptionService.listCompetitions();
      } catch (error) {
        console.warn("[SportMonks] Competition catalog sync skipped:", error);
      }
    }

    return res.json({ data });
  };
}
