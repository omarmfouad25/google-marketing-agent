import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { google } from "googleapis";
import { AccountStore } from "../src/core/context.js";
import { defineTool } from "../src/core/tool.js";
import { registerGa4AdminTools } from "../src/ga4/admin.js";
import { listChanges } from "../src/core/changelog.js";
import { fakeServer } from "./fakes.js";

const credentials = { clientId: "id", clientSecret: "s", refreshToken: "r" };
const existing = { name: "properties/5/customDimensions/1", parameterName: "form_name", displayName: "Form name", scope: "EVENT" };
let calls: { method: string; args: any }[];
let server: ReturnType<typeof fakeServer>;

function setup(writes = true) {
  process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(mkdtempSync(join(tmpdir(), "gma-")), "accounts.json");
  calls = [];
  const properties = {
    customDimensions: {
      list: async () => ({ data: { customDimensions: [existing] } }),
      create: async (args: any) => (calls.push({ method: "create", args }), { data: { name: "properties/5/customDimensions/2", ...args.requestBody } }),
      archive: async (args: any) => (calls.push({ method: "archive", args }), { data: {} }),
    },
    customMetrics: { list: async () => ({ data: { customMetrics: [{ parameterName: "lead_score", displayName: "Lead score" }] } }) },
  };
  vi.spyOn(google, "analyticsadmin").mockReturnValue({ properties } as any);
  const store = new AccountStore({ config: { accounts: { acme: { customerId: "1", currency: "USD", timezone: "UTC", ga4PropertyId: "5", writes } } }, credentials });
  server = fakeServer();
  registerGa4AdminTools(defineTool(server as any, store), { writes });
}
const run = async (args: Record<string, unknown>) => (await server.tools.ga4_custom_dimensions.handler(args)).content[0].text as string;
afterEach(() => vi.restoreAllMocks());

describe("ga4_custom_dimensions", () => {
  it("lists dimensions and metrics on a read-only profile", async () => {
    setup(false);
    const r = JSON.parse(await run({ action: "list" }));
    expect(r.dimensions).toEqual([{ name: existing.name, parameterName: "form_name", displayName: "Form name", scope: "EVENT" }]);
    expect(r.metrics[0].parameterName).toBe("lead_score");
  });

  it("refuses create on a read-only profile", async () => {
    setup(false);
    expect(await run({ action: "create", parameterName: "lead_type", displayName: "Lead type", confirm: true })).toMatch(/^REFUSED/);
    expect(calls).toEqual([]);
  });

  it("previews, refuses duplicates, then creates with EVENT scope by default and logs", async () => {
    setup();
    expect(await run({ action: "create", parameterName: "form_name", displayName: "Form name" })).toMatch(/already registered/);
    expect(await run({ action: "create", parameterName: "lead_type", displayName: "Lead type" })).toMatch(/CREATE EVENT custom dimension "Lead type" \(lead_type\) \(nothing changed\)/);
    expect(calls).toEqual([]);
    await run({ action: "create", parameterName: "lead_type", displayName: "Lead type", confirm: true });
    expect(calls[0]).toEqual({ method: "create", args: { parent: "properties/5", requestBody: { parameterName: "lead_type", displayName: "Lead type", scope: "EVENT" } } });
    expect(listChanges("acme", 5)[0]).toMatchObject({ product: "ga4", tool: "ga4_custom_dimensions" });
  });

  it("archives a dimension by name", async () => {
    setup();
    const preview = await run({ action: "archive", name: existing.name });
    expect(preview).toMatch(/ARCHIVE custom dimension "Form name"/);
    expect(preview).toMatch(/can't be restored/);
    expect(calls).toEqual([]);
    await run({ action: "archive", name: existing.name, confirm: true });
    expect(calls[0]).toEqual({ method: "archive", args: { name: existing.name } });
    expect(await run({ action: "archive", name: "properties/5/customDimensions/999" })).toMatch(/not found/);
  });

  it("refuses archive on a read-only profile", async () => {
    setup(false);
    expect(await run({ action: "archive", name: existing.name, confirm: true })).toMatch(/^REFUSED/);
    expect(calls).toEqual([]);
  });

  it("validates inputs", async () => {
    setup();
    expect(await run({ action: "create", displayName: "x" })).toMatch(/parameterName/);
    expect(await run({ action: "archive" })).toMatch(/name/);
  });
});
