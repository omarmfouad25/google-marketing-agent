// GTM recipes: typed inputs → exact Tag Manager API resources. Shapes match resources that ran in a live container,
// so a create doesn't depend on hand-written JSON (Google doesn't validate a create until it happens).

import { z } from "zod";

type Param = { type: string; key?: string; value?: string; list?: unknown[]; map?: unknown[] };
const tpl = (key: string, value: string): Param => ({ type: "template", key, value });
const bool = (key: string, v: boolean): Param => ({ type: "boolean", key, value: String(v) });

/** Built-in variable display names (as referenced in {{…}}) → built-in type for gtm_builtin_variables */
export const BUILTIN_TYPES: Record<string, string> = {
  "Page URL": "pageUrl", "Page Hostname": "pageHostname", "Page Path": "pagePath", Referrer: "referrer", Event: "event",
  "Click Element": "clickElement", "Click Classes": "clickClasses", "Click ID": "clickId", "Click Target": "clickTarget",
  "Click URL": "clickUrl", "Click Text": "clickText", "Form Element": "formElement", "Form Classes": "formClasses",
  "Form ID": "formId", "Form Target": "formTarget", "Form URL": "formUrl", "Form Text": "formText",
};

const Name = z.string().min(1).max(255);
const GaName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/, "GA4 name: letter first, then letters/digits/_ (max 40)");
const TriggerIds = z.array(z.string().regex(/^\d+$/)).min(1).describe("Firing trigger IDs (gtm_list triggers)");

export const Condition = z.object({
  variable: z.string().min(1).describe('Built-in display name ("Page Path", "Click URL"…) or any variable name, with or without {{ }}'),
  op: z.enum(["equals", "contains", "startsWith", "endsWith", "matchRegex"]),
  value: z.string(),
  negate: z.boolean().optional().describe("true = does NOT match"),
});
const Conditions = z.array(Condition).optional().describe("All must match (AND)");

const Consent = z
  .object({ required: z.array(z.enum(["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"])).min(1) })
  .optional()
  .describe("Consent types the tag needs before it fires. Omitted = not set");

export const Recipe = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("datalayer_variable"), name: Name, key: z.string().min(1).describe("dataLayer key"), defaultValue: z.string().optional() }),
  z.object({ kind: z.literal("custom_event_trigger"), name: Name, event: z.string().min(1).describe("dataLayer event name"), conditions: Conditions }),
  z.object({
    kind: z.literal("link_click_trigger"),
    name: Name,
    match: z
      .union([z.enum(["whatsapp", "tel", "mailto"]), z.object({ regex: z.string().min(1) }).strict(), z.object({ contains: z.string().min(1) }).strict()])
      .describe("Which link URLs: whatsapp (wa.me, api.whatsapp.com, whatsapp://), tel, mailto, {contains} or {regex}"),
    conditions: Conditions,
  }),
  z.object({
    kind: z.literal("ga4_event_tag"),
    name: Name,
    eventName: GaName,
    measurementId: z.string().regex(/^G-[A-Z0-9]+$/, "GA4 measurement ID like G-ABC123"),
    params: z.record(GaName, z.string()).optional().describe('Event parameters: { form_name: "{{DLV - form_name}}" }'),
    triggerIds: TriggerIds,
    consent: Consent,
  }),
  z.object({
    kind: z.literal("ads_conversion_tag"),
    name: Name,
    conversionId: z.string().regex(/^\d+$/, "digits only (the number after AW-)"),
    conversionLabel: z.string().regex(/^[\w-]+$/),
    value: z.string().optional().describe('Literal or variable, e.g. "{{DLV - value}}"'),
    currency: z.string().optional(),
    triggerIds: TriggerIds,
    consent: Consent,
  }),
]);
export type RecipeInput = z.infer<typeof Recipe>;
export type Compiled = { entity: "tags" | "triggers" | "variables"; resource: Record<string, unknown> };

const ref = (v: string) => (v.startsWith("{{") ? v : `{{${v}}}`);
function filter(c: z.infer<typeof Condition>) {
  const parameter = [tpl("arg0", ref(c.variable)), tpl("arg1", c.value)];
  if (c.negate) parameter.push(bool("negate", true));
  return { type: c.op, parameter };
}
const consentSettings = (c: { required: string[] } | undefined) =>
  c ? { consentStatus: "needed", consentType: { type: "list", list: c.required.map((value) => ({ type: "template", value })) } } : { consentStatus: "notSet" };
const LINKS = { whatsapp: "(wa\\.me/|api\\.whatsapp\\.com/|whatsapp://)", tel: "^tel:", mailto: "^mailto:" } as const;

export function compile(r: RecipeInput): Compiled {
  switch (r.kind) {
    case "datalayer_variable": {
      const parameter: Param[] = [{ type: "integer", key: "dataLayerVersion", value: "2" }, bool("setDefaultValue", r.defaultValue !== undefined), tpl("name", r.key)];
      if (r.defaultValue !== undefined) parameter.push(tpl("defaultValue", r.defaultValue));
      return { entity: "variables", resource: { name: r.name, type: "v", parameter } };
    }
    case "custom_event_trigger":
      return {
        entity: "triggers",
        resource: {
          name: r.name,
          type: "customEvent",
          customEventFilter: [{ type: "equals", parameter: [tpl("arg0", "{{_event}}"), tpl("arg1", r.event)] }],
          ...(r.conditions?.length ? { filter: r.conditions.map(filter) } : {}),
        },
      };
    case "link_click_trigger": {
      const m = r.match;
      const first = typeof m === "string" ? filter({ variable: "Click URL", op: "matchRegex", value: LINKS[m] })
        : "regex" in m ? filter({ variable: "Click URL", op: "matchRegex", value: m.regex })
        : filter({ variable: "Click URL", op: "contains", value: m.contains });
      return { entity: "triggers", resource: { name: r.name, type: "linkClick", filter: [first, ...(r.conditions ?? []).map(filter)] } };
    }
    case "ga4_event_tag": {
      const rows = Object.entries(r.params ?? {}).map(([k, v]) => ({ type: "map", map: [tpl("parameter", k), tpl("parameterValue", v)] }));
      const parameter: Param[] = [bool("sendEcommerceData", false)];
      if (rows.length) parameter.push({ type: "list", key: "eventSettingsTable", list: rows });
      parameter.push(tpl("eventName", r.eventName), tpl("measurementIdOverride", r.measurementId));
      return { entity: "tags", resource: { name: r.name, type: "gaawe", parameter, firingTriggerId: r.triggerIds, tagFiringOption: "oncePerEvent", consentSettings: consentSettings(r.consent) } };
    }
    case "ads_conversion_tag": {
      const parameter: Param[] = [bool("enableNewCustomerReporting", false), bool("enableConversionLinker", true), bool("enableProductReporting", false)];
      if (r.value !== undefined) parameter.push(tpl("conversionValue", r.value));
      parameter.push(bool("enableShippingData", false), tpl("conversionId", r.conversionId));
      if (r.currency !== undefined) parameter.push(tpl("currencyCode", r.currency));
      parameter.push(tpl("conversionLabel", r.conversionLabel), bool("rdp", false));
      return { entity: "tags", resource: { name: r.name, type: "awct", parameter, firingTriggerId: r.triggerIds, tagFiringOption: "oncePerEvent", consentSettings: consentSettings(r.consent) } };
    }
  }
}

/** Variable names referenced as {{Name}} anywhere in a resource (excluding GTM's internal _event) */
export function referencedVariables(resource: unknown): string[] {
  const names = [...JSON.stringify(resource).matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]).filter((n) => n !== "_event");
  return [...new Set(names)].sort();
}
