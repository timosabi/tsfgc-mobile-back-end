import {
  BaseRepository,
  type RepositoryClient,
  type TableInsert,
  type TableRow,
} from "./base.js";

export default class WeeklyScoresRepository extends BaseRepository<"weekly_scores"> {
  constructor(client: RepositoryClient) {
    super(client, "weekly_scores");
  }

  async findByUserGroupWeek(
    userId: string,
    friendsGroupId: string,
    weekNumber: number
  ): Promise<TableRow<"weekly_scores"> | null> {
    const { data, error } = await this.table()
      .select("*")
      .eq("user_id", userId)
      .eq("friends_group_id", friendsGroupId)
      .eq("week_number", weekNumber)
      .maybeSingle();

    this.throwOnError(error, "weekly_scores findByUserGroupWeek failed");
    return (data ?? null) as TableRow<"weekly_scores"> | null;
  }

  async upsertScores(
    rows: TableInsert<"weekly_scores">[],
    options: {
      onConflict?: string;
      returnRows?: boolean;
    } = {}
  ): Promise<TableRow<"weekly_scores">[] | null> {
    const query = this.table().upsert(rows as never, {
      onConflict: options.onConflict ?? "user_id,friends_group_id,week_number",
      ignoreDuplicates: false,
    });

    if (!options.returnRows) {
      const { error } = await query;
      this.throwOnError(error, "weekly_scores upsertScores failed");
      return null;
    }

    const { data, error } = await query.select("*");
    this.throwOnError(error, "weekly_scores upsertScores failed");
    return (data ?? []) as TableRow<"weekly_scores">[];
  }

  async listByGroupWeek(
    friendsGroupId: string,
    weekNumber: number,
    orderByPoints = false,
    userId?: string
  ): Promise<TableRow<"weekly_scores">[]> {
    let query = this.table()
      .select("*")
      .eq("friends_group_id", friendsGroupId)
      .eq("week_number", weekNumber);

    if (userId) query = query.eq("user_id", userId);

    if (orderByPoints) {
      query = query.order("points_earned", { ascending: false });
    }

    const { data, error } = await query;
    this.throwOnError(error, "weekly_scores listByGroupWeek failed");
    return (data ?? []) as TableRow<"weekly_scores">[];
  }

  async listByGroupPaginated(params: {
    friendsGroupId: string;
    userId?: string;
    orders?: Array<[string, boolean]>;
    pageSize?: number;
  }): Promise<TableRow<"weekly_scores">[]> {
    const pageSize = params.pageSize ?? 1000;
    const rows: TableRow<"weekly_scores">[] = [];

    for (let from = 0; ; from += pageSize) {
      let query = this.table()
        .select("*")
        .eq("friends_group_id", params.friendsGroupId);

      if (params.userId) query = query.eq("user_id", params.userId);

      for (const [column, ascending] of params.orders ?? []) {
        query = query.order(column, { ascending });
      }

      const { data, error } = await query.range(from, from + pageSize - 1);
      this.throwOnError(error, "weekly_scores listByGroupPaginated failed");

      const page = (data ?? []) as TableRow<"weekly_scores">[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }

    return rows;
  }
}
