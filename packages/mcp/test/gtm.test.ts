import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { google } from "googleapis";
import { AccountStore } from "../src/core/context.js";
import { defineTool } from "../src/core/tool.js";
import { registerGtmTools } from "../src/gtm/tools.js";
import { compareEntities, expectedStrings } from "../src/gtm/versions.js";
import { listChanges } from "../src/core/changelog.js";
import { fakeGtm, fakeServer, WS } from "./fakes.js";

const credentials = { clientId: "id", clientSecret: "s", refreshToken: "r" };
let gtm: ReturnType<typeof fakeGtm>;
let server: ReturnType<typeof fakeServer>;

function setup(init: Parameters<typeof fakeGtm>[0] = {}, writes = true) {
  process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(mkdtempSync(join(tmpdir(), "gma-")), "accounts.json");
  gtm = fakeGtm(init);
  vi.spyOn(google, "tagmanager").mockReturnValue(gtm.api as any);
  const store = new AccountStore({ config: { accounts: { acme: { customerId: "1", currency: "USD", timezone: "UTC", gtmContainerId: "GTM-TEST", writes } } }, credentials });
  server = fakeServer();
  registerGtmTools(defineTool(server as any, store), { writes });
}
const run = async (name: string, args: Record<string, unknown>) => (await server.tools[name].handler(args)).content[0].text as string;
afterEach(() => vi.restoreAllMocks());

const PAGE_PATH = { name: "Page Path", type: "pagePath" };
const trigger24 = { triggerId: "24", name: "CE - generate_lead - Consumer", type: "customEvent", path: `${WS}/triggers/24` };
const dlv = { variableId: "18", name: "DLV - form_name", type: "v", path: `${WS}/variables/18` };

describe("gtm_build", () => {
  it("previews a create without calling the API, and applies + logs on confirm", async () => {
    setup({ builtIns: [PAGE_PATH] });
    const recipe = { kind: "custom_event_trigger", name: "CE - generate_lead - Business", event: "generate_lead", conditions: [{ variable: "Page Path", op: "matchRegex", value: "^/consumer", negate: true }] };
    const preview = await run("gtm_build", { recipe });
    expect(preview).toMatch(/CREATE triggers "CE - generate_lead - Business" \(nothing changed\)/);
    expect(preview).toContain('"negate"');
    expect(gtm.calls).toEqual([]);
    const applied = await run("gtm_build", { recipe, confirm: true });
    expect(applied).toMatch(/CREATED in workspace \(not live until gtm_publish\)/);
    expect(gtm.calls[0].method).toBe("triggers.create");
    expect(gtm.calls[0].args.parent).toBe(WS);
    expect(listChanges("acme", 5)[0]).toMatchObject({ product: "gtm", tool: "gtm_build" });
  });

  it("refuses a duplicate name", async () => {
    setup({ triggers: [trigger24] });
    const r = await run("gtm_build", { recipe: { kind: "custom_event_trigger", name: trigger24.name, event: "x" } });
    expect(r).toMatch(/^NOT BUILT \(nothing changed\)/);
    expect(r).toContain(`triggers named "${trigger24.name}" already exists (id 24)`);
  });

  it("reports missing variables with the fix, ignoring {{_event}}", async () => {
    setup();
    const r = await run("gtm_build", { recipe: { kind: "custom_event_trigger", name: "CE", event: "x", conditions: [{ variable: "Page Path", op: "equals", value: "/" }, { variable: "DLV - lead_type", op: "equals", value: "form" }] } });
    expect(r).toMatch(/^NOT BUILT/);
    expect(r).toContain('{{Page Path}} is a built-in variable that is not enabled: gtm_builtin_variables { action: "enable", types: ["pagePath"] }');
    expect(r).toContain("{{DLV - lead_type}} does not exist: create it with gtm_build kind datalayer_variable");
    expect(r).not.toContain("_event");
  });

  it("reports missing triggers but accepts built-in trigger IDs", async () => {
    setup({ triggers: [trigger24], variables: [dlv] });
    const base = { kind: "ga4_event_tag", name: "GA4 Event - generate_lead", eventName: "generate_lead", measurementId: "G-TEST123", params: { form_name: "{{DLV - form_name}}" } };
    expect(await run("gtm_build", { recipe: { ...base, triggerIds: ["24", "2147479553"] } })).toMatch(/CREATE tags/);
    const r = await run("gtm_build", { recipe: { ...base, triggerIds: ["24", "99"] } });
    expect(r).toContain("trigger 99 does not exist");
  });

  it("updates an existing entity with a diff, and refuses a type mismatch", async () => {
    const tag = { tagId: "7", name: "GA4 Event - x", type: "gaawe", parameter: [], firingTriggerId: ["24"], fingerprint: "f0", path: `${WS}/tags/7` };
    setup({ tags: [tag], triggers: [trigger24] });
    const ads = { kind: "ads_conversion_tag", name: "Ads", conversionId: "1", conversionLabel: "x", triggerIds: ["24"] };
    expect(await run("gtm_build", { recipe: ads, id: "7" })).toMatch(/^NOT BUILT.*tags\/7 is type gaawe, this recipe builds awct/s);
    const ga4 = { kind: "ga4_event_tag", name: "GA4 Event - x", eventName: "x", measurementId: "G-TEST123", triggerIds: ["24"] };
    const preview = await run("gtm_build", { recipe: ga4, id: "7" });
    expect(preview).toMatch(/UPDATE tags\/7 "GA4 Event - x" \(nothing changed\)/);
    expect(preview).toContain('"parameter"');
    await run("gtm_build", { recipe: ga4, id: "7", confirm: true });
    expect(gtm.calls[0]).toMatchObject({ method: "tags.update", args: { path: `${WS}/tags/7`, fingerprint: "f0" } });
  });

  it("is not registered on a read-only profile", () => {
    setup({}, false);
    expect(server.tools.gtm_build).toBeUndefined();
  });
});

const p = (key: string, value: string) => ({ type: "template", key, value });

describe("gtm_versions", () => {
  it("lists versions newest first and marks the live one", async () => {
    setup({ headers: [{ containerVersionId: "6", name: "v6", numTags: "3" }, { containerVersionId: "7", name: "v7", numTags: "5" }], live: { containerVersionId: "7" } });
    const r = JSON.parse(await run("gtm_versions", {}));
    expect(r.map((v: any) => [v.versionId, v.live])).toEqual([["7", true], ["6", false]]);
  });

  it("diffs two versions by name, ignoring volatile fields", () => {
    const older = { tag: [{ tagId: "1", name: "A", type: "awct", fingerprint: "x", parameter: [p("conversionLabel", "old")] }, { tagId: "2", name: "Gone", type: "html" }] };
    const newer = { tag: [{ tagId: "1", name: "A", type: "awct", fingerprint: "y", parameter: [p("conversionLabel", "new")] }, { tagId: "3", name: "New", type: "gaawe" }] };
    const d = compareEntities(older, newer);
    expect(d.tags.added).toEqual(["New"]);
    expect(d.tags.removed).toEqual(["Gone"]);
    expect(d.tags.changed.map((c) => [c.name, Object.keys(c.changes)])).toEqual([["A", ["parameter"]]]);
    expect(d.triggers).toEqual({ added: [], removed: [], changed: [] });
  });

  it('compares the workspace to live with versionId "workspace"', async () => {
    setup({ tags: [{ tagId: "9", name: "New tag", type: "gaawe" }], live: { containerVersionId: "7", tag: [] } });
    const r = JSON.parse(await run("gtm_versions", { versionId: "workspace" }));
    expect(r).toMatchObject({ from: "7 (live)", to: "workspace", tags: { added: ["New tag"] } });
  });

  it("defaults compareTo to the previous version", async () => {
    setup({ headers: [{ containerVersionId: "5" }, { containerVersionId: "7" }], versions: { "5": { tag: [] }, "7": { tag: [{ name: "T" }] } } });
    const r = JSON.parse(await run("gtm_versions", { versionId: "7" }));
    expect(r).toMatchObject({ from: "5", to: "7", tags: { added: ["T"] } });
  });

  it("skips deleted versions when picking the previous one", async () => {
    setup({ headers: [{ containerVersionId: "5" }, { containerVersionId: "6", deleted: true }, { containerVersionId: "7" }], versions: { "5": { tag: [] }, "7": { tag: [{ name: "T" }] } } });
    const r = JSON.parse(await run("gtm_versions", { versionId: "7" }));
    expect(r).toMatchObject({ from: "5", to: "7" });
  });
});

describe("gtm_live_check", () => {
  const live = { containerVersionId: "7", tag: [
    { name: "Ads", type: "awct", parameter: [p("conversionId", "123456789"), p("conversionLabel", "AbC-1")] },
    { name: "GA4", type: "gaawe", parameter: [p("eventName", "generate_lead"), p("measurementIdOverride", "G-TEST123")] },
    { name: "Var label", type: "awct", parameter: [p("conversionLabel", "{{DLV - label}}")] },
    { name: "Paused", type: "awct", paused: true, parameter: [p("conversionLabel", "Old-1")] },
  ] };

  it("derives expectations from active tags, skipping variables and paused tags", () => {
    expect(expectedStrings(live)).toEqual(["AbC-1", "G-TEST123", "generate_lead"]);
  });

  it("reports found and missing strings in the served gtm.js", async () => {
    setup({ live });
    const fetchMock = vi.fn(async () => new Response('..."AbC-1"..."generate_lead"...', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = JSON.parse(await run("gtm_live_check", {}));
    vi.unstubAllGlobals();
    expect(fetchMock.mock.calls[0][0]).toBe("https://www.googletagmanager.com/gtm.js?id=GTM-TEST");
    expect(r).toMatchObject({ container: "GTM-TEST", liveVersion: "7", found: ["AbC-1", "generate_lead"], missing: ["G-TEST123"] });
  });

  it("explains a network failure", async () => {
    setup({ live });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    const r = await run("gtm_live_check", { expect: ["x"] });
    vi.unstubAllGlobals();
    expect(r).toBe("Could not reach googletagmanager.com for GTM-TEST: timeout. Check the network and try again.");
  });

  it("explains a non-200 response", async () => {
    setup({ live });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const r = await run("gtm_live_check", { expect: ["x"] });
    vi.unstubAllGlobals();
    expect(r).toMatch(/gtm\.js returned 404/);
  });
});
