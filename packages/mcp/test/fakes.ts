// Test doubles: a Customer that records mutations, a server that records tools.
import type { Customer } from "google-ads-api";

export type FakeCustomer = Customer & { calls: { ops: unknown[]; options?: { validate_only?: boolean } }[]; queries: string[] };

export function fakeCustomer(rows: Record<string, unknown[]> = {}): FakeCustomer {
  const calls: FakeCustomer["calls"] = [];
  const queries: string[] = [];
  const c = {
    calls,
    queries,
    async query(q: string) {
      queries.push(q);
      const from = /FROM\s+(\w+)/i.exec(q)?.[1] ?? "";
      return rows[from] ?? [];
    },
    async mutateResources(ops: unknown[], options?: { validate_only?: boolean }) {
      calls.push({ ops, options });
      return {
        mutate_operation_responses: ops.map((_, i) => ({ result: { resource_name: `customers/1/fake/${i + 1}` } })),
      };
    },
    customAudiences: {
      async create(_a: unknown[], o?: { validate_only?: boolean }) {
        calls.push({ ops: _a, options: o });
        return { results: [{ resource_name: "customers/1/customAudiences/77" }] };
      },
    },
  };
  return c as unknown as FakeCustomer;
}

export type FakeServer = { tools: Record<string, { shape: Record<string, unknown>; handler: (a: any) => Promise<any> }>; tool: (...a: any[]) => void };

export function fakeServer(): FakeServer {
  const tools: FakeServer["tools"] = {};
  return {
    tools,
    tool: (name: string, _desc: string, shape: Record<string, unknown>, handler: (a: any) => Promise<any>) => {
      tools[name] = { shape, handler };
    },
  };
}
