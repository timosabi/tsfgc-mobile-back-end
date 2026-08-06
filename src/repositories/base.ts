import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.js";

export type PublicTables = Database["public"]["Tables"];
export type TableName = keyof PublicTables;
export type TableRow<T extends TableName> = PublicTables[T]["Row"];
export type TableInsert<T extends TableName> = PublicTables[T]["Insert"];
export type TableUpdate<T extends TableName> = PublicTables[T]["Update"];
export type TableId<T extends TableName> = TableRow<T> extends { id: infer Id }
  ? Id
  : string;
export type RepositoryClient = SupabaseClient<Database>;

export abstract class BaseRepository<T extends TableName> {
  protected constructor(
    protected readonly supabase: RepositoryClient,
    protected readonly tableName: T
  ) {}

  protected table() {
    return this.supabase.from(this.tableName);
  }

  async findAll(select = "*"): Promise<TableRow<T>[]> {
    const { data, error } = await this.table().select(select);
    this.throwOnError(error, `${String(this.tableName)} findAll failed`);
    return (data ?? []) as unknown as TableRow<T>[];
  }

  async findById(id: TableId<T>, select = "*"): Promise<TableRow<T> | null> {
    const { data, error } = await this.table()
      .select(select)
      .eq("id", id as never)
      .maybeSingle();
    this.throwOnError(error, `${String(this.tableName)} findById failed`);
    return (data ?? null) as unknown as TableRow<T> | null;
  }

  async insert(row: TableInsert<T>, select = "*"): Promise<TableRow<T>> {
    const { data, error } = await this.table()
      .insert(row as never)
      .select(select)
      .single();
    this.throwOnError(error, `${String(this.tableName)} insert failed`);
    return data as unknown as TableRow<T>;
  }

  async insertMany(rows: TableInsert<T>[]): Promise<void> {
    const { error } = await this.table().insert(rows as never);
    this.throwOnError(error, `${String(this.tableName)} insertMany failed`);
  }

  async updateById(
    id: TableId<T>,
    patch: TableUpdate<T>,
    select = "*"
  ): Promise<TableRow<T>> {
    const { data, error } = await this.table()
      .update(patch as never)
      .eq("id", id as never)
      .select(select)
      .single();
    this.throwOnError(error, `${String(this.tableName)} updateById failed`);
    return data as unknown as TableRow<T>;
  }

  async deleteById(id: TableId<T>): Promise<void> {
    const { error } = await this.table().delete().eq("id", id as never);
    this.throwOnError(error, `${String(this.tableName)} deleteById failed`);
  }

  async upsert(
    row: TableInsert<T> | TableInsert<T>[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean }
  ): Promise<void> {
    const { error } = await this.table().upsert(row as never, options);
    this.throwOnError(error, `${String(this.tableName)} upsert failed`);
  }

  protected throwOnError(
    error: { message: string } | null,
    context: string
  ): asserts error is null {
    if (error) throw new Error(`${context}: ${error.message}`);
  }
}
