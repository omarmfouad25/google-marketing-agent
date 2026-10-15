// GA4 Admin tools: key events and custom dimensions. Writes are previews unless confirm=true.

import { z } from "zod";
import { google } from "googleapis";
import { requireField, type Ctx } from "../core/context.js";
import { assertWritable } from "../core/runner.js";
import { appendChange } from "../core/changelog.js";
import { text, type Tool } from "../core/tool.js";
import { formatError } from "../core/errors.js";

const admin = (ctx: Ctx) => google.analyticsadmin({ version: "v1beta", auth: ctx.trackingAuth() as any });
const property = (ctx: Ctx) => `properties/${requireField(ctx, "ga4PropertyId")}`;
const preview = (headline: string, detail?: object) => text(detail ? `${headline}\n\n${JSON.stringify(detail, null, 2)}` : headline);
const json = (v: unknown) => text(typeof v === "string" ? v : JSON.stringify(v, null, 2));

/** Log a change that is already live; if logging fails, say so instead of reporting an error. */
function logged(ctx: Ctx, entry: Parameters<typeof appendChange>[1], applied: unknown) {
  try {
    appendChange(ctx.alias, entry);
  } catch (err) {
    return text(`APPLIED but NOT LOGGED (${formatError(err)})\n\n${JSON.stringify(applied, null, 2)}\n\nThis change can't be rolled back from the change log.`);
  }
  return json(applied);
}

export function registerGa4AdminTools(tool: Tool, { writes }: { writes: boolean }) {
  tool(
    "ga4_list_key_events",
    "List GA4 key events (conversions) on the property, plus linked Google Ads accounts",
    {},
    async (_p, ctx) => {
      const parent = property(ctx);
      const [events, links] = await Promise.all([
        admin(ctx).properties.keyEvents.list({ parent }),
        admin(ctx).properties.googleAdsLinks.list({ parent }),
      ]);
      return json({
        keyEvents: events.data.keyEvents?.map((k) => ({
          eventName: k.eventName,
          name: k.name,
          countingMethod: k.countingMethod,
          created: k.createTime,
        })),
        googleAdsLinks: links.data.googleAdsLinks?.map((l) => ({ customerId: l.customerId, name: l.name })),
      });
    }
  );

  tool(
    "ga4_custom_dimensions",
    "List custom dimensions and metrics, or register an event parameter (form_name, lead_type…) as a custom dimension so GA4 reports can use it (not retroactive: register before launch), or archive one. create/archive: preview unless confirm=true",
    {
      action: z.enum(["list", "create", "archive"]),
      parameterName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/).optional().describe("Event parameter (or user property) name, for create"),
      displayName: z.string().min(1).max(82).optional(),
      scope: z.enum(["EVENT", "USER"]).optional().describe("Default EVENT"),
      description: z.string().max(150).optional(),
      name: z.string().regex(/^properties\/\d+\/customDimensions\/\d+$/).optional().describe("Resource name, for archive (from list)"),
      confirm: z.boolean().optional(),
    },
    async ({ action, parameterName, displayName, scope, description, name, confirm }, ctx) => {
      if (action !== "list") {
        const refused = assertWritable(ctx);
        if (refused) return text(refused);
      }
      const parent = property(ctx);
      const dims = (await admin(ctx).properties.customDimensions.list({ parent, pageSize: 200 })).data.customDimensions ?? [];
      if (action === "list") {
        const metrics = (await admin(ctx).properties.customMetrics.list({ parent, pageSize: 200 })).data.customMetrics ?? [];
        return json({
          dimensions: dims.map((d) => ({ name: d.name, parameterName: d.parameterName, displayName: d.displayName, scope: d.scope })),
          metrics: metrics.map((m) => ({ name: m.name, parameterName: m.parameterName, displayName: m.displayName, unit: m.measurementUnit })),
        });
      }
      if (action === "create") {
        if (!parameterName || !displayName) return text("create needs parameterName and displayName.");
        const s = scope ?? "EVENT";
        if (dims.some((d) => d.parameterName === parameterName && d.scope === s)) return text(`"${parameterName}" is already registered as a ${s} custom dimension.`);
        if (!confirm) return preview(`CREATE ${s} custom dimension "${displayName}" (${parameterName}) (nothing changed)`);
        const requestBody = { parameterName, displayName, scope: s, ...(description ? { description } : {}) };
        const { data } = await admin(ctx).properties.customDimensions.create({ parent, requestBody });
        return logged(ctx, { product: "ga4", tool: "ga4_custom_dimensions", summary: `create custom dimension ${parameterName}`, action, result: data.name }, { applied: `"${displayName}" registered; reports show it for data collected from now on`, name: data.name });
      }
      if (!name) return text("archive needs name (from action list).");
      const dim = dims.find((d) => d.name === name);
      if (!dim) return text(`Custom dimension ${name} not found (action list shows them).`);
      if (!confirm) return preview(`ARCHIVE custom dimension "${dim.displayName}" (${dim.parameterName}) (nothing changed)`, { note: "Archived dimensions can't be restored; re-creating starts collection fresh." });
      await admin(ctx).properties.customDimensions.archive({ name });
      return logged(ctx, { product: "ga4", tool: "ga4_custom_dimensions", summary: `archive custom dimension ${dim.parameterName}`, action, before: dim }, { applied: `"${dim.displayName}" archived` });
    }
  );

  if (!writes) return;

  tool(
    "ga4_set_key_event",
    "Mark a GA4 event as a key event (create) or unmark it (remove). Preview unless confirm=true",
    {
      eventName: z.string().min(1),
      action: z.enum(["create", "remove"]),
      countingMethod: z.enum(["ONCE_PER_EVENT", "ONCE_PER_SESSION"]).optional(),
      confirm: z.boolean().optional(),
    },
    async ({ eventName, action, countingMethod, confirm }, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      const parent = property(ctx);
      const existing = (await admin(ctx).properties.keyEvents.list({ parent })).data.keyEvents?.find((k) => k.eventName === eventName);
      if (action === "create" && existing) return json(`"${eventName}" is already a key event.`);
      if (action === "remove" && !existing) return json(`"${eventName}" is not a key event.`);
      if (!confirm) return json({ preview: `${action.toUpperCase()} key event "${eventName}" (nothing changed)` });
      const summary = `${action} key event ${eventName}`;
      if (action === "create") {
        const { data } = await admin(ctx).properties.keyEvents.create({
          parent,
          requestBody: { eventName, countingMethod: countingMethod ?? "ONCE_PER_EVENT" },
        });
        return logged(ctx, { product: "ga4", tool: "ga4_set_key_event", summary, action, eventName, result: data.name }, { applied: `"${eventName}" is now a key event`, name: data.name });
      }
      await admin(ctx).properties.keyEvents.delete({ name: existing!.name! });
      return logged(ctx, { product: "ga4", tool: "ga4_set_key_event", summary, action, eventName, before: existing }, { applied: `"${eventName}" is no longer a key event` });
    }
  );
}
