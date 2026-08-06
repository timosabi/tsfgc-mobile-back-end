import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/integrations/supabase/types.js";

type MockError = {
  message: string;
};

export type MockSupabaseResult<T = unknown> = {
  data: T | null;
  error: MockError | null;
  count?: number | null;
};

export type MockSupabaseCall = {
  table: string;
  method: string;
  args: unknown[];
};

type ResponseQueue = Map<string, MockSupabaseResult[]>;

const defaultResult: MockSupabaseResult = {
  data: null,
  error: null,
  count: null,
};

export function createMockSupabaseClient(initialResponses?: {
  [table: string]: MockSupabaseResult | MockSupabaseResult[];
}) {
  const calls: MockSupabaseCall[] = [];
  const responses: ResponseQueue = new Map();

  for (const [table, result] of Object.entries(initialResponses ?? {})) {
    responses.set(table, Array.isArray(result) ? [...result] : [result]);
  }

  const client = {
    from(table: string) {
      const result = responses.get(table)?.shift() ?? defaultResult;
      return new MockSupabaseQueryBuilder(table, result, calls);
    },
  } as unknown as SupabaseClient<Database>;

  return {
    client,
    calls,
    queueResponse(table: string, result: MockSupabaseResult) {
      const queue = responses.get(table) ?? [];
      queue.push(result);
      responses.set(table, queue);
    },
    getCalls(table?: string) {
      return table ? calls.filter((call) => call.table === table) : calls;
    },
  };
}

class MockSupabaseQueryBuilder
  implements PromiseLike<MockSupabaseResult>
{
  constructor(
    private readonly table: string,
    private readonly result: MockSupabaseResult,
    private readonly calls: MockSupabaseCall[]
  ) {}

  select(...args: unknown[]) {
    return this.record("select", args);
  }

  insert(...args: unknown[]) {
    return this.record("insert", args);
  }

  update(...args: unknown[]) {
    return this.record("update", args);
  }

  upsert(...args: unknown[]) {
    return this.record("upsert", args);
  }

  delete(...args: unknown[]) {
    return this.record("delete", args);
  }

  eq(...args: unknown[]) {
    return this.record("eq", args);
  }

  neq(...args: unknown[]) {
    return this.record("neq", args);
  }

  not(...args: unknown[]) {
    return this.record("not", args);
  }

  in(...args: unknown[]) {
    return this.record("in", args);
  }

  or(...args: unknown[]) {
    return this.record("or", args);
  }

  like(...args: unknown[]) {
    return this.record("like", args);
  }

  gte(...args: unknown[]) {
    return this.record("gte", args);
  }

  lte(...args: unknown[]) {
    return this.record("lte", args);
  }

  order(...args: unknown[]) {
    return this.record("order", args);
  }

  limit(...args: unknown[]) {
    return this.record("limit", args);
  }

  range(...args: unknown[]) {
    return this.record("range", args);
  }

  single(...args: unknown[]) {
    this.record("single", args);
    return Promise.resolve(this.result);
  }

  maybeSingle(...args: unknown[]) {
    this.record("maybeSingle", args);
    return Promise.resolve(this.result);
  }

  then<TResult1 = MockSupabaseResult, TResult2 = never>(
    onfulfilled?:
      | ((value: MockSupabaseResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }

  private record(method: string, args: unknown[]) {
    this.calls.push({ table: this.table, method, args });
    return this;
  }
}
