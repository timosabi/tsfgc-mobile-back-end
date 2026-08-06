import { createMockSupabaseClient } from "./mockSupabase.js";

describe("createMockSupabaseClient", () => {
  it("records chained Supabase calls and resolves queued table responses", async () => {
    const supabase = createMockSupabaseClient({
      fixtures: {
        data: [{ id: 1, home_team: "Home" }],
        error: null,
      },
    });

    const result = await supabase.client
      .from("fixtures")
      .select("*")
      .eq("matchweek", "Matchweek 1")
      .order("match_date", { ascending: true });

    expect(result.data).toEqual([{ id: 1, home_team: "Home" }]);
    expect(result.error).toBeNull();
    expect(supabase.getCalls("fixtures")).toEqual([
      { table: "fixtures", method: "select", args: ["*"] },
      {
        table: "fixtures",
        method: "eq",
        args: ["matchweek", "Matchweek 1"],
      },
      {
        table: "fixtures",
        method: "order",
        args: ["match_date", { ascending: true }],
      },
    ]);
  });

  it("supports terminal single and maybeSingle calls", async () => {
    const supabase = createMockSupabaseClient({
      profiles: [
        { data: { id: "user-1" }, error: null },
        { data: null, error: null },
      ],
    });

    const single = await supabase.client
      .from("profiles")
      .select("id")
      .eq("id", "user-1")
      .single();
    const maybeSingle = await supabase.client
      .from("profiles")
      .select("id")
      .eq("id", "missing")
      .maybeSingle();

    expect(single.data).toEqual({ id: "user-1" });
    expect(maybeSingle.data).toBeNull();
    expect(supabase.getCalls("profiles").map((call) => call.method)).toEqual([
      "select",
      "eq",
      "single",
      "select",
      "eq",
      "maybeSingle",
    ]);
  });
});
