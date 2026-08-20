import type { SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import {
  createSupabase,
  supabaseService,
} from "../integrations/supabase/supabaseClient.js";
import type { Database } from "../integrations/supabase/types.js";
import { AppError } from "../middleware/errorHandler.js";
import ProfilesRepository from "../repositories/ProfilesRepository.js";

export default class AuthService {
  private readonly profiles: ProfilesRepository;

  constructor(private supabase: SupabaseClient<Database>) {
    this.profiles = new ProfilesRepository(supabase);
  }

  static forRequest(req: Request, res: Response) {
    return new AuthService(createSupabase(req, res));
  }

  get client() {
    return this.supabase;
  }

  async getSession() {
    const result = await this.supabase.auth.getSession();
    if (result.error) {
      throw new AppError(result.error.message, 401);
    }
    return result;
  }

  async getUser() {
    const result = await this.supabase.auth.getUser();
    if (result.error) {
      throw new AppError(result.error.message, 401);
    }
    return result;
  }

  async requireUser() {
    const {
      data: { user },
      error,
    } = await this.getUser();

    if (error || !user) {
      throw new AppError("Authentication required", 401);
    }

    return user;
  }

  async requireAdmin() {
    const user = await this.requireUser();

    let isAdmin = user.app_metadata?.role === "admin";
    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    if (!isAdmin && user.email) {
      isAdmin = adminEmails.includes(user.email.toLowerCase());
    }

    if (!isAdmin) {
      try {
        const profile = await this.profiles.findProfileById(user.id);
        isAdmin = !!profile?.is_admin;
      } catch {
        throw new AppError("Failed to verify admin status", 500);
      }
    }

    if (!isAdmin) {
      throw new AppError("Admin access required", 403);
    }

    return user;
  }

  signIn(email: string, password: string) {
    return this.supabase.auth.signInWithPassword({ email, password });
  }

  signUp(
    email: string,
    password: string,
    displayName?: string,
    redirectTo?: string
  ) {
    return this.supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: { display_name: displayName || "Player" },
      },
    });
  }

  signOut(scope: "local" | "global" | "others" = "local") {
    return this.supabase.auth.signOut({ scope });
  }

  updateEmail(newEmail: string) {
    return this.supabase.auth.updateUser({ email: newEmail });
  }

  updatePassword(newPassword: string) {
    return this.supabase.auth.updateUser({ password: newPassword });
  }

  exchangeCode(code: string) {
    return this.supabase.auth.exchangeCodeForSession(code);
  }

  deleteUserAsAdmin(userId: string) {
    return supabaseService.auth.admin.deleteUser(userId);
  }

  async upsertProfileForUser(payload: {
    userId: string;
    email?: string | null;
    displayName?: string;
  }) {
    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    const isAdmin = payload.email
      ? adminEmails.includes(payload.email.toLowerCase())
      : false;

    try {
      return await this.profiles.upsertProfile({
        id: payload.userId,
        display_name: payload.displayName ?? "Player",
        is_admin: isAdmin,
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : "Failed to upsert profile",
        500
      );
    }
  }

  async ensureProfileForUser(payload: {
    userId: string;
    email?: string | null;
    displayName?: string;
  }) {
    const existing = await this.profiles.findProfileById(payload.userId);
    if (existing) {
      return existing;
    }

    return this.upsertProfileForUser(payload);
  }
}
