import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { google } from "googleapis";
import { AccountStore } from "../src/core/context.js";
import { defineTool } from "../src/core/tool.js";
import { appendChange, listChanges } from "../src/core/changelog.js";
import { registerRollback } from "../src/accounts/rollback.js";
import { registerChangesList } from "../src/accounts/changes.js";
import { fakeCustomer, fakeGtm, fakeServer, previewId } from "./fakes.js";

let customer: ReturnType<typeof fakeCustomer>;
let server: ReturnType<typeof fakeServer>;
const run = async (name: string, args: Record<string, unknown>) => (await server.tools[name].handler(args)).content[0].text as string;
/** Preview a rollback, then confirm it with its ID */
const apply = async (args: Record<string, unknown>) => run("rollback", { ...args, confirm: previewId(await server.tools.rollback.handler(args)) });

let second: ReturnType<typeof fakeCustomer>;
const prof = (customerId: string, writes = true, extra: Record<string, unknown> = {}) => ({ customerId, currency: "USD", timezone: "UTC", writes, ...extra });

function setup(accounts: Record<string, ReturnType<typeof prof>>, def?: string, rows: Record<string, unknown[]> = {}) {
  process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(mkdtempSync(join(tmpdir(), "gma-")), "accounts.json");
  customer = fakeCustomer(rows);
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
afterEach(() => vi.restoreAllMocks());

const BUDGET = "customers/1/campaignBudgets/9";
const budgetChange = () =>
  appendChange("acme", {
    product: "ads", tool: "ads_update_budget", summary: "budget 40 to 60",
    ops: [{ entity: "campaign_budget", operation: "update", resource: { resource_name: BUDGET, amount_micros: 60_000_000 } }],
    before: [{ entity: "campaign_budget", resource_name: BUDGET, values: { amount_micros: 40_000_000 } }],
  });
const budgetNow = (micros: number) => ({ campaign_budget: [{ campaign_budget: { amount_micros: micros } }] });

describe("rollback: Google Ads", () => {
  it("previews without mutating, then applies and logs the rollback", async () => {
    setup({ acme: prof("1") }, undefined, budgetNow(60_000_000));
    const e = budgetChange();
    const preview = await run("rollback", { changeId: e.id });
    expect(preview).toMatch(/^PREVIEW \(nothing changed\)/);
    expect(preview).toMatch(/Rollback: not possible: a rollback can't itself be rolled back/);
    expect(customer.calls).toHaveLength(1);
    expect(customer.calls[0].options?.validate_only).toBe(true);
    expect((customer.calls[0].ops as any[])[0].resource.amount_micros).toBe(40_000_000);
    expect(await run("rollback", { changeId: e.id, confirm: previewId({ content: [{ text: preview }] }) })).toMatch(/^APPLIED/);
    expect(await run("changes_list", {})).toMatch(new RegExp(`preview-matched · Rollback of ${e.id}`));
  });

  it("refuses to overwrite a later edit unless acceptDrift", async () => {
    setup({ acme: prof("1") }, undefined, budgetNow(90_000_000)); // a teammate set it to 90 after the change
    const e = budgetChange();
    const out = await run("rollback", { changeId: e.id });
    expect(out).toMatch(/^DRIFT \(nothing changed\)/);
    expect(out).toContain(`${BUDGET} amount_micros: now 90000000, the change set 60000000`);
    expect(customer.calls).toHaveLength(0);

    const accepted = await run("rollback", { changeId: e.id, acceptDrift: true });
    expect(accepted).toMatch(/^PREVIEW \(nothing changed\)/);
    expect(accepted).toMatch(/Overwrites Drift:\n- customers\/1\/campaignBudgets\/9 amount_micros/);
    expect(await apply({ changeId: e.id, acceptDrift: true })).toMatch(/^APPLIED/);
  });

  it("treats a created resource with a different status as Drift, and skips ones already removed", async () => {
    const created = (status: number) => ({ campaign: [{ campaign: { status } }] });
    const change = () =>
      appendChange("acme", {
        product: "ads", tool: "ads_create_search_campaign", summary: "create",
        created: [{ entity: "campaign", resource_name: "customers/1/campaigns/5", status: 3 }],
      });
    setup({ acme: prof("1") }, undefined, created(2)); // created PAUSED, enabled by hand since
    expect(await run("rollback", { changeId: change().id })).toMatch(/campaigns\/5 was created PAUSED and is now ENABLED: rolling back removes it/);

    setup({ acme: prof("1") }, undefined, created(4)); // already REMOVED
    expect(await run("rollback", { changeId: change().id })).toMatch(/^Nothing to roll back for \w+\.\nNot reverted:\n- customers\/1\/campaigns\/5 already removed/);

    setup({ acme: prof("1") }, undefined, created(3)); // untouched
    expect(await run("rollback", { changeId: change().id })).toMatch(/^PREVIEW \(nothing changed\)/);
  });

  it("explains an unknown id", async () => {
    expect(await run("rollback", { changeId: "nope" })).toMatch(/No change "nope" for profile acme/);
    expect(customer.calls).toHaveLength(0);
  });

  it("refuses snapshot-failed entries with a reason and no Google calls", async () => {
    const f = appendChange("acme", { product: "ads", tool: "ads_update_budget", summary: "x", snapshotError: "boom" });
    expect(await run("rollback", { changeId: f.id })).toMatch(/^REFUSED.*boom/);
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
    const out = await run("rollback", { changeId: e.id });
    expect(out).toMatch(/^PREVIEW \(nothing changed\)/);
    for (const s of ["campaigns/5 name (no prior value recorded) not reverted", "campaigns/6 not snapshotted", "campaigns/7 removal not reverted", "assets/1 (asset is not removed"])
      expect(out).toContain(s);
    expect(customer.calls[0].ops).toHaveLength(1); // only the budget removal
  });

  it("won't roll back twice, or roll back a rollback", async () => {
    setup({ acme: prof("1") }, undefined, budgetNow(60_000_000));
    const e = budgetChange();
    await apply({ changeId: e.id });
    const n = customer.calls.length;
    const rb = listChanges("acme")[0].id;
    expect(await run("rollback", { changeId: e.id })).toBe(`Already rolled back by ${rb}: nothing changed.`);
    expect(await run("rollback", { changeId: rb })).toMatch(/is itself a rollback; re-run the original change instead/);
    expect(customer.calls).toHaveLength(n);
  });

  it("refuses on a read-only profile with zero calls", async () => {
    setup({ acme: prof("1", false) });
    const e = budgetChange();
    expect(await run("rollback", { changeId: e.id, confirm: "pv_00000000" })).toMatch(/^REFUSED: profile "acme" is read-only/);
    expect(customer.calls).toHaveLength(0);
  });

  it("scopes changes to the profile", async () => {
    setup({ acme: prof("1"), beta: prof("2") }, "acme");
    const e = appendChange("beta", {
      product: "ads", tool: "ads_update_budget", summary: "b",
      before: [{ entity: "campaign_budget", resource_name: "customers/2/campaignBudgets/9", values: { amount_micros: 1 } }],
    });
    expect(await run("rollback", { changeId: e.id })).toMatch(/No change .* for profile acme/);
    expect(customer.calls).toHaveLength(0);
    expect(await run("rollback", { changeId: e.id, profile: "beta" })).toMatch(/^PREVIEW \(nothing changed\)/);
    expect(second.calls).toHaveLength(1);
    expect(customer.calls).toHaveLength(0);
  });

  it("keeps multi-line summaries on one changes_list line, and marks entries from before 0.4", async () => {
    appendChange("acme", { product: "ads", tool: "t", summary: "a\nb" });
    expect(await run("changes_list", {})).toMatch(/confirmed before 0\.4 · a · b$/);
  });
});

describe("rollback: Tag Manager", () => {
  const CONTAINER = "accounts/1/containers/2";
  function gtmSetup(live: string | null) {
    setup({ acme: prof("1", true, { gtmContainerId: "GTM-TEST" }) });
    const g = fakeGtm({ live: live === null ? null : { containerVersionId: live, tag: [] } });
    vi.spyOn(google, "tagmanager").mockReturnValue(g.api as any);
    return g;
  }
  const publish = (extra: Record<string, unknown> = {}) =>
    appendChange("acme", { product: "gtm", tool: "gtm_publish", summary: 'publish version 13 "leads"', action: "publish", container: CONTAINER, newVersion: "13", previousLive: "12", ...extra });

  it("re-publishes the version that was live before, and logs it", async () => {
    const g = gtmSetup("13");
    const e = publish();
    expect(await run("rollback", { changeId: e.id })).toMatch(/^PREVIEW: ROLLBACK .*re-publish version 12 \(live is 13, nothing changed\)/);
    expect(g.calls).toHaveLength(0);
    await apply({ changeId: e.id });
    expect(g.calls).toEqual([{ method: "versions.publish", args: { path: `${CONTAINER}/versions/12` } }]);
    expect(listChanges("acme")[0]).toMatchObject({ product: "gtm", tool: "rollback", rollbackOf: e.id, versionId: "12", previousLive: "13" });
  });

  it("refuses when a newer version went live since, unless acceptDrift", async () => {
    const g = gtmSetup("14");
    const e = publish();
    expect(await run("rollback", { changeId: e.id })).toMatch(/^DRIFT \(nothing changed\)[\s\S]*live version is now 14, not version 13/);
    expect(await apply({ changeId: e.id, acceptDrift: true })).toMatch(/Version 12 is live again/);
    expect(g.calls).toHaveLength(1);
  });

  it("explains what it can't roll back: workspace edits, first versions and 0.3 entries", async () => {
    gtmSetup("13");
    const edit = appendChange("acme", { product: "gtm", tool: "gtm_upsert", summary: "create tags", action: "create" });
    expect(await run("rollback", { changeId: edit.id })).toMatch(/^REFUSED .*workspace edit.*Workspace Changes/);
    expect(await run("rollback", { changeId: publish({ previousLive: undefined }).id })).toMatch(/first version, so there is nothing to go back to/);
    expect(await run("rollback", { changeId: publish({ container: undefined }).id })).toMatch(/logged before 0\.4 without its container/);
  });
});

describe("rollback: GA4", () => {
  it("unmarks a key event that a change marked", async () => {
    setup({ acme: prof("1", true, { ga4PropertyId: "5" }) });
    const deleted: string[] = [];
    const keyEvents = {
      list: async () => ({ data: { keyEvents: [{ eventName: "generate_lead", name: "properties/5/keyEvents/9" }] } }),
      delete: async (a: { name: string }) => (deleted.push(a.name), { data: {} }),
    };
    vi.spyOn(google, "analyticsadmin").mockReturnValue({ properties: { keyEvents } } as any);
    const e = appendChange("acme", { product: "ga4", tool: "ga4_set_key_event", summary: "create key event generate_lead", action: "create", eventName: "generate_lead" });
    expect(await run("rollback", { changeId: e.id })).toMatch(/unmark key event "generate_lead" \(nothing changed\)/);
    await apply({ changeId: e.id });
    expect(deleted).toEqual(["properties/5/keyEvents/9"]);
  });
});
