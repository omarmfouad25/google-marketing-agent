import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "../src/core/context.js";
import { defineTool } from "../src/core/tool.js";
import { appendChange } from "../src/core/changelog.js";
import { registerRollback } from "../src/ads/write/rollback.js";
import { registerChangesList } from "../src/accounts/changes.js";
import { fakeCustomer, fakeServer } from "./fakes.js";

let customer: ReturnType<typeof fakeCustomer>;
let server: ReturnType<typeof fakeServer>;
const run = async (name: string, args: Record<string, unknown>) => (await server.tools[name].handler(args)).content[0].text as string;

let second: ReturnType<typeof fakeCustomer>;
const prof = (customerId: string, writes = true) => ({ customerId, currency: "USD", timezone: "UTC", writes });

function setup(accounts: Record<string, ReturnType<typeof prof>>, def?: string) {
  process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(mkdtempSync(join(tmpdir(), "gma-")), "accounts.json");
  customer = fakeCustomer();
  second = fakeCustomer();
  const store = new AccountStore({
    config: { default: def, accounts },
    credentials: { clientId: "id", clientSecret: "s", refreshToken: "r" },
    makeCustomer: (p) => (p.customerId === "2" ? second : customer),
  });
  server = fakeServer();
  const tool = defineTool(server as any, store);
  registerRollback(tool);
  registerChangesList(tool);
}

beforeEach(() => setup({ acme: prof("1") }));

const budgetChange = () =>
  appendChange("acme", {
    product: "ads", tool: "ads_update_budget", summary: "budget 40 to 60",
    before: [{ entity: "campaign_budget", resource_name: "customers/1/campaignBudgets/9", values: { amount_micros: 40_000_000 } }],
  });

describe("ads_rollback", () => {
  it("previews without mutating, then applies and logs the rollback", async () => {
    const e = budgetChange();
    expect(await run("ads_rollback", { changeId: e.id })).toMatch(/^DRY RUN OK/);
    expect(customer.calls).toHaveLength(1);
    expect(customer.calls[0].options?.validate_only).toBe(true);
    expect((customer.calls[0].ops as any[])[0].resource.amount_micros).toBe(40_000_000);
    expect(await run("ads_rollback", { changeId: e.id, confirm: true })).toMatch(/APPLIED/);
    expect(await run("changes_list", {})).toMatch(new RegExp(`Rollback of ${e.id}`));
  });

  it("explains an unknown id", async () => {
    expect(await run("ads_rollback", { changeId: "nope" })).toMatch(/No change "nope" for account acme/);
    expect(customer.calls).toHaveLength(0);
  });

  it("refuses non-Ads and snapshot-failed entries with a reason and no Google calls", async () => {
    const g = appendChange("acme", { product: "gtm", tool: "gtm_publish", summary: "publish v12" });
    const f = appendChange("acme", { product: "ads", tool: "ads_update_budget", summary: "x", snapshotError: "boom" });
    for (const id of [g.id, f.id]) {
      for (const confirm of [false, true]) expect(await run("ads_rollback", { changeId: id, confirm })).toMatch(/^REFUSED/);
    }
    expect(await run("ads_rollback", { changeId: g.id })).toMatch(/gtm_publish/);
    expect(await run("ads_rollback", { changeId: f.id })).toMatch(/boom/);
    expect(customer.calls).toHaveLength(0);
    expect(customer.queries).toHaveLength(0);
  });

  it("lists everything it can't revert", async () => {
    const e = appendChange("acme", {
      product: "ads", tool: "ads_demand_gen_audience", summary: "mixed",
      before: [{ entity: "campaign", resource_name: "customers/1/campaigns/5", values: { name: null } }],
      notSnapshotted: ["customers/1/campaigns/6"],
      ops: [{ entity: "campaign", operation: "remove", resource: "customers/1/campaigns/7" }],
      created: [
        { entity: "asset", resource_name: "customers/1/assets/1" },
        { entity: "campaign_budget", resource_name: "customers/1/campaignBudgets/2" },
      ],
    });
    const out = await run("ads_rollback", { changeId: e.id });
    expect(out).toMatch(/^DRY RUN OK/);
    for (const s of ["campaigns/5 name (no prior value recorded) not reverted", "campaigns/6 not snapshotted", "campaigns/7 removal not reverted", "assets/1 (asset is not removed"])
      expect(out).toContain(s);
    expect(customer.calls[0].ops).toHaveLength(1); // only the budget removal
  });

  it("won't roll back twice, or roll back a rollback", async () => {
    const e = budgetChange();
    await run("ads_rollback", { changeId: e.id, confirm: true });
    const n = customer.calls.length;
    const rb = (await run("changes_list", {})).match(/- (\w+) · .* Rollback of/)![1];
    expect(await run("ads_rollback", { changeId: e.id, confirm: true })).toBe(`Already rolled back by ${rb} — nothing changed`);
    expect(await run("ads_rollback", { changeId: rb, confirm: true })).toMatch(/is itself a rollback; re-run the original change instead/);
    expect(customer.calls).toHaveLength(n);
  });

  it("refuses on a read-only profile with zero calls", async () => {
    setup({ acme: prof("1", false) });
    const e = budgetChange();
    expect(await run("ads_rollback", { changeId: e.id, confirm: true })).toMatch(/^REFUSED: profile "acme" is read-only/);
    expect(customer.calls).toHaveLength(0);
  });

  it("scopes changes to the account", async () => {
    setup({ acme: prof("1"), beta: prof("2") }, "acme");
    const e = appendChange("beta", {
      product: "ads", tool: "ads_update_budget", summary: "b",
      before: [{ entity: "campaign_budget", resource_name: "customers/2/campaignBudgets/9", values: { amount_micros: 1 } }],
    });
    expect(await run("ads_rollback", { changeId: e.id })).toMatch(/No change .* for account acme/);
    expect(customer.calls).toHaveLength(0);
    expect(await run("ads_rollback", { changeId: e.id, account: "beta" })).toMatch(/^DRY RUN OK/);
    expect(second.calls).toHaveLength(1);
    expect(customer.calls).toHaveLength(0);
  });

  it("keeps multi-line summaries on one changes_list line", async () => {
    appendChange("acme", { product: "ads", tool: "t", summary: "a\nb" });
    expect(await run("changes_list", {})).toMatch(/a · b$/);
  });
});
