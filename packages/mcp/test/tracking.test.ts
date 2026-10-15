import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { google } from "googleapis";
import { AccountStore } from "../src/core/context.js";
import { defineTool } from "../src/core/tool.js";
import { registerGtmTools } from "../src/gtm/tools.js";
import { registerGa4AdminTools } from "../src/ga4/admin.js";
import { fakeCustomer, fakeServer } from "./fakes.js";

const credentials = { clientId: "id", clientSecret: "s", refreshToken: "r" };
const store = new AccountStore({
  config: { accounts: { ro: { customerId: "1", currency: "USD", timezone: "UTC" } } },
  credentials,
  makeCustomer: () => fakeCustomer(),
});

describe("tracking tools", () => {
  it("register write tools only when writes are enabled somewhere", () => {
    const off = fakeServer();
    registerGtmTools(defineTool(off as any, store), { writes: false });
    registerGa4AdminTools(defineTool(off as any, store), { writes: false });
    expect(Object.keys(off.tools).sort()).toEqual(["ga4_custom_dimensions", "ga4_list_key_events", "gtm_builtin_variables", "gtm_get", "gtm_list", "gtm_list_containers", "gtm_live_check", "gtm_overview", "gtm_versions"]);
  });

  it("explain a missing container instead of using a default", async () => {
    const s = fakeServer();
    registerGtmTools(defineTool(s as any, store), { writes: false });
    const r = await s.tools.gtm_overview.handler({});
    expect(r.content[0].text).toMatch(/Profile "ro" has no gtmContainerId/);
  });

  it("refuse writes on a read-only profile", async () => {
    const s = fakeServer();
    registerGtmTools(defineTool(s as any, store), { writes: true });
    registerGa4AdminTools(defineTool(s as any, store), { writes: true });
    const r = await s.tools.gtm_publish.handler({ container: "GTM-TEST", confirm: true });
    expect(r.content[0].text).toMatch(/^REFUSED/);
    const g = await s.tools.ga4_set_key_event.handler({ eventName: "x", action: "create", confirm: true });
    expect(g.content[0].text).toMatch(/^REFUSED/);
  });

  it("reports APPLIED but NOT LOGGED when the change log can't be written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gma-"));
    writeFileSync(join(dir, "blocker"), "x"); // a file where the config dir should be
    process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(dir, "blocker", "accounts.json");
    const rw = new AccountStore({ config: { accounts: { rw: { customerId: "1", currency: "USD", timezone: "UTC", ga4PropertyId: "5", writes: true } } }, credentials });
    const keyEvents = {
      list: async () => ({ data: {} }),
      create: async () => ({ data: { name: "properties/5/keyEvents/9" } }),
    };
    const spy = vi.spyOn(google, "analyticsadmin").mockReturnValue({ properties: { keyEvents } } as any);
    const s = fakeServer();
    registerGa4AdminTools(defineTool(s as any, rw), { writes: true });
    const r = await s.tools.ga4_set_key_event.handler({ eventName: "x", action: "create", confirm: true });
    spy.mockRestore();
    expect(r.content[0].text).toMatch(/^APPLIED but NOT LOGGED/);
  });
});
