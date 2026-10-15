import { describe, it, expect } from "vitest";
import { AccountStore } from "../src/core/context.js";
import { registerAll } from "../src/server.js";
import { fakeCustomer, fakeServer } from "./fakes.js";

const credentials = { clientId: "id", clientSecret: "s", refreshToken: "r" };
const storeWith = (writes: boolean) =>
  new AccountStore({ config: { accounts: { a: { customerId: "1", currency: "USD", timezone: "UTC", writes } } }, credentials, makeCustomer: () => fakeCustomer() });

const NO_ACCOUNT = ["setup_doctor", "guide", "accounts_list", "use_account"];

describe("registerAll", () => {
  it("registers only read tools (incl. changes_list) when every profile is read-only", () => {
    const s = fakeServer();
    registerAll(s, storeWith(false));
    expect(Object.keys(s.tools)).toHaveLength(37);
    expect(s.tools.changes_list).toBeDefined();
    expect(s.tools.ads_set_status).toBeUndefined();
    expect(s.tools.ads_rollback).toBeUndefined();
    expect(s.tools.gtm_publish).toBeUndefined();
    expect(s.tools.ga4_set_key_event).toBeUndefined();
  });

  it("registers all tools when a profile is writable", () => {
    const s = fakeServer();
    registerAll(s, storeWith(true));
    expect(Object.keys(s.tools)).toHaveLength(63);
    expect(s.tools.ads_rollback).toBeDefined();
  });

  it("account_profile returns the resolved profile without credentials", async () => {
    const s = fakeServer();
    registerAll(s, storeWith(false));
    const out = JSON.parse((await s.tools.account_profile.handler({})).content[0].text);
    expect(out).toMatchObject({ alias: "a", customerId: "1", currency: "USD", writes: false });
    expect(JSON.stringify(out)).not.toMatch(/refreshToken|clientSecret/);
  });

  it("registers guide and the noAccount tools even with an empty config", () => {
    const s = fakeServer();
    registerAll(s, new AccountStore({ config: { accounts: {} }, credentials }));
    for (const n of NO_ACCOUNT) expect(s.tools[n], n).toBeDefined();
  });

  it("gives every account-scoped tool the account parameter", () => {
    const s = fakeServer();
    registerAll(s, storeWith(true));
    for (const [name, t] of Object.entries(s.tools)) {
      if (NO_ACCOUNT.includes(name)) expect(t.shape, name).not.toHaveProperty("account");
      else expect(t.shape, name).toHaveProperty("account");
    }
  });
});
