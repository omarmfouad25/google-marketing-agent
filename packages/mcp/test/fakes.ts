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

export type GtmState = {
  tags: any[]; triggers: any[]; variables: any[];
  builtIns: { name: string; type: string }[];
  headers: any[]; versions: Record<string, any>; live: any; changes: any[];
};
export const WS = "accounts/1/containers/2/workspaces/3";

export function fakeGtm(init: Partial<GtmState> = {}) {
  const state: GtmState = { tags: [], triggers: [], variables: [], builtIns: [], headers: [], versions: {}, live: { containerVersionId: "1", tag: [] }, changes: [], ...init };
  const calls: { method: string; args: any }[] = [];
  const idKey = { tags: "tagId", triggers: "triggerId", variables: "variableId" } as const;
  const one = { tags: "tag", triggers: "trigger", variables: "variable" } as const;
  const entity = (e: keyof typeof idKey) => ({
    list: async () => ({ data: { [one[e]]: state[e] } }),
    get: async ({ path }: { path: string }) => {
      const found = state[e].find((x) => x[idKey[e]] === path.split("/").pop());
      if (!found) throw new Error(`Not found: ${path}`);
      return { data: found };
    },
    create: async (args: any) => {
      calls.push({ method: `${e}.create`, args });
      const id = String(100 + state[e].length);
      const data = { ...args.requestBody, [idKey[e]]: id, path: `${WS}/${e}/${id}`, fingerprint: "f1" };
      state[e].push(data);
      return { data };
    },
    update: async (args: any) => {
      calls.push({ method: `${e}.update`, args });
      const i = state[e].findIndex((x) => x.path === args.path || x[idKey[e]] === args.path.split("/").pop());
      state[e][i] = { ...args.requestBody, fingerprint: "f2" };
      return { data: state[e][i] };
    },
    delete: async (args: any) => {
      calls.push({ method: `${e}.delete`, args });
      state[e] = state[e].filter((x) => x[idKey[e]] !== args.path.split("/").pop());
      return { data: {} };
    },
  });
  const api = {
    accounts: {
      list: async () => ({ data: { account: [{ path: "accounts/1", name: "Acme" }] } }),
      containers: {
        list: async () => ({ data: { container: [{ publicId: "GTM-TEST", path: "accounts/1/containers/2", name: "Acme site" }] } }),
        version_headers: { list: async () => ({ data: { containerVersionHeader: state.headers } }) },
        versions: {
          live: async () => ({ data: state.live }),
          get: async ({ path }: { path: string }) => ({ data: state.versions[path.split("/").pop()!] }),
          publish: async (args: any) => (calls.push({ method: "versions.publish", args }), { data: {} }),
        },
        workspaces: {
          list: async () => ({ data: { workspace: [{ workspaceId: "3", name: "Default Workspace", path: WS }] } }),
          getStatus: async () => ({ data: { workspaceChange: state.changes, mergeConflict: [] } }),
          tags: entity("tags"),
          triggers: entity("triggers"),
          variables: entity("variables"),
          built_in_variables: {
            list: async () => ({ data: { builtInVariable: state.builtIns } }),
            create: async (args: any) => {
              calls.push({ method: "built_in_variables.create", args });
              return { data: { builtInVariable: args.type.map((type: string) => ({ type, name: type })) } };
            },
            delete: async (args: any) => (calls.push({ method: "built_in_variables.delete", args }), { data: {} }),
          },
        },
      },
    },
  };
  return { api, state, calls };
}
