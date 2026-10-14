import { afterEach, describe, it, expect, vi } from "vitest";
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

  it("the built entry runs when invoked via a path containing spaces", () => {
    const dir = mkdtempSync(join(tmpdir(), "gma space "));
    const out = execFileSync(join(__dirname, "../../../node_modules/.bin/tsx"), [join(__dirname, "../src/cli.ts"), "help"], { cwd: dir, encoding: "utf8" });
    expect(out).toContain("google-marketing-agent <command>");
  });
});
