import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "../src/core/context.js";
import { runAdsWrite } from "../src/core/runner.js";
import { listChanges } from "../src/core/changelog.js";
import { configPaths } from "../src/core/config.js";
import { fakeCustomer } from "./fakes.js";

const credentials = { clientId: "id", clientSecret: "s", refreshToken: "r" };
const op = { entity: "campaign_budget", operation: "update" as const, resource: { resource_name: "customers/1/campaignBudgets/9", amount_micros: 60_000_000 } };
let customer: ReturnType<typeof fakeCustomer>;
let store: AccountStore;

beforeEach(() => {
  process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(mkdtempSync(join(tmpdir(), "gma-")), "accounts.json");
  customer = fakeCustomer({ campaign_budget: [{ campaign_budget: { amount_micros: 40_000_000 } }] });
  store = new AccountStore({
    config: { accounts: { ro: { customerId: "1", currency: "USD", timezone: "UTC" }, rw: { customerId: "1", currency: "USD", timezone: "UTC", writes: true } } },
    credentials,
    makeCustomer: () => customer,
  });
});

describe("runAdsWrite", () => {
  it("refuses a read-only profile before any Google call, even when another profile is writable", async () => {
    expect(store.anyWritable()).toBe(true);
    for (const confirm of [true, false]) {
      const r = await runAdsWrite(store.context("ro"), { tool: "t", summary: "s", ops: [op], confirm });
      expect(r.content[0].text).toMatch(/^REFUSED: profile "ro" is read-only/);
    }
    expect(customer.calls).toHaveLength(0);
    expect(customer.queries).toHaveLength(0);
    expect(listChanges("ro")).toHaveLength(0);
  });

  it("previews with validate_only and logs nothing", async () => {
    const r = await runAdsWrite(store.context("rw"), { tool: "t", summary: "s", ops: [op] });
    expect(r.content[0].text).toMatch(/^DRY RUN OK/);
    expect(customer.calls).toHaveLength(1);
    expect(customer.calls[0].options).toEqual({ validate_only: true });
    expect(customer.queries).toHaveLength(0);
    expect(listChanges("rw")).toHaveLength(0);
  });

  it("applies, snapshots prior values and logs a revertible entry", async () => {
    const r = await runAdsWrite(store.context("rw"), { tool: "ads_update_budget", summary: "s", ops: [op], confirm: true });
    const [entry] = listChanges("rw");
    expect(r.content[0].text).toContain(`changeId: ${entry.id}`);
    expect(entry.before).toEqual([{ entity: "campaign_budget", resource_name: "customers/1/campaignBudgets/9", values: { amount_micros: 40_000_000 } }]);
    expect(entry.product).toBe("ads");
    expect(customer.calls[0].options).toBeUndefined();
  });

  it("writes the change log owner-only (0600) in a 0700 dir", async () => {
    await runAdsWrite(store.context("rw"), { tool: "t", summary: "s", ops: [op], confirm: true });
    await runAdsWrite(store.context("rw"), { tool: "t", summary: "s", ops: [op], confirm: true });
    const dir = configPaths().changes;
    expect(statSync(join(dir, "rw.jsonl")).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("records created resources by entity", async () => {
    const create = { entity: "campaign", operation: "create" as const, resource: { name: "x" } };
    await runAdsWrite(store.context("rw"), { tool: "t", summary: "s", ops: [create], confirm: true });
    expect(listChanges("rw")[0].created).toEqual([{ entity: "campaign", resource_name: "customers/1/fake/1" }]);
  });

  it("reports a failed mutation as nothing changed and logs nothing", async () => {
    customer.mutateResources = async () => {
      throw new Error("boom");
    };
    const r = await runAdsWrite(store.context("rw"), { tool: "t", summary: "s", ops: [op], confirm: true });
    expect(r.content[0].text).toMatch(/^FAILED \(nothing changed\)/);
    expect(listChanges("rw")).toHaveLength(0);
  });

  it("fails closed when the prior state can't be read: no mutation, no log", async () => {
    customer.query = async () => {
      throw new Error("query down");
    };
    const r = await runAdsWrite(store.context("rw"), { tool: "t", summary: "s", ops: [op], confirm: true });
    expect(r.content[0].text).toMatch(/^FAILED \(nothing changed\) — couldn't capture prior state: query down/);
    expect(customer.calls).toHaveLength(0);
    expect(listChanges("rw")).toHaveLength(0);
  });

  it("says NOT LOGGED, never 'nothing changed', when the log write fails after a mutation", async () => {
    writeFileSync(configPaths().changes, "a file where the changes dir should be");
    const r = await runAdsWrite(store.context("rw"), { tool: "t", summary: "s", ops: [op], confirm: true });
    expect(r.content[0].text).toMatch(/^APPLIED but NOT LOGGED/);
    expect(r.content[0].text).not.toContain("nothing changed");
    expect(customer.calls).toHaveLength(1);
  });

  it("applies an update with no selectable fields without a snapshot query", async () => {
    const empty = { entity: "campaign", operation: "update" as const, resource: { resource_name: "customers/1/campaigns/5", maximize_conversions: {} } };
    const r = await runAdsWrite(store.context("rw"), { tool: "t", summary: "s", ops: [empty], confirm: true });
    expect(r.content[0].text).toMatch(/^APPLIED/);
    expect(customer.queries).toHaveLength(0);
    expect(listChanges("rw")[0].notSnapshotted).toEqual(["customers/1/campaigns/5"]);
  });

  it("extra can't overwrite the entry's own fields", async () => {
    await runAdsWrite(store.context("rw"), { tool: "t", summary: "s", ops: [op], confirm: true, extra: { product: "gtm", before: [], note: "kept" } });
    const [e] = listChanges("rw");
    expect(e.product).toBe("ads");
    expect(e.before).toHaveLength(1);
    expect(e.note).toBe("kept");
  });

  it("skips a truncated log line instead of failing", async () => {
    await runAdsWrite(store.context("rw"), { tool: "t", summary: "s", ops: [op], confirm: true });
    appendFileSync(join(configPaths().changes, "rw.jsonl"), '{"id":"trunc\n');
    expect(listChanges("rw")).toHaveLength(1);
  });

  it("rejects an unsafe resource name before it reaches GAQL", async () => {
    const bad = { entity: "campaign", operation: "update" as const, resource: { resource_name: "customers/1/campaigns/5' OR 1=1 --", name: "x" } };
    const r = await runAdsWrite(store.context("rw"), { tool: "t", summary: "s", ops: [bad], confirm: true });
    expect(r.content[0].text).toMatch(/^FAILED \(nothing changed\)/);
    expect(customer.calls).toHaveLength(0);
    expect(customer.queries).toHaveLength(0);
  });
});
