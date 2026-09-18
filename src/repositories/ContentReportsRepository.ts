import {
  BaseRepository,
  type RepositoryClient,
  type TableInsert,
  type TableRow,
} from "./base.js";

export type PendingContentReport = TableRow<"content_reports"> & {
  reporter: Pick<TableRow<"profiles">, "id" | "display_name"> | null;
  reported: Pick<TableRow<"profiles">, "id" | "display_name"> | null;
};

export default class ContentReportsRepository extends BaseRepository<"content_reports"> {
  constructor(client: RepositoryClient) {
    super(client, "content_reports");
  }

  async create(row: TableInsert<"content_reports">): Promise<TableRow<"content_reports">> {
    return this.insert(row);
  }

  async listPending(): Promise<PendingContentReport[]> {
    const { data, error } = await this.table()
      .select(
        `
        *,
        reporter:profiles!content_reports_reporter_user_id_fkey (id, display_name),
        reported:profiles!content_reports_reported_user_id_fkey (id, display_name)
        `
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    this.throwOnError(error, "content_reports listPending failed");
    return (data ?? []) as unknown as PendingContentReport[];
  }

  async resolve(
    id: string,
    params: { status: "actioned" | "dismissed"; reviewedBy: string; reviewNote?: string }
  ): Promise<TableRow<"content_reports">> {
    return this.updateById(id, {
      status: params.status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: params.reviewedBy,
      review_note: params.reviewNote ?? null,
    });
  }
}
