import { describe, it, expect } from "vitest";
import { Recipe, compile, referencedVariables } from "../src/gtm/recipes.js";

const t = (key: string, value: string) => ({ type: "template", key, value });
const b = (key: string, value: string) => ({ type: "boolean", key, value });
const PATH = "^/(es/)?consumer(/|$)";

describe("gtm recipes", () => {
  it("data layer variable", () => {
    expect(compile(Recipe.parse({ kind: "datalayer_variable", name: "DLV - form_name", key: "form_name" }))).toEqual({
      entity: "variables",
      resource: { name: "DLV - form_name", type: "v", parameter: [{ type: "integer", key: "dataLayerVersion", value: "2" }, b("setDefaultValue", "false"), t("name", "form_name")] },
    });
    const d = compile(Recipe.parse({ kind: "datalayer_variable", name: "DLV - currency", key: "currency", defaultValue: "USD" }));
    expect(d.resource.parameter).toEqual([{ type: "integer", key: "dataLayerVersion", value: "2" }, b("setDefaultValue", "true"), t("name", "currency"), t("defaultValue", "USD")]);
  });

  it("custom event trigger split by path, negated for the other audience", () => {
    const consumer = compile(Recipe.parse({ kind: "custom_event_trigger", name: "CE - generate_lead - Consumer", event: "generate_lead", conditions: [{ variable: "Page Path", op: "matchRegex", value: PATH }] }));
    expect(consumer).toEqual({
      entity: "triggers",
      resource: {
        name: "CE - generate_lead - Consumer",
        type: "customEvent",
        customEventFilter: [{ type: "equals", parameter: [t("arg0", "{{_event}}"), t("arg1", "generate_lead")] }],
        filter: [{ type: "matchRegex", parameter: [t("arg0", "{{Page Path}}"), t("arg1", PATH)] }],
      },
    });
    const business = compile(Recipe.parse({ kind: "custom_event_trigger", name: "CE - generate_lead - Business", event: "generate_lead", conditions: [{ variable: "Page Path", op: "matchRegex", value: PATH, negate: true }] }));
    expect((business.resource.filter as any)[0].parameter).toEqual([t("arg0", "{{Page Path}}"), t("arg1", PATH), b("negate", "true")]);
  });

  it("custom event trigger without conditions has no filter key", () => {
    expect(compile(Recipe.parse({ kind: "custom_event_trigger", name: "CE - x", event: "x" })).resource).not.toHaveProperty("filter");
  });

  it("link click triggers: presets, contains, regex, plus conditions", () => {
    const wa = compile(Recipe.parse({ kind: "link_click_trigger", name: "Link - WhatsApp - Consumer", match: "whatsapp", conditions: [{ variable: "Page Path", op: "matchRegex", value: PATH }] }));
    expect(wa).toEqual({
      entity: "triggers",
      resource: {
        name: "Link - WhatsApp - Consumer",
        type: "linkClick",
        filter: [
          { type: "matchRegex", parameter: [t("arg0", "{{Click URL}}"), t("arg1", "(wa\\.me/|api\\.whatsapp\\.com/|whatsapp://)")] },
          { type: "matchRegex", parameter: [t("arg0", "{{Page Path}}"), t("arg1", PATH)] },
        ],
      },
    });
    const filt = (m: unknown) => (compile(Recipe.parse({ kind: "link_click_trigger", name: "L", match: m })).resource.filter as any)[0];
    expect(filt("tel")).toEqual({ type: "matchRegex", parameter: [t("arg0", "{{Click URL}}"), t("arg1", "^tel:")] });
    expect(filt("mailto")).toEqual({ type: "matchRegex", parameter: [t("arg0", "{{Click URL}}"), t("arg1", "^mailto:")] });
    expect(filt({ contains: "15550100" })).toEqual({ type: "contains", parameter: [t("arg0", "{{Click URL}}"), t("arg1", "15550100")] });
    expect(filt({ regex: "calendly\\.com/" })).toEqual({ type: "matchRegex", parameter: [t("arg0", "{{Click URL}}"), t("arg1", "calendly\\.com/")] });
  });

  it("GA4 event tag maps every parameter and sets consent", () => {
    const r = compile(Recipe.parse({
      kind: "ga4_event_tag", name: "GA4 Event - generate_lead", eventName: "generate_lead", measurementId: "G-TEST123",
      params: { form_name: "{{DLV - form_name}}", lead_type: "form" }, triggerIds: ["24", "25"], consent: { required: ["analytics_storage"] },
    }));
    expect(r).toEqual({
      entity: "tags",
      resource: {
        name: "GA4 Event - generate_lead",
        type: "gaawe",
        parameter: [
          b("sendEcommerceData", "false"),
          { type: "list", key: "eventSettingsTable", list: [
            { type: "map", map: [t("parameter", "form_name"), t("parameterValue", "{{DLV - form_name}}")] },
            { type: "map", map: [t("parameter", "lead_type"), t("parameterValue", "form")] },
          ] },
          t("eventName", "generate_lead"),
          t("measurementIdOverride", "G-TEST123"),
        ],
        firingTriggerId: ["24", "25"],
        tagFiringOption: "oncePerEvent",
        consentSettings: { consentStatus: "needed", consentType: { type: "list", list: [{ type: "template", value: "analytics_storage" }] } },
      },
    });
  });

  it("GA4 event tag without params omits the table; no consent = notSet", () => {
    const r = compile(Recipe.parse({ kind: "ga4_event_tag", name: "G", eventName: "phone_click", measurementId: "G-TEST123", triggerIds: ["27"] }));
    expect((r.resource.parameter as any[]).map((p) => p.key)).toEqual(["sendEcommerceData", "eventName", "measurementIdOverride"]);
    expect(r.resource.consentSettings).toEqual({ consentStatus: "notSet" });
  });

  it("Ads conversion tag, with and without value", () => {
    const r = compile(Recipe.parse({ kind: "ads_conversion_tag", name: "Ads - Consumer Lead - Form", conversionId: "123456789", conversionLabel: "AbC-dEf_1", value: "{{DLV - value}}", currency: "{{DLV - currency}}", triggerIds: ["25"] }));
    expect(r).toEqual({
      entity: "tags",
      resource: {
        name: "Ads - Consumer Lead - Form",
        type: "awct",
        parameter: [
          b("enableNewCustomerReporting", "false"),
          b("enableConversionLinker", "true"),
          b("enableProductReporting", "false"),
          t("conversionValue", "{{DLV - value}}"),
          b("enableShippingData", "false"),
          t("conversionId", "123456789"),
          t("currencyCode", "{{DLV - currency}}"),
          t("conversionLabel", "AbC-dEf_1"),
          b("rdp", "false"),
        ],
        firingTriggerId: ["25"],
        tagFiringOption: "oncePerEvent",
        consentSettings: { consentStatus: "notSet" },
      },
    });
    const plain = compile(Recipe.parse({ kind: "ads_conversion_tag", name: "A", conversionId: "1", conversionLabel: "x", triggerIds: ["2"] }));
    expect((plain.resource.parameter as any[]).map((p) => p.key)).toEqual(["enableNewCustomerReporting", "enableConversionLinker", "enableProductReporting", "enableShippingData", "conversionId", "conversionLabel", "rdp"]);
  });

  it("rejects bad input", () => {
    expect(() => Recipe.parse({ kind: "ga4_event_tag", name: "G", eventName: "1bad", measurementId: "G-TEST123", triggerIds: ["1"] })).toThrow();
    expect(() => Recipe.parse({ kind: "ga4_event_tag", name: "G", eventName: "ok", measurementId: "UA-1", triggerIds: ["1"] })).toThrow();
    expect(() => Recipe.parse({ kind: "ads_conversion_tag", name: "A", conversionId: "AW-1", conversionLabel: "x", triggerIds: ["2"] })).toThrow();
    expect(() => Recipe.parse({ kind: "ads_conversion_tag", name: "A", conversionId: "1", conversionLabel: "x", triggerIds: [] })).toThrow();
    expect(() => Recipe.parse({ kind: "nope", name: "x" })).toThrow();
  });

  it("lists referenced variables, excluding _event", () => {
    const r = compile(Recipe.parse({ kind: "custom_event_trigger", name: "CE", event: "e", conditions: [{ variable: "Page Path", op: "equals", value: "/" }, { variable: "{{DLV - lead_type}}", op: "equals", value: "form" }] }));
    expect(referencedVariables(r.resource)).toEqual(["DLV - lead_type", "Page Path"]);
  });
});
