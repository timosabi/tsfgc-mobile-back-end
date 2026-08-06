import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../integrations/supabase/types.js";

type FixtureInsert = Database["public"]["Tables"]["fixtures"]["Insert"];

export async function upsertFixturesInBatches(
  supabase: SupabaseClient<Database>,
  rows: FixtureInsert[],
  {
    onConflict = "sm_fixture_id",
    batchSize = 100,
  }: { onConflict?: string; batchSize?: number } = {}
) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from("fixtures").upsert(chunk, {
      onConflict,
      ignoreDuplicates: false,
    });
    if (error) throw error;
  }
}
