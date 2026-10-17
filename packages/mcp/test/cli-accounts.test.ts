import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountsCommand, setField } from "../src/cli/accounts.js";
import { InitDeps, addProfiles, initCommand } from "../src/cli/init.js";
import { SCOPES, handleCallback, signIn } from "../src/cli/oauth.js";
import { loadConfig, saveConfig, saveCredentials } from "../src/core/config.js";

const config = () => ({ default: "acme", accounts: { acme: { customerId: "1", currency: "USD", timezone: "UTC" } } });

describe("setField", () => {
  it("coerces booleans, numbers and lists", () => {
    let c = setField(config(), "acme", "writes", "true");
    expect(c.accounts.acme.writes).toBe(true);
    c = setField(c, "acme", "guardrails.maxBudgetChangePct", "30");
    expect(c.accounts.acme.guardrails?.maxBudgetChangePct).toBe(30);
    c = setField(c, "acme", "geos", "2840, 2124");
    expect(c.accounts.acme.geos).toEqual(["2840", "2124"]);
    c = setField(c, "acme", "gscSiteUrl", "sc-domain:acme.com");
    expect(c.accounts.acme.gscSiteUrl).toBe("sc-domain:acme.com");
  });

  it("rejects unknown aliases, unknown fields and bad values", () => {
    expect(() => setField(config(), "nope", "writes", "true")).toThrow(/Unknown profile "nope"/);
    expect(() => setField(config(), "acme", "colour", "red")).toThrow(/Unknown field "colour"/);
    expect(() => setField(config(), "acme", "__proto__.x", "1")).toThrow(/Unknown field/);
    for (const alias of ["__proto__", "constructor", "toString"]) expect(() => setField(config(), alias, "writes", "true")).toThrow(/Unknown profile/);
    expect((({}) as any).writes).toBeUndefined();
    expect(() => setField(config(), "acme", "customerId", "abc")).toThrow(/numeric/);
    expect(() => setField(config(), "acme", "guardrails.maxBudgetChangePct", "1e3")).toThrow(/positive number/);
    expect(() => setField(config(), "acme", "guardrails.maxBudgetChangePct", "0x10")).toThrow(/positive number/);
    expect(setField(config(), "acme", "customerId", "123-456-7890").accounts.acme.customerId).toBe("1234567890");
    expect(() => setField(config(), "acme", "writes", "yes")).toThrow(/true or false/);
    expect(() => setField(config(), "acme", "guardrails.maxBudgetChangePct", "-5")).toThrow(/positive number/);
  });
});

describe("commands (temp config dir, injected deps)", () => {
  beforeEach(() => {
    process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(mkdtempSync(join(tmpdir(), "gma-cfg-")), "accounts.json");
  });
  afterEach(() => {
    delete process.env.GOOGLE_MARKETING_AGENT_CONFIG;
    vi.restoreAllMocks();
  });

  const deps = (answers: string[], logs: string[] = []): InitDeps => ({
    ask: async () => answers.shift() ?? "",
    signIn: vi.fn(async () => "REFRESH-SECRET"),
    discover: async () => [
      { id: "900", name: "Agency MCC", manager: true, currency: "EUR", timezone: "UTC" },
      { id: "111", name: "Shop One", manager: false, currency: "EUR", timezone: "Europe/Berlin", loginCustomerId: "900" },
    ],
    log: (l) => logs.push(l),
    close: () => {},
  });

  it("init signs in, writes 0600 files, read-only profiles, discovered currency, no invented geos, no secrets printed", async () => {
    const logs: string[] = [];
    const d = deps(["cid", "CLIENT-SECRET", "1", "", "123456", "", ""], logs);
    expect(await initCommand({}, () => d)).toBe(0);
    expect(d.signIn).toHaveBeenCalledWith("cid", "CLIENT-SECRET");
    const cfgPath = process.env.GOOGLE_MARKETING_AGENT_CONFIG!;
    for (const f of [cfgPath, join(cfgPath, "..", "credentials.json")]) expect(statSync(f).mode & 0o777).toBe(0o600);
    const c = loadConfig();
    expect(c.default).toBe("shop-one");
    expect(c.accounts["shop-one"]).toEqual({
      customerId: "111", loginCustomerId: "900", currency: "EUR", timezone: "Europe/Berlin", writes: false, ga4PropertyId: "123456",
    });
    expect(logs.join("\n")).not.toMatch(/REFRESH-SECRET|CLIENT-SECRET/);
    expect(logs.join("\n")).toMatch(/Desktop app[\s\S]*docs\/setup\.md/); // first-run users learn where the client comes from
  });

  it("--service-account stores the path only and rejects a missing file", async () => {
    await expect(initCommand({ serviceAccount: "/no/such/key.json" }, () => deps([]))).rejects.toThrow(/not found/);
    const dir = mkdtempSync(join(tmpdir(), "gma-sa-"));
    const key = join(dir, "key.json");
    writeFileSync(key, '{"private_key":"KEY-CONTENTS"}');
    await initCommand({ serviceAccount: key }, () => deps(["cid", "sec", "1", "", "", "", ""]));
    const raw = readFileSync(join(process.env.GOOGLE_MARKETING_AGENT_CONFIG!, "..", "credentials.json"), "utf8");
    expect(JSON.parse(raw).serviceAccountKey).toBe(key);
    expect(raw).not.toContain("KEY-CONTENTS");
  });

  it("accounts set / default persist; list prints profiles", async () => {
    saveConfig({ accounts: { a: { customerId: "1", currency: "USD", timezone: "UTC" }, b: { customerId: "2", currency: "USD", timezone: "UTC" } } });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await accountsCommand(["set", "a", "writes", "true"])).toBe(0);
    expect(await accountsCommand(["default", "b"])).toBe(0);
    expect(loadConfig().accounts.a.writes).toBe(true);
    expect(loadConfig().default).toBe("b");
    await accountsCommand([]);
    expect(log.mock.calls.flat().join("\n")).toMatch(/\* b {2}2/);
    await expect(accountsCommand(["default", "zzz"])).rejects.toThrow(/Unknown profile/);
    await expect(accountsCommand(["set", "a", "writes"])).rejects.toThrow(/Usage/);
  });

  it("requests the full scope set", () => {
    expect(SCOPES).toHaveLength(8);
    expect(SCOPES).toContain("https://www.googleapis.com/auth/adwords");
    expect(SCOPES).toContain("https://www.googleapis.com/auth/tagmanager.publish");
  });

  it("re-picking an existing alias merges only discovered fields and keeps writes", async () => {
    saveConfig({ accounts: { "shop-one": { customerId: "old", currency: "USD", timezone: "UTC", writes: true, geos: ["1"], loginCustomerId: "5" } } });
    saveCredentials({ clientId: "c", clientSecret: "s", refreshToken: "r" });
    const d = deps(["1", ""]);
    expect(await addProfiles(d)).toBe(0);
    expect(loadConfig().accounts["shop-one"]).toEqual({
      customerId: "111", loginCustomerId: "900", currency: "EUR", timezone: "Europe/Berlin", writes: true, geos: ["1"],
    });
  });

  it("zero picks is an error; bad alias rejected; flagless default prints usage", async () => {
    saveCredentials({ clientId: "c", clientSecret: "s", refreshToken: "r" });
    expect(await addProfiles(deps(["9"]))).toBe(1);
    await expect(addProfiles(deps(["1", "__proto__"]))).rejects.toThrow(/Invalid alias/);
    await expect(accountsCommand(["default"])).rejects.toThrow(/Usage/);
    await expect(accountsCommand(["default", "__proto__"])).rejects.toThrow(/Unknown profile/);
  });

  it("stores the resolved service account path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gma-sa-"));
    writeFileSync(join(dir, "k.json"), "{}");
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await initCommand({ serviceAccount: "k.json" }, () => deps(["cid", "sec", "1", "", "", "", ""]));
    } finally {
      process.chdir(cwd);
    }
    const saved = JSON.parse(readFileSync(join(process.env.GOOGLE_MARKETING_AGENT_CONFIG!, "..", "credentials.json"), "utf8"));
    expect(saved.serviceAccountKey).toBe(realpathSync(join(dir, "k.json")));
  });
});

describe("oauth callback", () => {
  const base = "http://127.0.0.1:1234";
  it("accepts the right state with a code", () => {
    expect(handleCallback("/?code=abc&state=S", base, "S")).toMatchObject({ status: 200, done: { code: "abc" } });
  });
  it("rejects a mismatched or missing state without finishing", () => {
    expect(handleCallback("/?code=abc&state=X", base, "S")).toEqual({ status: 400, body: expect.any(String) });
    expect(handleCallback("/?code=abc", base, "S").done).toBeUndefined();
  });
  it("surfaces the error param (state-checked) and ignores stray requests", () => {
    expect(handleCallback("/?error=access_denied&state=S", base, "S").done).toEqual({ error: expect.stringContaining("access_denied") });
    expect(handleCallback("/?error=x&state=bad", base, "S").done).toBeUndefined();
    expect(handleCallback("/favicon.ico", base, "S").status).toBe(404);
  });
  it("times out and frees the port", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(signIn("c", "s", 50, () => {})).rejects.toThrow(/timed out/);
  });
});
