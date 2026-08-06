import type { BaseRepository } from "../../../src/repositories/base.js";
import type {
  RepositoryClient,
  TableId,
  TableInsert,
  TableName,
  TableRow,
} from "../../../src/repositories/index.js";
import { createMockSupabaseClient } from "../helpers/mockSupabase.js";

type RepositoryConstructor<T extends TableName> = new (
  client: RepositoryClient
) => BaseRepository<T>;

export function describeBaseRepository<T extends TableName>(params: {
  repositoryName: string;
  tableName: T;
  Repository: RepositoryConstructor<T>;
  sampleId: TableId<T>;
  sampleInsert: TableInsert<T>;
  sampleRow: TableRow<T>;
}) {
  const { repositoryName, tableName, Repository, sampleId, sampleInsert, sampleRow } =
    params;

  describe(repositoryName, () => {
    it(`findAll reads ${String(tableName)}`, async () => {
      const supabase = createMockSupabaseClient({
        [tableName]: { data: [sampleRow], error: null },
      });
      const repository = new Repository(supabase.client);

      await expect(repository.findAll()).resolves.toEqual([sampleRow]);
      expect(supabase.getCalls(String(tableName))).toEqual([
        { table: tableName, method: "select", args: ["*"] },
      ]);
    });

    it(`findById filters ${String(tableName)} by id`, async () => {
      const supabase = createMockSupabaseClient({
        [tableName]: { data: sampleRow, error: null },
      });
      const repository = new Repository(supabase.client);

      await expect(repository.findById(sampleId)).resolves.toEqual(sampleRow);
      expect(supabase.getCalls(String(tableName))).toEqual([
        { table: tableName, method: "select", args: ["*"] },
        { table: tableName, method: "eq", args: ["id", sampleId] },
        { table: tableName, method: "maybeSingle", args: [] },
      ]);
    });

    it(`insert writes to ${String(tableName)}`, async () => {
      const supabase = createMockSupabaseClient({
        [tableName]: { data: sampleRow, error: null },
      });
      const repository = new Repository(supabase.client);

      await expect(repository.insert(sampleInsert)).resolves.toEqual(sampleRow);
      expect(supabase.getCalls(String(tableName))).toEqual([
        { table: tableName, method: "insert", args: [sampleInsert] },
        { table: tableName, method: "select", args: ["*"] },
        { table: tableName, method: "single", args: [] },
      ]);
    });

    it("throws when Supabase returns an error", async () => {
      const supabase = createMockSupabaseClient({
        [tableName]: {
          data: null,
          error: { message: "database failed" },
        },
      });
      const repository = new Repository(supabase.client);

      await expect(repository.findAll()).rejects.toThrow(
        `${String(tableName)} findAll failed: database failed`
      );
    });
  });
}
