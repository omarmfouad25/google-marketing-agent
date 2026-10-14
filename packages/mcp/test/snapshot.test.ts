import { describe, it, expect } from "vitest";
import { snapshotQueries, readSnapshot, rollbackOps } from "../src/core/snapshot.js";

const budgetOp = { entity: "campaign_budget", operation: "update" as const, resource: { resource_name: "customers/1/campaignBudgets/9", amount_micros: 60_000_000 } };
const networkOp = {
  entity: "campaign",
  operation: "update" as const,
  resource: { resource_name: "customers/1/campaigns/5", network_settings: { target_search_network: false, target_content_network: false } },
};

describe("snapshotQueries", () => {
  it("selects exactly the fields an update changes, flattened", () => {
    const [b, n] = snapshotQueries([budgetOp, networkOp]);
    expect(b.gaql).toBe("SELECT campaign_budget.amount_micros FROM campaign_budget WHERE campaign_budget.resource_name = 'customers/1/campaignBudgets/9'");
    expect(n.fields).toEqual(["network_settings.target_search_network", "network_settings.target_content_network"]);
  });

  it("ignores creates and removes", () => {
    expect(snapshotQueries([{ entity: "campaign", operation: "create", resource: { name: "x" } }])).toEqual([]);
  });
});

describe("readSnapshot", () => {
  it("reads nested prior values from a GAQL row", () => {
    const [q] = snapshotQueries([networkOp]);
    const s = readSnapshot({ campaign: { network_settings: { target_search_network: true, target_content_network: false } } }, q);
    expect(s.values).toEqual({ "network_settings.target_search_network": true, "network_settings.target_content_network": false });
  });

  it("records absent non-boolean prior values as null, not dropped", () => {
    const [q] = snapshotQueries([budgetOp]);
    expect(readSnapshot({ campaign_budget: {} }, q).values).toEqual({ amount_micros: null });
  });

  it("records an omitted boolean as false (proto3 default) when the row came back", () => {
    const [q] = snapshotQueries([networkOp]);
    const s = readSnapshot({ campaign: { network_settings: { target_search_network: true } } }, q);
    expect(s.values).toEqual({ "network_settings.target_search_network": true, "network_settings.target_content_network": false });
    expect(readSnapshot(undefined, q).values["network_settings.target_content_network"]).toBeNull();
    const { ops, skipped } = rollbackOps({ id: "x", at: "", account: "a", product: "ads", tool: "t", summary: "s", before: [s] });
    expect(skipped).toEqual([]);
    expect(ops[0].resource.network_settings).toEqual({ target_search_network: true, target_content_network: false });
  });
});

describe("rollbackOps", () => {
  const base = { id: "x", at: "", account: "a", product: "ads" as const, tool: "t", summary: "s" };

  it("restores prior values and removes created resources in reverse order, skipping assets", () => {
    const { ops, skipped } = rollbackOps({
      ...base,
      before: [{ entity: "campaign", resource_name: "customers/1/campaigns/5", values: { "network_settings.target_search_network": true } }],
      created: [
        { entity: "campaign_budget", resource_name: "customers/1/campaignBudgets/1" },
        { entity: "campaign", resource_name: "customers/1/campaigns/2" },
        { entity: "ad_group", resource_name: "customers/1/adGroups/3" },
        { entity: "asset", resource_name: "customers/1/assets/8" },
        { entity: "ad_group_criterion", resource_name: "customers/1/adGroupCriteria/3~4" },
      ],
    });
    expect(ops).toEqual([
      { entity: "campaign", operation: "update", resource: { resource_name: "customers/1/campaigns/5", network_settings: { target_search_network: true } } },
      { entity: "ad_group_criterion", operation: "remove", resource: "customers/1/adGroupCriteria/3~4" },
      { entity: "ad_group", operation: "remove", resource: "customers/1/adGroups/3" },
      { entity: "campaign", operation: "remove", resource: "customers/1/campaigns/2" },
      { entity: "campaign_budget", operation: "remove", resource: "customers/1/campaignBudgets/1" },
    ]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatch(/assets\/8/);
  });

  it("reports null prior values as not reverted and leaves them out of the update", () => {
    const { ops, skipped } = rollbackOps({
      ...base,
      before: [{ entity: "campaign", resource_name: "customers/1/campaigns/5", values: { "network_settings.target_search_network": true, "network_settings.target_content_network": null } }],
    });
    expect(ops).toEqual([{ entity: "campaign", operation: "update", resource: { resource_name: "customers/1/campaigns/5", network_settings: { target_search_network: true } } }]);
    expect(skipped).toEqual(["customers/1/campaigns/5 network_settings.target_content_network (no prior value recorded) not reverted"]);
  });

  it("emits no update when every prior value is null", () => {
    const { ops, skipped } = rollbackOps({ ...base, before: [{ entity: "campaign", resource_name: "customers/1/campaigns/5", values: { name: null } }] });
    expect(ops).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it("lists unsnapshotted updates and removals under skipped", () => {
    const { skipped } = rollbackOps({
      ...base,
      notSnapshotted: ["customers/1/campaigns/5"],
      ops: [{ entity: "campaign", operation: "remove", resource: "customers/1/campaigns/6" }],
    });
    expect(skipped).toEqual(["customers/1/campaigns/5 not snapshotted, not reverted", "customers/1/campaigns/6 removal not reverted"]);
  });

  it("skips the query for an update with no selectable fields", () => {
    expect(snapshotQueries([{ entity: "campaign", operation: "update", resource: { resource_name: "customers/1/campaigns/5", maximize_conversions: {} } }])).toEqual([]);
  });

  it("refuses entries it can't revert", () => {
    expect(() => rollbackOps({ ...base, product: "gtm" })).toThrow(/gtm_publish/);
    expect(() => rollbackOps({ ...base, snapshotError: "boom" })).toThrow(/prior state wasn't captured/);
  });
});
