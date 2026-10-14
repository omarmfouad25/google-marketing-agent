import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, statSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPaths, loadConfig, saveConfig, loadCredentials, saveCredentials, ConfigError } from "../src/core/config.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gma-"));
  process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(dir, "accounts.json");
});

describe("config", () => {
  it("derives every path from the env override", () => {
    const p = configPaths();
    expect(p.dir).toBe(dir);
    expect(p.credentials).toBe(join(dir, "credentials.json"));
    expect(p.changes).toBe(join(dir, "changes"));
  });

  it("returns an empty config when no file exists", () => {
    expect(loadConfig()).toEqual({ accounts: {} });
  });

  it("round-trips and writes owner-only", () => {
    saveConfig({ default: "acme", accounts: { acme: { customerId: "1234567890", currency: "USD", timezone: "UTC" } } });
    expect(loadConfig().accounts.acme.customerId).toBe("1234567890");
    expect(statSync(join(dir, "accounts.json")).mode & 0o777).toBe(0o600);
  });

  it("names the file and the parse error for bad JSON", () => {
    writeFileSync(join(dir, "accounts.json"), "{ nope");
    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/accounts\.json/);
  });

  it("strips dashes from customer IDs", () => {
    writeFileSync(join(dir, "accounts.json"), JSON.stringify({ accounts: { a: { customerId: "123-456-7890", loginCustomerId: "987-654-3210", currency: "USD", timezone: "UTC" } } }));
    const a = loadConfig().accounts.a;
    expect(a.customerId).toBe("1234567890");
    expect(a.loginCustomerId).toBe("9876543210");
  });

  it("stores credentials owner-only", () => {
    expect(loadCredentials()).toBeUndefined();
    saveCredentials({ clientId: "id", clientSecret: "s", refreshToken: "r" });
    expect(loadCredentials()?.refreshToken).toBe("r");
    expect(statSync(join(dir, "credentials.json")).mode & 0o777).toBe(0o600);
  });

  it("tightens an existing config dir to 0700", () => {
    const sub = join(dir, "cfg");
    mkdirSync(sub, { mode: 0o755 });
    chmodSync(sub, 0o755);
    process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(sub, "accounts.json");
    saveConfig({ accounts: {} });
    expect(statSync(sub).mode & 0o777).toBe(0o700);
  });

  it("re-tightens a credentials file that existed at 0644", () => {
    const f = join(dir, "credentials.json");
    writeFileSync(f, "{}");
    chmodSync(f, 0o644);
    saveCredentials({ clientId: "id", clientSecret: "s", refreshToken: "r" });
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  it("accepts numeric customer IDs", () => {
    writeFileSync(join(dir, "accounts.json"), JSON.stringify({ accounts: { a: { customerId: 1234567890, currency: "USD", timezone: "UTC" } } }));
    expect(loadConfig().accounts.a.customerId).toBe("1234567890");
  });

  it("names the alias and field when customerId is missing", () => {
    writeFileSync(join(dir, "accounts.json"), JSON.stringify({ accounts: { acme: { currency: "USD" } } }));
    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/accounts\.json.*"acme".*customerId/);
  });

  it("rejects accounts that is not an object", () => {
    writeFileSync(join(dir, "accounts.json"), JSON.stringify({ accounts: [] }));
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("validates credential fields", () => {
    writeFileSync(join(dir, "credentials.json"), JSON.stringify({ clientId: "id" }));
    expect(() => loadCredentials()).toThrow(/clientSecret/);
  });

  it("never echoes credentials.json content on a parse error", () => {
    writeFileSync(join(dir, "credentials.json"), '{"refreshToken": "SECRETVALUE" oops');
    let err: Error | undefined;
    try { loadCredentials(); } catch (e) { err = e as Error; }
    expect(err).toBeInstanceOf(ConfigError);
    expect(err!.message).toMatch(/credentials\.json/);
    expect(err!.message).not.toMatch(/SECRETVALUE/);
    expect(err!.cause).toBeDefined();
  });

  it("treats an empty env override as unset", () => {
    process.env.GOOGLE_MARKETING_AGENT_CONFIG = "";
    expect(configPaths().accounts).toMatch(/\.config.google-marketing-agent.accounts\.json$/);
  });

  const bad = (profile: object, alias = "a") =>
    writeFileSync(join(dir, "accounts.json"), JSON.stringify({ accounts: { [alias]: { customerId: "1", currency: "USD", timezone: "UTC", ...profile } } }));

  it("rejects a writes value that is not a boolean", () => {
    bad({ writes: "false" });
    expect(() => loadConfig()).toThrow(/profile "a" field "writes"/);
    bad({ writes: true });
    expect(loadConfig().accounts.a.writes).toBe(true);
  });

  it("rejects a non-numeric guardrail", () => {
    bad({ guardrails: { maxBudgetChangePct: "fifty" } });
    expect(() => loadConfig()).toThrow(/profile "a" field "guardrails.maxBudgetChangePct"/);
  });

  it("rejects aliases that could escape the changes directory", () => {
    bad({}, "../x");
    expect(() => loadConfig()).toThrow(/alias "\.\.\/x"/);
  });
});
