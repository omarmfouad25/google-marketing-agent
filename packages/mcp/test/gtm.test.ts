import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { google } from "googleapis";
import { AccountStore } from "../src/core/context.js";
import { defineTool } from "../src/core/tool.js";
import { registerGtmTools } from "../src/gtm/tools.js";
import { referencesTo } from "../src/gtm/manage.js";
import { compareEntities, expectedStrings } from "../src/gtm/versions.js";
import { listChanges } from "../src/core/changelog.js";
import { fakeGtm, fakeServer, previewId, WS } from "./fakes.js";

const credentials = { clientId: "id", clientSecret: "s", refreshToken: "r" };
let gtm: ReturnType<typeof fakeGtm>;
let server: ReturnType<typeof fakeServer>;

function setup(init: Parameters<typeof fakeGtm>[0] = {}, writes = true, profile: Record<string, unknown> = { gtmContainerId: "GTM-TEST" }) {
  process.env.GOOGLE_MARKETING_AGENT_CONFIG = join(mkdtempSync(join(tmpdir(), "gma-")), "accounts.json");
  gtm = fakeGtm(init);
  vi.spyOn(google, "tagmanager").mockReturnValue(gtm.api as any);
  const store = new AccountStore({ config: { accounts: { acme: { customerId: "1", currency: "USD", timezone: "UTC", writes, ...profile } } }, credentials });
  server = fakeServer();
  registerGtmTools(defineTool(server as any, store), { writes });
}
const run = async (name: string, args: Record<string, unknown>) => (await server.tools[name].handler(args)).content[0].text as string;
/** Preview, then confirm with its ID */
const apply = async (name: string, args: Record<string, unknown>) => {
  const preview = await server.tools[name].handler(args);
  return run(name, { ...args, confirm: previewId(preview) });
};
afterEach(() => vi.restoreAllMocks());

const p = (key: string, value: string) => ({ type: "template", key, value });
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
    const applied = await apply("gtm_build", { recipe });
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
    await apply("gtm_build", { recipe: ga4, id: "7" });
    expect(gtm.calls[0]).toMatchObject({ method: "tags.update", args: { path: `${WS}/tags/7`, fingerprint: "f0" } });
  });

  it("lists settings an update would remove", async () => {
    const tag = { tagId: "7", name: "GA4 Event - x", type: "gaawe", parameter: [p("eventName", "x"), p("userProperties", "x")], firingTriggerId: ["24"], fingerprint: "f0", path: `${WS}/tags/7` };
    setup({ tags: [tag], triggers: [trigger24] });
    const ga4 = { kind: "ga4_event_tag", name: "GA4 Event - x", eventName: "x", measurementId: "G-TEST123", triggerIds: ["24"] };
    const preview = await run("gtm_build", { recipe: ga4, id: "7" });
    expect(preview).toMatch(/WARNING: removes settings the recipe doesn't model: userProperties/);
    expect(preview).toContain('"removedSettings": [\n    "userProperties"\n  ]');
  });

  it("is not registered on a read-only profile", () => {
    setup({}, false);
    expect(server.tools.gtm_build).toBeUndefined();
  });
});

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

  it("works on a never-published container", async () => {
    setup({ live: null, headers: [{ containerVersionId: "1" }], tags: [{ tagId: "9", name: "New tag", type: "gaawe" }] });
    expect(JSON.parse(await run("gtm_versions", {}))).toEqual([expect.objectContaining({ versionId: "1", live: false })]);
    const r = JSON.parse(await run("gtm_versions", { versionId: "workspace" }));
    expect(r).toMatchObject({ from: "none (never published)", to: "workspace", tags: { added: ["New tag"] } });
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

  it("explains a container with no published version", async () => {
    setup({ live: null });
    expect(await run("gtm_live_check", {})).toBe("Container GTM-TEST has no published version yet: publish one with gtm_publish first.");
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

describe("gtm_publish", () => {
  const change = [{ changeStatus: "added", tag: { name: "New tag" } }];

  it("publishes a never-published container, with no rollback version", async () => {
    setup({ live: null, changes: change });
    expect(await run("gtm_publish", { name: "v1" })).toMatch(/"liveVersion": "none \(first published version\)"/);
    const r = JSON.parse(await apply("gtm_publish", { name: "v1" }));
    expect(r.rollback).toBe("none (first published version)");
    expect(gtm.calls.map((c) => c.method)).toEqual(["workspaces.create_version", "versions.publish"]);
  });

  it("previews a re-publish when nothing is live", async () => {
    setup({ live: null });
    expect(await run("gtm_publish", { versionId: "3" })).toMatch(/^PREVIEW: RE-PUBLISH version 3 \(live is none \(first published version\), nothing changed\)/);
  });
});

describe("gtm_overview", () => {
  it("works on a never-published container", async () => {
    setup({ live: null });
    expect(JSON.parse(await run("gtm_overview", {})).live).toBeNull();
  });
});

describe("gtm_builtin_variables", () => {
  it("lists enabled built-ins with the name ↔ type map, even on a read-only profile", async () => {
    setup({ builtIns: [PAGE_PATH] }, false);
    const r = JSON.parse(await run("gtm_builtin_variables", { action: "list" }));
    expect(r.enabled).toEqual([PAGE_PATH]);
    expect(r.available["Click URL"]).toBe("clickUrl");
  });

  it("refuses enable on a read-only profile", async () => {
    setup({}, false);
    expect(await run("gtm_builtin_variables", { action: "enable", types: ["clickUrl"], confirm: "pv_00000000" })).toMatch(/^REFUSED/);
  });

  it("previews, skips already-enabled types, then enables and logs", async () => {
    setup({ builtIns: [PAGE_PATH] });
    expect(await run("gtm_builtin_variables", { action: "enable", types: ["pagePath"] })).toMatch(/already enabled/);
    const preview = await run("gtm_builtin_variables", { action: "enable", types: ["pagePath", "clickUrl"] });
    expect(preview).toMatch(/ENABLE built-in variables: clickUrl \(nothing changed\)/);
    expect(gtm.calls).toEqual([]);
    await apply("gtm_builtin_variables", { action: "enable", types: ["pagePath", "clickUrl"] });
    expect(gtm.calls[0]).toMatchObject({ method: "built_in_variables.create", args: { parent: WS, type: ["clickUrl"] } });
    expect(listChanges("acme", 5)[0]).toMatchObject({ tool: "gtm_builtin_variables" });
  });

  it("disables only enabled types", async () => {
    setup({ builtIns: [PAGE_PATH] });
    await apply("gtm_builtin_variables", { action: "disable", types: ["pagePath", "clickUrl"] });
    expect(gtm.calls[0]).toMatchObject({ method: "built_in_variables.delete", args: { path: `${WS}/built_in_variables`, type: ["pagePath"] } });
  });

  it("requires types for enable/disable", async () => {
    setup();
    expect(await run("gtm_builtin_variables", { action: "enable" })).toMatch(/types/);
  });
});

describe("gtm_delete", () => {
  const tag = { tagId: "5", name: "Ads - old", type: "awct", firingTriggerId: ["24"], parameter: [{ type: "template", key: "conversionValue", value: "{{DLV - form_name}}" }], path: `${WS}/tags/5` };
  const trigUsingVar = { triggerId: "30", name: "CE - uses var", type: "customEvent", filter: [{ type: "equals", parameter: [{ type: "template", key: "arg0", value: "{{DLV - lead_type}}" }] }] };
  const varUsingVar = { variableId: "40", name: "Lookup", type: "smm", parameter: [{ type: "template", key: "input", value: "{{DLV - lang}}" }] };

  it("finds references from tags, triggers and other variables", () => {
    const all = { tags: [tag], triggers: [trigUsingVar], variables: [varUsingVar], builtIns: [] };
    expect(referencesTo(all, "triggers", { triggerId: "24", name: "CE" })).toEqual(['tag "Ads - old"']);
    expect(referencesTo(all, "variables", { name: "DLV - form_name" })).toEqual(['tag "Ads - old"']);
    expect(referencesTo(all, "variables", { name: "DLV - lead_type" })).toEqual(['trigger "CE - uses var"']);
    expect(referencesTo(all, "variables", { name: "DLV - lang" })).toEqual(['variable "Lookup"']);
    expect(referencesTo(all, "tags", tag)).toEqual([]);
  });

  it("refuses to delete a referenced trigger", async () => {
    setup({ tags: [tag], triggers: [trigger24] });
    const r = await run("gtm_delete", { entity: "triggers", id: "24", confirm: "pv_00000000" });
    expect(r).toMatch(/^REFUSED \(nothing changed\)/);
    expect(r).toContain('tag "Ads - old"');
    expect(gtm.calls).toEqual([]);
  });

  it("previews with the full resource, then deletes and logs the prior state", async () => {
    setup({ tags: [tag], triggers: [trigger24] });
    const preview = await run("gtm_delete", { entity: "tags", id: "5" });
    expect(preview).toMatch(/DELETE tags\/5 "Ads - old" \(nothing changed\)/);
    expect(preview).toMatch(/pausing/i);
    const applied = await apply("gtm_delete", { entity: "tags", id: "5" });
    expect(applied).toMatch(/DELETED from workspace \(not live until gtm_publish\)/);
    expect(gtm.calls[0]).toMatchObject({ method: "tags.delete", args: { path: `${WS}/tags/5` } });
    expect(listChanges("acme", 5)[0]).toMatchObject({ tool: "gtm_delete", before: { name: "Ads - old" } });
  });

  it("is not registered on a read-only profile", () => {
    setup({}, false);
    expect(server.tools.gtm_delete).toBeUndefined();
  });
});

describe("Profile scope (docs/adr/0002)", () => {
  const tag = { entity: "tags", resource: { name: "x", type: "html" } };

  it("refuses writes to a container outside the profile, before any GTM call", async () => {
    setup();
    for (const [name, args] of [["gtm_upsert", tag], ["gtm_publish", { name: "v" }], ["gtm_delete", { entity: "tags", id: "5" }], ["gtm_builtin_variables", { action: "enable", types: ["clickUrl"] }]] as const) {
      expect(await run(name, { ...args, container: "GTM-OTHER" }), name).toMatch(/^REFUSED \(nothing changed\): GTM container GTM-OTHER is outside profile "acme" \(GTM-TEST\)/);
    }
    expect(gtm.calls).toEqual([]);
  });

  it("allows every container listed in gtmContainerIds, the first being the default", async () => {
    setup({}, true, { gtmContainerIds: ["GTM-TEST", "GTM-SERVER"] });
    expect(await run("gtm_upsert", tag)).toMatch(/^PREVIEW: CREATE tags/);
    expect(await run("gtm_upsert", { ...tag, container: "GTM-SERVER" })).not.toMatch(/REFUSED/);
  });

  it("keeps reads Login-wide", async () => {
    setup();
    expect(await run("gtm_list", { entity: "tags", container: "GTM-OTHER" })).not.toMatch(/outside profile/);
  });
});

describe("gtm_publish binding", () => {
  it("refuses the Confirmation when the workspace changed after the Preview", async () => {
    setup({ changes: [{ changeStatus: "added", tag: { name: "GA4 - lead" } }] });
    const preview = await server.tools.gtm_publish.handler({ name: "leads" });
    expect(preview.content[0].text).toMatch(/Rollback: possible with rollback \(re-publishes version 1, live now\)/);
    gtm.state.changes.push({ changeStatus: "added", tag: { name: "a colleague's tag" } });
    const r = await run("gtm_publish", { name: "leads", confirm: previewId(preview) });
    expect(r).toMatch(/^REFUSED \(nothing changed\): this change no longer matches preview/);
    expect(gtm.calls).toEqual([]);
  });
});
