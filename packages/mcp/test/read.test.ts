import { describe, it, expect } from "vitest";
import { AccountStore } from "../src/core/context.js";
import { defineTool } from "../src/core/tool.js";
import { z } from "zod";
import { buildDateClause, campaignPerformance, keywordPerformance } from "../src/ads/queries.js";
import { registerAdsReadTools } from "../src/ads/read.js";
import { registerGa4ReadTools } from "../src/ga4/read.js";
import { registerGscReadTools } from "../src/gsc/read.js";
import { parseDates } from "../src/ads/read.js";
import { searchAnalytics } from "../src/gsc/client.js";
import { fakeCustomer, fakeServer } from "./fakes.js";

const credentials = { clientId: "id", clientSecret: "s", refreshToken: "r" };

describe("buildDateClause", () => {
  it("passes GAQL ranges through", () => {
    expect(buildDateClause("LAST_7_DAYS")).toBe("segments.date DURING LAST_7_DAYS");
    expect(buildDateClause()).toBe("segments.date DURING LAST_30_DAYS");
  });

  it("turns LAST_90_DAYS into BETWEEN (GAQL has no such range)", () => {
    const clause = buildDateClause("LAST_90_DAYS", undefined, new Date("2026-10-14T12:00:00Z"));
    expect(clause).toBe("segments.date BETWEEN '2026-07-16' AND '2026-10-13'");
  });

  it("computes quarter and year ranges (not valid GAQL DURING values)", () => {
    const t = new Date("2026-10-14T12:00:00Z");
    const between = (a: string, b: string) => `segments.date BETWEEN '${a}' AND '${b}'`;
    expect(buildDateClause("THIS_QUARTER", undefined, t)).toBe(between("2026-10-01", "2026-10-13"));
    expect(buildDateClause("LAST_QUARTER", undefined, t)).toBe(between("2026-07-01", "2026-09-30"));
    expect(buildDateClause("THIS_YEAR", undefined, t)).toBe(between("2026-01-01", "2026-10-13"));
    expect(buildDateClause("LAST_YEAR", undefined, t)).toBe(between("2025-01-01", "2025-12-31"));
    expect(buildDateClause("LAST_QUARTER", undefined, new Date("2026-02-10T00:00:00Z"))).toBe(between("2025-10-01", "2025-12-31"));
  });

  it("covers just today on the first day of a quarter or year", () => {
    const between = (d: string) => `segments.date BETWEEN '${d}' AND '${d}'`;
    expect(buildDateClause("THIS_QUARTER", undefined, new Date("2026-10-01T12:00:00Z"))).toBe(between("2026-10-01"));
    expect(buildDateClause("THIS_YEAR", undefined, new Date("2026-01-01T12:00:00Z"))).toBe(between("2026-01-01"));
  });

  it("rejects injected dates and campaign ids in the builders", () => {
    expect(() => buildDateClause(undefined, { from: "2026-01-01'", to: "2026-01-31" })).toThrow(/YYYY-MM-DD/);
    expect(() => campaignPerformance(undefined, undefined, "ENABLED' OR 1=1")).toThrow(/status/);
    expect(() => keywordPerformance(undefined, undefined, "1 OR 1=1")).toThrow(/numeric/);
  });

  it("uses a custom range when given", () => {
    expect(buildDateClause(undefined, { from: "2026-01-01", to: "2026-01-31" })).toBe(
      "segments.date BETWEEN '2026-01-01' AND '2026-01-31'"
    );
  });
});

describe("read tools", () => {
  it("query the Google Ads account of the profile named by the alias", async () => {
    const customers: Record<string, ReturnType<typeof fakeCustomer>> = {
      "111": fakeCustomer({ customer: [{ customer: { id: 111 }, metrics: { cost_micros: 2_000_000 } }] }),
      "222": fakeCustomer({ customer: [{ customer: { id: 222 }, metrics: { cost_micros: 5_000_000 } }] }),
    };
    const store = new AccountStore({
      config: { default: "a", accounts: { a: { customerId: "111", currency: "USD", timezone: "UTC" }, b: { customerId: "222", currency: "USD", timezone: "UTC" } } },
      credentials,
      makeCustomer: (p) => customers[p.customerId],
    });
    const server = fakeServer();
    registerAdsReadTools(defineTool(server as any, store));
    const r = await server.tools.get_account_summary.handler({ profile: "b", format: "json" });
    expect(r.content[0].text).toContain('"cost": 5');
    expect(customers["111"].queries).toHaveLength(0);
  });

  it("explain a missing GA4 property instead of using a default", async () => {
    const store = new AccountStore({
      config: { accounts: { a: { customerId: "111", currency: "USD", timezone: "UTC" } } },
      credentials,
      makeCustomer: () => fakeCustomer(),
    });
    const server = fakeServer();
    registerGa4ReadTools(defineTool(server as any, store));
    const r = await server.tools.ga4_traffic_overview.handler({});
    expect(r.content[0].text).toMatch(/Profile "a" has no ga4PropertyId/);
  });

  it("explain a missing GSC site, and keep every 005 tool name", async () => {
    const store = new AccountStore({
      config: { accounts: { a: { customerId: "111", currency: "USD", timezone: "UTC" } } },
      credentials,
      makeCustomer: () => fakeCustomer(),
    });
    const server = fakeServer();
    const tool = defineTool(server as any, store);
    registerAdsReadTools(tool);
    registerGa4ReadTools(tool);
    registerGscReadTools(tool);
    expect(Object.keys(server.tools).sort()).toEqual(
      ["get_account_summary","get_campaign_performance","get_adgroup_performance","get_keyword_performance","get_search_terms","get_performance_by_date","get_campaign_budgets","run_gaql_query",
       "ga4_traffic_overview","ga4_top_pages","ga4_traffic_sources","ga4_user_demographics","ga4_conversions","ga4_landing_pages","ga4_realtime","ga4_custom_report",
       "gsc_search_analytics","gsc_top_queries","gsc_top_pages","gsc_query_page_matrix","gsc_index_status","gsc_sitemaps"].sort()
    );
    const r = await server.tools.gsc_sitemaps.handler({});
    expect(r.content[0].text).toMatch(/Profile "a" has no gscSiteUrl/);
  });
});

describe("input validation", () => {
  it("rejects injection at the schema and one-sided dates in parseDates", async () => {
    const store = new AccountStore({
      config: { accounts: { a: { customerId: "111", currency: "USD", timezone: "UTC" } } },
      credentials,
      makeCustomer: () => fakeCustomer(),
    });
    const server = fakeServer();
    registerAdsReadTools(defineTool(server as any, store));
    const schema = z.object(server.tools.get_keyword_performance.shape as z.ZodRawShape);
    expect(schema.safeParse({ campaignId: "1 OR 1=1" }).success).toBe(false);
    expect(schema.safeParse({ campaignId: "123" }).success).toBe(true);
    expect(schema.safeParse({ dateFrom: "2026-01-01'", dateTo: "2026-01-31" }).success).toBe(false);
    expect(() => parseDates({ dateFrom: "2026-01-01" })).toThrow(/give both dateFrom and dateTo/);
  });

  it("rejects a lone dateFrom in the GSC client", async () => {
    const store = new AccountStore({
      config: { accounts: { a: { customerId: "111", currency: "USD", timezone: "UTC", gscSiteUrl: "https://example.com/" } } },
      credentials,
      makeCustomer: () => fakeCustomer(),
    });
    await expect(searchAnalytics(store.context("a"), { dateFrom: "2026-01-01" })).rejects.toThrow(/give both dateFrom and dateTo/);
  });
});
