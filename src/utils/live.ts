import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";

type FixtureUpdate = Database["public"]["Tables"]["fixtures"]["Update"];

export type LivePatch = {
  sm_fixture_id: number;
  live_home_score: number | null;
  live_away_score: number | null;
  status: string | null;
  current_minute: number | null;
};

export async function patchLiveRows(
  supabase: SupabaseClient<Database>,
  patches: LivePatch[],
  batchSize = 100
) {
  for (let i = 0; i < patches.length; i += batchSize) {
    const chunk = patches.slice(i, i + batchSize);
    const updates = await Promise.all(
      chunk.map((p) => {
        const update: FixtureUpdate = {
            live_home_score: p.live_home_score,
            live_away_score: p.live_away_score,
            current_minute: p.current_minute,
            // optional: updated_at: new Date().toISOString()
        };
        if (p.status !== null) update.status = p.status;

        return supabase
          .from("fixtures")
          .update(update)
          .eq("sm_fixture_id", p.sm_fixture_id)
      })
    );
    const err = updates.find((r) => r.error)?.error;
    if (err) throw err;
  }
}
