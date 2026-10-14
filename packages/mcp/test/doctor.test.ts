import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { runDoctor, renderDoctor, liveProbes, Probes } from "../src/core/doctor.js";
import { discoverAccounts } from "../src/core/discover.js";
import { registerAccountTools } from "../src/accounts/tools.js";
import { AccountStore } from "../src/core/context.js";
import { fakeCustomer, fakeServer } from "./fakes.js";
import { defineTool, text } from "../src/core/tool.js";

const ok = async () => {};
const fail = (message: string) => async () => { throw { errors: [{ message, error_code: { x: message } }] }; };
const base = (over: Partial<Probes> = {}): Probes => ({
  credentials: () => ({ clientId: "id", clientSecret: "s", refreshToken: "r" }),
  config: () => ({ accounts: { acme: { customerId: "111", currency: "USD", timezone: "UTC", ga4PropertyId: "9" } } }),
  listAccessible: async () => ["111"],
  adsRead: ok, keywordPlanner: fail("DEVELOPER_TOKEN_NOT_APPROVED"), ga4: ok, ga4Admin: ok, gsc: ok, gtm: ok,
  ...over,
});

describe("runDoctor", () => {
  it("stops at missing credentials with the init fix", async () => {
    const lines = await runDoctor(base({ credentials: () => undefined }));
    expect(lines).toEqual([{ ok: false, label: "Not signed in", fix: "Run: npx google-marketing-agent init" }]);
  });

  it("reports a healthy Explorer setup", async () => {
    const out = renderDoctor(await runDoctor(base()));
    expect(out).toContain("✓ acme: Google Ads customer 111 readable");
    expect(out).toContain("✓ Google Ads API access: Explorer (Keyword Planner needs Basic)");
    expect(out).toContain("✓ acme: GA4 property 9 readable");
    expect(out).toContain("✓ acme: GA4 Admin (key events) accessible");
    expect(out).not.toContain("GSC");
  });

  it("explains an expired token", async () => {
    const out = renderDoctor(await runDoctor(base({ listAccessible: async () => { throw new Error("invalid_grant"); } })));
    expect(out).toMatch(/✗ OAuth token[\s\S]*Testing.*7 days[\s\S]*init/);
  });

  it("explains Test-level access and a missing manager ID", async () => {
    const test = renderDoctor(await runDoctor(base({ adsRead: fail("The developer token is only approved for use with test accounts.") })));
    expect(test).toMatch(/Upgrade access level/);
    const mcc = renderDoctor(await runDoctor(base({ listAccessible: async () => ["999"], adsRead: fail("USER_PERMISSION_DENIED") })));
    expect(mcc).toMatch(/loginCustomerId/);
  });

  it("turns an API-disabled error into its enable link", async () => {
    const out = renderDoctor(await runDoctor(base({ ga4: async () => { throw new Error("Google Analytics Data API has not been used in project 123 before or it is disabled"); } })));
    expect(out).toContain("https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com");
  });

  it("checks GA4 Admin separately and links its API", async () => {
    const out = renderDoctor(await runDoctor(base({ ga4Admin: async () => { throw new Error("Google Analytics Admin API has not been used in project 1 before or it is disabled"); } })));
    expect(out).toContain("✓ acme: GA4 property 9 readable");
    expect(out).toContain("✗ acme: GA4 Admin");
    expect(out).toContain("analyticsadmin.googleapis.com");
  });

  it("probes Keyword Planner with the first profile that could be read", async () => {
    const seen: string[] = [];
    await runDoctor(base({
      config: () => ({ accounts: {
        bad: { customerId: "1", currency: "USD", timezone: "UTC" },
        good: { customerId: "2", currency: "USD", timezone: "UTC" },
      } }),
      adsRead: async (p) => { if (p.customerId === "1") throw new Error("USER_PERMISSION_DENIED"); },
      keywordPlanner: async (p) => { seen.push(p.customerId); },
    }));
    expect(seen).toEqual(["2"]);
  });

  it("does not call a non-permission planner failure Explorer", async () => {
    const out = renderDoctor(await runDoctor(base({ keywordPlanner: async () => { throw new Error("socket hang up"); } })));
    expect(out).toContain("✗ Google Ads API access: socket hang up");
    expect(out).not.toContain("Explorer");
  });

  it("warns when credentials.json is too open", async () => {
    const out = renderDoctor(await runDoctor(base({ credentialsTooOpen: () => true })));
    expect(out).toMatch(/✗ credentials.json is readable by other users\n\s+→ Run: chmod 600/);
  });
});

describe("liveProbes", () => {
  it("queries each profile's own customer and manager, not the default", async () => {
    const made: { id: string; login?: string; c: ReturnType<typeof fakeCustomer> }[] = [];
    const store = new AccountStore({
      config: { default: "a", accounts: {
        a: { customerId: "111", currency: "USD", timezone: "UTC" },
        b: { customerId: "222", loginCustomerId: "999", currency: "USD", timezone: "UTC" },
      } },
      credentials: { clientId: "id", clientSecret: "s", refreshToken: "r" },
      makeCustomer: (p) => {
        const c = fakeCustomer();
        (c as any).keywordPlanIdeas = { generateKeywordIdeas: async () => {} };
        made.push({ id: p.customerId, login: p.loginCustomerId, c });
        return c;
      },
    });
    const probes = liveProbes(store);
    await runDoctor({ ...probes, listAccessible: async () => ["111"], ga4: ok, ga4Admin: ok, gsc: ok, gtm: ok });
    for (const id of ["111", "222"]) expect(made.find((m) => m.id === id)?.c.queries.length).toBeGreaterThan(0);
    expect(made.find((m) => m.id === "222")?.login).toBe("999");
    // the planner probe follows the first readable profile (a), and a's read never touched b
    expect(made.find((m) => m.id === "111")?.c.queries).toHaveLength(1);
  });
});

describe("discoverAccounts", () => {
  const rows = (...r: [number, string, boolean][]) => ({
    customer_client: r.map(([id, name, manager]) => ({ customer_client: { id, descriptive_name: name, manager, currency_code: "USD", time_zone: "UTC" } })),
  });
  it("lists direct accounts and manager children with their login manager", async () => {
    const trees: Record<string, ReturnType<typeof rows>> = {
      "100": rows([100, "Agency", true], [200, "Client A", false], [300, "Client B", false]),
      "300": rows([300, "Client B", false]),
    };
    const out = await discoverAccounts({
      listAccessible: async () => ["100", "300"],
      customer: (id) => fakeCustomer(trees[id]),
    });
    expect(out.map((a) => [a.id, a.manager, a.loginCustomerId])).toEqual([
      ["100", true, undefined],
      ["200", false, "100"],
      ["300", false, undefined], // reachable directly: no manager needed
    ]);
  });

  it("still lists an account whose tree can't be read", async () => {
    const out = await discoverAccounts({
      listAccessible: async () => ["5"],
      customer: () => ({ query: async () => { throw new Error("boom"); } }),
    });
    expect(out).toMatchObject([{ id: "5", name: "(not readable: boom)" }]);
  });
});

describe("account tools", () => {
  const empty = () => new AccountStore({ config: { accounts: {} }, credentials: undefined });
  it("work with zero profiles and register without an account param", async () => {
    const server = fakeServer();
    const tool = ((name: string, d: string, shape: any, h: any, opts: any) => {
      expect(opts).toEqual({ noAccount: true });
      server.tool(name, d, shape, h);
    }) as any;
    registerAccountTools(tool, empty(), () => ({ listAccessible: async () => ["7"], customer: () => fakeCustomer({ customer_client: [{ customer_client: { id: 7, descriptive_name: "Solo", manager: false, currency_code: "USD", time_zone: "UTC" } }] }) }));
    expect(Object.keys(server.tools)).toEqual(["setup_doctor", "accounts_list", "use_account"]);
    expect((await server.tools.setup_doctor!.handler({})).content[0].text).toContain("Not signed in");
    expect((await server.tools.accounts_list!.handler({})).content[0].text).toContain("- 7 Solo (USD) → no profile");
  });

  it("use_account switches the session default and rejects unknown aliases", async () => {
    const store = new AccountStore({ config: { default: "a", accounts: { a: { customerId: "1", currency: "USD", timezone: "UTC" }, b: { customerId: "2", currency: "USD", timezone: "UTC" } } }, credentials: undefined });
    const server = fakeServer();
    registerAccountTools(server.tool as any, store);
    await server.tools.use_account!.handler({ alias: "b" });
    expect(store.context().alias).toBe("b");
    await expect(server.tools.use_account!.handler({ alias: "zzz" })).rejects.toThrow(/Unknown account/);
  });
});

describe("broken config files", () => {
  const withEnv = async (dir: string, fn: () => Promise<void>) => {
    const old = process.env.GOOGLE_MARKETING_AGENT_CONFIG;
    process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(dir, "accounts.json");
    try { await fn(); } finally { old === undefined ? delete process.env.GOOGLE_MARKETING_AGENT_CONFIG : (process.env.GOOGLE_MARKETING_AGENT_CONFIG = old); }
  };
  const doctorText = async (store: AccountStore) => {
    const server = fakeServer();
    registerAccountTools(server.tool as any, store);
    return (await server.tools.setup_doctor!.handler({})).content[0].text as string;
  };

  it("reports malformed accounts.json from setup_doctor without throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gma-"));
    writeFileSync(join(dir, "accounts.json"), "{ nope");
    await withEnv(dir, async () => {
      const store = new AccountStore();
      const out = await doctorText(store);
      expect(out).toContain("✗ Can't read " + join(dir, "accounts.json"));
      expect(out).toContain("Fix the JSON / field shown, or re-run npx google-marketing-agent init");
      expect(() => store.context()).toThrow(/accounts\.json/);
    });
  });

  it("reports a credentials.json missing clientSecret", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gma-"));
    writeFileSync(join(dir, "credentials.json"), JSON.stringify({ clientId: "a", refreshToken: "b" }));
    await withEnv(dir, async () => {
      const store = new AccountStore();
      expect(await doctorText(store)).toContain('✗ Invalid ' + join(dir, "credentials.json") + ': field "clientSecret"');
      expect(() => store.credentials()).toThrow(/clientSecret/);
    });
  });

  it("makes a normal tool return ERROR with the path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gma-"));
    writeFileSync(join(dir, "accounts.json"), "{ nope");
    await withEnv(dir, async () => {
      const store = new AccountStore();
      const tools: Record<string, any> = {};
      const server = { tool: (n: string, _d: string, _s: unknown, h: any) => { tools[n] = h; } } as any;
      defineTool(server, store)("probe", "x", {}, async () => text("ran"));
      expect((await tools.probe({})).content[0].text).toMatch(/^ERROR: Can't read .*accounts\.json/);
    });
  });
});

describe("accounts_list limits and reasons", () => {
  it("caps at 200 rows and shows why an account is unreadable", async () => {
    const many = Array.from({ length: 205 }, (_, i) => ({ customer_client: { id: 1000 + i, descriptive_name: "A", manager: false, currency_code: "USD", time_zone: "UTC" } }));
    const server = fakeServer();
    registerAccountTools(server.tool as any, new AccountStore({ config: { accounts: {} }, credentials: undefined }), () => ({
      listAccessible: async () => ["1", "2"],
      customer: (id) => id === "1" ? fakeCustomer({ customer_client: many }) : ({ query: async () => { throw new Error("CUSTOMER_NOT_ENABLED"); } }),
    }));
    const out = (await server.tools.accounts_list!.handler({})).content[0].text as string;
    expect(out).toContain("…and 6 more"); // 205 + the unreadable root
    expect(out.split("\n").length).toBe(201);
  });

  it("names the unreadable reason", async () => {
    const out = await discoverAccounts({ listAccessible: async () => ["5"], customer: () => ({ query: async () => { throw new Error("CUSTOMER_NOT_ENABLED"); } }) });
    expect(out[0]!.name).toBe("(not readable: CUSTOMER_NOT_ENABLED)");
  });
});

describe("targeted fixes", () => {
  it("names the existing loginCustomerId, anchors 403, names the GSC role", async () => {
    const withLogin = base({ config: () => ({ accounts: { a: { customerId: "1", loginCustomerId: "77", currency: "USD", timezone: "UTC", gscSiteUrl: "sc-domain:x.test" } } }), adsRead: fail("USER_PERMISSION_DENIED"), gsc: fail("PERMISSION_DENIED") });
    const out = renderDoctor(await runDoctor(withLogin));
    expect(out).toContain("loginCustomerId 77 is the manager that owns this account");
    expect(out).toContain("Full or Restricted user");
    const num = renderDoctor(await runDoctor(base({ ga4: async () => { throw new Error("quota 14031 exceeded"); } })));
    expect(num).toContain("See docs/troubleshooting.md");
  });
});
