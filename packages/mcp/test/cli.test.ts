import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { AccountStore } from "../src/core/context.js";
import { call } from "../src/cli.js";
import { fakeCustomer } from "./fakes.js";

const argsFile = (o: unknown) => {
  const f = join(mkdtempSync(join(tmpdir(), "gma-")), "a.json");
  writeFileSync(f, JSON.stringify(o));
  return f;
};

// never the real ~/.config: --apply writes the change log
beforeEach(() => {
  process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(mkdtempSync(join(tmpdir(), "gma-")), "accounts.json");
});
afterEach(() => vi.restoreAllMocks());

const credentials = { clientId: "i", clientSecret: "s", refreshToken: "r" };
const withAccount = () => {
  const customer = fakeCustomer();
  const store = new AccountStore({ config: { accounts: { a: { customerId: "1", currency: "USD", timezone: "UTC", writes: false } } }, credentials, makeCustomer: () => customer });
  return { customer, store };
};

describe("call", () => {
  it("runs a noAccount tool and prints its text", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await call("guide", argsFile({}), new AccountStore({ config: { accounts: {} }, credentials }))).toBe(0);
    expect(log).toHaveBeenCalled();
  });

  it("runs an account tool with valid args and prints the output", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { customer, store } = withAccount();
    expect(await call("get_account_summary", argsFile({}), store)).toBe(0);
    expect(customer.queries.length).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown tool", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await call("nope", argsFile({}), withAccount().store)).toBe(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Unknown tool "nope"'));
  });

  it("rejects invalid args before reaching the handler", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { customer, store } = withAccount();
    expect(await call("get_account_summary", argsFile({ dateRange: "bogus" }), store)).toBe(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("dateRange"));
    expect(customer.queries).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
  });

  describe("--apply", () => {
    const writable = () => {
      const customer = fakeCustomer();
      const store = new AccountStore({ config: { accounts: { a: { customerId: "1", currency: "USD", timezone: "UTC", writes: true } } }, credentials, makeCustomer: () => customer });
      return { customer, store };
    };
    const pause = { level: "campaign", ids: ["5"], status: "PAUSED" };
    const applied = (customer: ReturnType<typeof fakeCustomer>) => customer.calls.filter((c) => !c.options?.validate_only);
    const human = (supported: boolean, answer: "accept" | "decline") => ({ supported: () => supported, ask: vi.fn(async () => answer) });

    it("only previews without --apply", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const { customer, store } = writable();
      expect(await call("ads_set_status", argsFile(pause), store)).toBe(0);
      expect(log.mock.calls[0][0]).toMatch(/^PREVIEW \(nothing changed\)/);
      expect(applied(customer)).toHaveLength(0);
    });

    it("asks in a terminal and applies on yes, as human-approved", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const { customer, store } = writable();
      const h = human(true, "accept");
      expect(await call("ads_set_status", argsFile(pause), store, { apply: true, human: h })).toBe(0);
      expect(h.ask).toHaveBeenCalledWith(expect.stringMatching(/^Apply this change to profile "a"\?/));
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatch(/^APPLIED \(changeId: \w+, human-approved\)/);
      expect(applied(customer)).toHaveLength(1);
    });

    it("applies nothing and exits 1 when the terminal user says no", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const { customer, store } = writable();
      expect(await call("ads_set_status", argsFile(pause), store, { apply: true, human: human(true, "decline") })).toBe(1);
      expect(applied(customer)).toHaveLength(0);
    });

    it("prints the Preview then applies as preview-matched from a script", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const { customer, store } = writable();
      expect(await call("ads_set_status", argsFile(pause), store, { apply: true, human: human(false, "accept") })).toBe(0);
      expect(log.mock.calls.map((c) => c[0].split("\n")[0])).toEqual(["PREVIEW (nothing changed). Google validated 1 operation(s).", expect.stringMatching(/^APPLIED \(changeId: \w+, preview-matched\)/)]);
      expect(applied(customer)).toHaveLength(1);
    });
  });

  it("the built entry runs when invoked via a path containing spaces", () => {
    const dir = mkdtempSync(join(tmpdir(), "gma space "));
    const out = execFileSync(join(__dirname, "../../../node_modules/.bin/tsx"), [join(__dirname, "../src/cli.ts"), "help"], { cwd: dir, encoding: "utf8" });
    expect(out).toContain("google-marketing-agent <command>");
  });
});
