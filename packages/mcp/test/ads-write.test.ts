import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "../src/core/context.js";
import { defineTool } from "../src/core/tool.js";
import { registerAdsWriteTools } from "../src/ads/write/index.js";
import { listChanges } from "../src/core/changelog.js";
import { snapshotQueries } from "../src/core/snapshot.js";
import { enums } from "google-ads-api";
import { parseSendTo } from "../src/ads/write/goals.js";
import { fakeCustomer, fakeServer, previewId, previewThenApply } from "./fakes.js";

const credentials = { clientId: "id", clientSecret: "s", refreshToken: "r" };
let customer: ReturnType<typeof fakeCustomer>;
let server: ReturnType<typeof fakeServer>;

function setup(profile: Record<string, unknown> = {}) {
  process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(mkdtempSync(join(tmpdir(), "gma-")), "accounts.json");
  customer = fakeCustomer({
    language_constant: [
      { language_constant: { id: 1000, code: "en" } },
      { language_constant: { id: 1001, code: "de" } },
    ],
    campaign: [{ campaign: { name: "Brand" }, campaign_budget: { resource_name: "customers/1/campaignBudgets/9", amount_micros: 100_000_000, explicitly_shared: false } }],
  });
  const store = new AccountStore({
    config: { accounts: { acme: { customerId: "1", currency: "EUR", timezone: "UTC", writes: true, ...profile } } },
    credentials,
    makeCustomer: () => customer,
  });
  server = fakeServer();
  registerAdsWriteTools(defineTool(server as any, store));
}

describe("ads write tools", () => {
  beforeEach(() => setup({ geos: ["2276"], languages: ["de", "en"] }));

  it("registers every 005 write tool name", () => {
    expect(Object.keys(server.tools).sort()).toEqual([
      "ads_add_extensions", "ads_add_keywords", "ads_add_negative_keywords", "ads_assign_custom_goal",
      "ads_create_ad_group", "ads_create_conversion_action", "ads_create_custom_goal", "ads_create_demand_gen_ad", "ads_create_demand_gen_campaign",
      "ads_create_rsa", "ads_create_search_campaign", "ads_demand_gen_audience", "ads_negative_list",
      "ads_set_campaign_goals", "ads_set_conversion_primary", "ads_set_status", "ads_update_budget",
      "ads_update_conversion_action", "ads_update_cpc_bid", "ads_update_networks",
    ]);
  });

  it("creates search campaigns PAUSED, presence-only, with profile geos and resolved languages", async () => {
    await server.tools.ads_create_search_campaign.handler({ name: "Test", dailyBudget: 50, bidding: "MAXIMIZE_CONVERSIONS" });
    const ops = customer.calls[0].ops as any[];
    const campaign = ops.find((o) => o.entity === "campaign").resource;
    expect(campaign.status).toBe(3); // PAUSED
    expect(campaign.geo_target_type_setting.positive_geo_target_type).toBe(7); // PRESENCE
    const criteria = ops.filter((o) => o.entity === "campaign_criterion").map((o) => o.resource);
    expect(criteria.map((c) => c.location?.geo_target_constant).filter(Boolean)).toEqual(["geoTargetConstants/2276"]);
    expect(criteria.map((c) => c.language?.language_constant).filter(Boolean)).toEqual(["languageConstants/1001", "languageConstants/1000"]);
    expect(customer.calls[0].options).toEqual({ validate_only: true });
  });

  it("asks for geos when the profile has none", async () => {
    setup();
    const r = await server.tools.ads_create_search_campaign.handler({ name: "T", dailyBudget: 50, bidding: "MAXIMIZE_CLICKS", languages: ["en"] });
    expect(r.content[0].text).toMatch(/geoTargetIds.*"geos" in the profile/);
    expect(customer.calls).toHaveLength(0);
  });

  it("uses the profile budget guardrail and currency", async () => {
    setup({ guardrails: { maxBudgetChangePct: 20 } });
    const r = await server.tools.ads_update_budget.handler({ campaignId: "5", dailyBudget: 130 });
    expect(r.content[0].text).toMatch(/BLOCKED: 100 → 130 EUR is a \+30% change \(limit ±20%\)/);
  });

  it("rounds the guardrail percentage", async () => {
    setup({ guardrails: { maxBudgetChangePct: 7 } });
    const r = await server.tools.ads_update_budget.handler({ campaignId: "5", dailyBudget: 130 });
    expect(r.content[0].text).toMatch(/limit ±7%\)/);
  });

  it("requires countryCodes for a lookalike", async () => {
    const r = await server.tools.ads_demand_gen_audience.handler({ name: "A", adGroupIds: ["1"], lookalikeSeedId: "9" });
    expect(r.content[0].text).toMatch(/countryCodes is required/);
    expect(customer.calls).toHaveLength(0);
  });

  it("refuses the custom segment call on a read-only profile", async () => {
    setup({ writes: false });
    const r = await server.tools.ads_demand_gen_audience.handler({
      name: "A", adGroupIds: ["1"], customSegment: { keywords: ["x"] }, confirm: "pv_00000000",
    });
    expect(r.content[0].text).toMatch(/^REFUSED/);
    expect(customer.calls).toHaveLength(0);
  });

  const budgetRow = (amount?: number) => ({
    campaign: { name: "Brand" },
    campaign_budget: { resource_name: "customers/1/campaignBudgets/9", ...(amount === undefined ? {} : { amount_micros: amount }), explicitly_shared: false },
  });
  const budget = (p: Record<string, unknown>) => server.tools.ads_update_budget.handler({ campaignId: "5", ...p });

  it("fails closed when the current budget is unknown", async () => {
    customer = fakeCustomer({ campaign: [budgetRow()] });
    const r = await budget({ dailyBudget: 130 });
    expect(r.content[0].text).toMatch(/current daily budget unknown; can't apply the ±50% guardrail/);
    expect(customer.calls).toHaveLength(0);
  });

  it("passes exactly at the limit, blocks just over, allowLargeChange bypasses", async () => {
    setup({ guardrails: { maxBudgetChangePct: 7 } });
    expect((await budget({ dailyBudget: 107 })).content[0].text).toMatch(/^PREVIEW \(nothing changed\)/);
    expect((await budget({ dailyBudget: 107.01 })).content[0].text).toMatch(/^BLOCKED/);
    expect((await budget({ dailyBudget: 300, allowLargeChange: true })).content[0].text).toMatch(/^PREVIEW \(nothing changed\)/);
  });

  it("refuses the Confirmation when the budget changed after the Preview, and applies nothing", async () => {
    const preview = await budget({ dailyBudget: 140 }); // 100 → 140, +40%: inside the guardrail
    expect(preview.content[0].text).toContain("100 → 140 EUR (+40%)");
    customer = fakeCustomer({ campaign: [budgetRow(80_000_000)] }); // someone set it to 80 in the UI: now +75%
    const r = await budget({ dailyBudget: 140, allowLargeChange: true, confirm: previewId(preview) });
    expect(r.content[0].text).toMatch(/^REFUSED \(nothing changed\): this change no longer matches preview/);
    expect(customer.calls).toHaveLength(0);
    expect(listChanges("acme")).toHaveLength(0);
  });

  it("refuses confirm without a Preview, before any mutation", async () => {
    const r = await budget({ dailyBudget: 110, confirm: "pv_00000000" });
    expect(r.content[0].text).toMatch(/^REFUSED \(nothing changed\): no valid preview/);
    expect(customer.calls).toHaveLength(0);
  });

  it("creates Demand Gen campaigns, RSAs and Demand Gen ads PAUSED", async () => {
    await server.tools.ads_create_demand_gen_campaign.handler({ name: "DG", dailyBudget: 10, bidding: "MAXIMIZE_CLICKS" });
    const dg = (customer.calls[0].ops as any[]).find((o) => o.entity === "campaign").resource;
    expect(dg.status).toBe(3);
    expect(dg.geo_target_type_setting.positive_geo_target_type).toBe(7);

    await server.tools.ads_create_rsa.handler({
      adGroupId: "1", headlines: ["a", "b", "c"], descriptions: ["d", "e"], finalUrl: "https://example.com",
    });
    expect((customer.calls[1].ops as any[])[0].resource.status).toBe(3);

    const img = join(mkdtempSync(join(tmpdir(), "gma-img-")), "a.png");
    writeFileSync(img, "x");
    await server.tools.ads_create_demand_gen_ad.handler({
      campaignId: "1", adGroupId: "2", landscapeImages: [img], squareImages: [img], logoImage: img,
      headlines: ["h"], descriptions: ["d"], businessName: "B", finalUrl: "https://example.com",
    });
    const ad = (customer.calls[2].ops as any[]).find((o) => o.entity === "ad_group_ad").resource;
    expect(ad.status).toBe(3);
  });

  it("validates a custom segment in the Preview and creates it only after the Confirmation", async () => {
    const args = { name: "A", adGroupIds: ["1"], customSegment: { keywords: ["x"] } };
    const dry = await server.tools.ads_demand_gen_audience.handler(args);
    expect(customer.calls[0].options).toEqual({ validate_only: true });
    expect(dry.content[0].text).toMatch(/^PREVIEW \(nothing changed\)\. Google validated the custom segment/);
    expect(dry.content[0].text).toMatch(/custom_audience resource\(s\) it creates stay in the account/);
    expect(customer.calls).toHaveLength(1);

    // a Confirmation that doesn't match creates nothing, not even the segment
    const wrong = await server.tools.ads_demand_gen_audience.handler({ ...args, adGroupIds: ["2"], confirm: previewId(dry) });
    expect(wrong.content[0].text).toMatch(/^REFUSED \(nothing changed\)/);
    expect(customer.calls).toHaveLength(1);

    await previewThenApply(server.tools.ads_demand_gen_audience.handler, args);
    const [, , segment, batch] = customer.calls;
    expect(segment.options).toBeUndefined();
    const audience = (batch.ops as any[]).find((o) => o.entity === "audience").resource;
    expect(audience.dimensions[0].audience_segments.segments).toEqual([{ custom_audience: { custom_audience: "customers/1/customAudiences/77" } }]);
    const entry = listChanges("acme").find((e) => e.tool === "ads_demand_gen_audience" && e.summary.startsWith("Create custom segment"));
    expect(entry).toMatchObject({ confirmation: "preview-matched", created: [{ entity: "custom_audience", resource_name: "customers/1/customAudiences/77" }] });
  });

  it("refuses a read-only profile before any Google call while another profile is writable", async () => {
    process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(mkdtempSync(join(tmpdir(), "gma-")), "accounts.json");
    customer = fakeCustomer({ campaign: [budgetRow(100_000_000)] });
    const base = { customerId: "1", currency: "EUR", timezone: "UTC" };
    const store = new AccountStore({
      config: { accounts: { ro: { ...base, writes: false }, rw: { ...base, writes: true } } },
      credentials,
      makeCustomer: () => customer,
    });
    server = fakeServer();
    registerAdsWriteTools(defineTool(server as any, store));
    const r = await budget({ dailyBudget: 110, confirm: "pv_00000000", profile: "ro" });
    expect(r.content[0].text).toMatch(/^REFUSED/);
    expect(customer.calls).toHaveLength(0);
    expect(customer.queries).toHaveLength(0);
  });

  it("snapshots composite-id names but refuses names with quotes", () => {
    const op = (resource_name: string) => [{ entity: "campaign_conversion_goal", operation: "update" as const, resource: { resource_name, biddable: true } }];
    expect(snapshotQueries(op("customers/1/x/5~DEFAULT~WEBSITE"))).toHaveLength(1);
    expect(() => snapshotQueries(op("customers/1/x/5' OR '1"))).toThrow(/Refusing to snapshot/);
  });

  it("rejects malformed language codes", () => {
    const schema = (server.tools.ads_create_search_campaign.shape as any).languages;
    expect(schema.safeParse(["en", "zh-CN"]).success).toBe(true);
    expect(schema.safeParse(["en'; DROP"]).success).toBe(false);
  });

  it("refuses campaign and Demand Gen ad creation on a read-only profile before any lookup", async () => {
    setup({ writes: false, geos: undefined });
    const a = await server.tools.ads_create_search_campaign.handler({ name: "n", dailyBudget: 5, bidding: "MAXIMIZE_CLICKS", confirm: "pv_00000000" });
    const b = await server.tools.ads_create_demand_gen_ad.handler({ campaignId: "1", adGroupName: "g", landscapeImages: ["x"], squareImages: ["x"], logoImage: "x", headlines: ["h"], descriptions: ["d"], businessName: "b", finalUrl: "https://example.com", confirm: "pv_00000000" });
    expect(a.content[0].text).toMatch(/^REFUSED/);
    expect(b.content[0].text).toMatch(/^REFUSED/);
    expect(customer.queries).toEqual([]);
    expect(customer.calls).toEqual([]);
  });
});

describe("ads_create_conversion_action", () => {
  beforeEach(() => setup());
  const SNIPPET = [{ type: 3, page_format: 2, event_snippet: "<script>gtag('event', 'conversion', {'send_to': 'AW-123456789/AbC-dEf_1'});</script>" }];

  it("parses conversion ID and label from the event snippet", () => {
    expect(parseSendTo(SNIPPET)).toEqual({ conversionId: "123456789", conversionLabel: "AbC-dEf_1" });
    expect(parseSendTo([{ event_snippet: "nothing" }])).toBeUndefined();
    expect(parseSendTo(undefined)).toBeUndefined();
  });

  it("dry-runs a WEBPAGE lead action with one-per-click counting by default", async () => {
    const r = await server.tools.ads_create_conversion_action.handler({ name: "Consumer Lead – Form", category: "SUBMIT_LEAD_FORM" });
    expect(r.content[0].text).toMatch(/^PREVIEW \(nothing changed\)/);
    const op = (customer.calls[0].ops as any[])[0];
    expect(op).toMatchObject({ entity: "conversion_action", operation: "create" });
    expect(op.resource).toMatchObject({
      name: "Consumer Lead – Form",
      type: enums.ConversionActionType.WEBPAGE,
      category: enums.ConversionActionCategory.SUBMIT_LEAD_FORM,
      counting_type: enums.ConversionActionCountingType.ONE_PER_CLICK,
      status: enums.ConversionActionStatus.ENABLED,
      primary_for_goal: true,
      click_through_lookback_window_days: 30,
    });
    expect(op.resource.value_settings).toBeUndefined();
  });

  it("sets value settings when a value is given, using the profile currency by default", async () => {
    await server.tools.ads_create_conversion_action.handler({ name: "Booking", category: "BOOK_APPOINTMENT", value: 150 });
    expect((customer.calls[0].ops as any[])[0].resource.value_settings).toEqual({ default_value: 150, default_currency_code: "EUR", always_use_default_value: false });
  });

  it("refuses a duplicate name", async () => {
    customer.query = async () => [{ conversion_action: { id: 9, name: "Booking" } }];
    const r = await server.tools.ads_create_conversion_action.handler({ name: "Booking", category: "BOOK_APPOINTMENT" });
    expect(r.content[0].text).toMatch(/already exists \(id 9\)/);
    expect(customer.calls).toEqual([]);
  });

  it("after applying, prints the conversion ID and label for gtm_build", async () => {
    customer.query = async (q: string) => (q.includes("tag_snippets") ? [{ conversion_action: { id: 5, tag_snippets: SNIPPET } }] : []);
    const r = await previewThenApply(server.tools.ads_create_conversion_action.handler, { name: "Consumer Lead – Form", category: "SUBMIT_LEAD_FORM" });
    const out = r.content[0].text as string;
    expect(out).toMatch(/^APPLIED \(changeId: /);
    expect(out).toContain('gtm_build ads_conversion_tag: conversionId "123456789", conversionLabel "AbC-dEf_1"');
    const created = (listChanges("acme", 1)[0] as any).created;
    expect(created.map((c: any) => c.entity)).toContain("conversion_action");
  });

  it("rejects names with quotes", async () => {
    // fakeServer skips zod parsing, so the handler must check this itself (GAQL safety)
    const r = await server.tools.ads_create_conversion_action.handler({ name: "Bob's form", category: "CONTACT" });
    expect(r.content[0].text).toMatch(/can't contain quotes/);
    const nl = await server.tools.ads_create_conversion_action.handler({ name: "Lead\nform", category: "CONTACT" });
    expect(nl.content[0].text).toMatch(/control characters/);
    expect(customer.calls).toEqual([]);
    expect(customer.queries).toEqual([]);
    const schema = (server.tools.ads_create_conversion_action.shape as any).name;
    expect(schema.safeParse("Lead\rform").success).toBe(false);
    expect(schema.safeParse("Tab\there").success).toBe(false);
    expect(schema.safeParse("Lead – form").success).toBe(true);
  });
});
