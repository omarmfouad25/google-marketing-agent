import { describe, it, expect } from "vitest";
import { Confirm, Gate, PREVIEW_TTL_MS, type HumanAnswer } from "../src/core/confirm.js";
import { AccountStore } from "../src/core/context.js";
import { defineTool } from "../src/core/tool.js";
import { registerAdsWriteTools } from "../src/ads/write/index.js";
import { listChanges } from "../src/core/changelog.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeCustomer, fakeServer, previewId, previewThenApply } from "./fakes.js";

const acme = { alias: "acme", profile: {} };
const strict = { alias: "strict", profile: { requireHumanApproval: true } };
const content = { ops: [{ entity: "campaign_budget", amount_micros: 140_000_000 }], summary: "100 → 140 (+40%)" };

function human(answer: HumanAnswer | Error, supported = true) {
  const asked: string[] = [];
  return {
    asked,
    supported: () => supported,
    ask: async (m: string) => {
      asked.push(m);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

describe("Gate", () => {
  it("confirms a matching Preview once, as preview-matched when the human can't be asked", async () => {
    const gate = new Gate();
    const id = previewId(gate.preview(acme, "t", content, "PREVIEW", "possible with rollback."));
    expect(await gate.confirm(acme, "t", content, id, "PREVIEW")).toEqual({ kind: "preview-matched" });
    expect(await gate.confirm(acme, "t", content, id, "PREVIEW")).toMatchObject({ refused: expect.stringMatching(/no valid preview/) });
  });

  it("says in the Preview how the Change can be rolled back", () => {
    const r = new Gate().preview(acme, "t", content, "PREVIEW", "not possible: archiving is permanent.");
    expect(r.content[0].text).toContain("Rollback: not possible: archiving is permanent.");
  });

  it("refuses a Confirmation without a Preview, an expired one and another profile's or tool's", async () => {
    let now = 0;
    const gate = new Gate(undefined, () => now);
    expect(await gate.confirm(acme, "t", content, "pv_00000000", "")).toMatchObject({ refused: expect.stringMatching(/^REFUSED \(nothing changed\): no valid preview/) });

    const old = previewId(gate.preview(acme, "t", content, "", ""));
    now = PREVIEW_TTL_MS;
    expect(await gate.confirm(acme, "t", content, old, "")).toMatchObject({ refused: expect.stringMatching(/no valid preview/) });

    const other = previewId(gate.preview(acme, "t", content, "", ""));
    expect(await gate.confirm({ alias: "globex", profile: {} }, "t", content, other, "")).toMatchObject({ refused: expect.stringMatching(/issued for t on profile "acme"/) });
    const tool = previewId(gate.preview(acme, "t", content, "", ""));
    expect(await gate.confirm(acme, "u", content, tool, "")).toMatchObject({ refused: expect.stringMatching(/issued for t/) });
  });

  it("voids a Preview when what it was based on changed, whatever the key order", async () => {
    const gate = new Gate();
    const reordered = { summary: content.summary, ops: content.ops };
    const same = previewId(gate.preview(acme, "t", content, "", ""));
    expect(await gate.confirm(acme, "t", reordered, same, "")).toEqual({ kind: "preview-matched" });

    const id = previewId(gate.preview(acme, "t", content, "", ""));
    const moved = { ...content, summary: "80 → 140 (+75%)" }; // someone changed the budget in the UI meanwhile
    expect(await gate.confirm(acme, "t", moved, id, "")).toMatchObject({ refused: expect.stringMatching(/no longer matches preview/) });
    expect(await gate.confirm(acme, "t", content, id, "")).toMatchObject({ refused: expect.stringMatching(/no valid preview/) }); // used up
  });

  it("asks the human with the Preview when the client can, and records human-approved", async () => {
    const h = human("accept");
    const gate = new Gate(h);
    const id = previewId(gate.preview(acme, "t", content, "", ""));
    expect(await gate.confirm(acme, "t", content, id, "PREVIEW: 100 → 140")).toEqual({ kind: "human-approved" });
    expect(h.asked).toEqual([`Apply this change to profile "acme"?\n\nPREVIEW: 100 → 140`]);
  });

  it("treats decline, cancel and no answer as no, and uses the Preview up", async () => {
    const said = [
      ["decline", /^DECLINED by the user \(nothing changed\)\. Don't retry/],
      ["cancel", /^DECLINED by the user \(nothing changed\)\. Don't retry/],
      [new Error("Request timed out"), /^NOT APPLIED \(nothing changed\): the user didn't answer the approval prompt \(Request timed out\)/],
    ] as const;
    for (const [answer, refusal] of said) {
      const gate = new Gate(human(answer));
      const id = previewId(gate.preview(acme, "t", content, "", ""));
      expect(await gate.confirm(acme, "t", content, id, "")).toEqual({ refused: expect.stringMatching(refusal) });
      expect(await gate.confirm(acme, "t", content, id, "")).toMatchObject({ refused: expect.stringMatching(/no valid preview/) });
    }
  });

  it("refuses requireHumanApproval profiles when the app can't ask, and warns in the Preview", async () => {
    const gate = new Gate(human("accept", false));
    const p = gate.preview(strict, "t", content, "", "");
    expect(p.content[0].text).toContain(`Profile "strict" requires human approval and this app can't ask for it`);
    expect(await gate.confirm(strict, "t", content, previewId(p), "")).toMatchObject({ refused: expect.stringMatching(/requires human approval/) });

    const asking = new Gate(human("accept"));
    const id = previewId(asking.preview(strict, "t", content, "", ""));
    expect(await asking.confirm(strict, "t", content, id, "")).toEqual({ kind: "human-approved" });
  });

  it("rejects the 0.3 confirm: true in the schema", () => {
    expect(Confirm.safeParse(true).success).toBe(false);
    expect(Confirm.safeParse("pv_1a2b3c4d").success).toBe(true);
    expect(Confirm.safeParse(undefined).success).toBe(true);
  });
});

describe("human approval through MCP elicitation", () => {
  function connected(elicitation: boolean, action: HumanAnswer) {
    process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(mkdtempSync(join(tmpdir(), "gma-")), "accounts.json");
    const customer = fakeCustomer();
    const store = new AccountStore({
      config: { accounts: { acme: { customerId: "1", currency: "EUR", timezone: "UTC", writes: true } } },
      credentials: { clientId: "id", clientSecret: "s", refreshToken: "r" },
      makeCustomer: () => customer,
    });
    const asked: any[] = [];
    // what McpServer exposes: the low-level server with the client's capabilities and elicitInput
    const server = Object.assign(fakeServer(), {
      server: {
        getClientCapabilities: () => (elicitation ? { elicitation: {} } : {}),
        elicitInput: async (params: any, options: any) => (asked.push({ params, options }), { action }),
      },
    });
    registerAdsWriteTools(defineTool(server as any, store));
    return { server, customer, asked };
  }
  const pause = { level: "campaign", ids: ["5"], status: "PAUSED" };

  it("asks the human with the Preview and logs human-approved", async () => {
    const { server, customer, asked } = connected(true, "accept");
    const r = await previewThenApply(server.tools.ads_set_status.handler, pause);
    expect(r.content[0].text).toMatch(/^APPLIED \(changeId: \w+, human-approved\)/);
    expect(asked).toHaveLength(1);
    expect(asked[0].params.message).toMatch(/^Apply this change to profile "acme"\?\n\nSet 1 campaign\(s\) → PAUSED: 5/);
    expect(asked[0].params.requestedSchema).toEqual({ type: "object", properties: {} });
    expect(customer.calls.filter((c) => !c.options?.validate_only)).toHaveLength(1);
    expect(listChanges("acme")[0].confirmation).toBe("human-approved");
  });

  it("applies nothing when the human declines", async () => {
    const { server, customer } = connected(true, "decline");
    const r = await previewThenApply(server.tools.ads_set_status.handler, pause);
    expect(r.content[0].text).toMatch(/^DECLINED by the user \(nothing changed\)/);
    expect(customer.calls.filter((c) => !c.options?.validate_only)).toHaveLength(0);
    expect(listChanges("acme")).toHaveLength(0);
  });

  it("falls back to preview-matched when the client has no elicitation", async () => {
    const { server, asked } = connected(false, "accept");
    expect((await previewThenApply(server.tools.ads_set_status.handler, pause)).content[0].text).toMatch(/preview-matched/);
    expect(asked).toHaveLength(0);
  });
});
