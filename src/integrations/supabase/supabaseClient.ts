import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Database } from "./types.js";
import { CookieOptions, createServerClient } from "@supabase/ssr";
import type { Request, Response } from "express";
import ws from "ws";

globalThis.WebSocket = ws as unknown as typeof WebSocket;

const url = process.env.LOVABLE_SUPABASE_URL;
const key = process.env.LOVABLE_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    "LOVABLE_SUPABASE_URL and LOVABLE_SUPABASE_SERVICE_ROLE_KEY are required to connect to Supabase."
  );
}

export const supabaseService = createClient<Database>(url!, key!);

const isProd = process.env.NODE_ENV === "production";

export function createSupabase(req: Request, res: Response) {
  return createServerClient(
    process.env.LOVABLE_SUPABASE_URL!,
    process.env.LOVABLE_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
        path: "/",
        sameSite: "lax",
        httpOnly: true,
        secure: isProd,
        // domain: process.env.COOKIE_DOMAIN,
      },
      cookieEncoding: "base64url",
      cookies: {
        getAll() {
          return Object.entries(req.cookies ?? {}).map(([name, value]) => ({
            name,
            value: String(value),
          }));
        },
        setAll(cookies) {
          for (const { name, value, options } of cookies) {
            res.cookie(name, value, options as CookieOptions);
          }
        },
      },
    }
  );
}
