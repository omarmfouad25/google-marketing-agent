// GA4 Admin tools: key events (GA4's conversions). Writes are previews unless confirm=true.

import { z } from "zod";
import { google } from "googleapis";
import { requireField, type Ctx } from "../core/context.js";
import { assertWritable } from "../core/runner.js";
import { appendChange } from "../core/changelog.js";
import { text, type Tool } from "../core/tool.js";
import { formatError } from "../core/errors.js";

const admin = (ctx: Ctx) => google.analyticsadmin({ version: "v1beta", auth: ctx.trackingAuth() as any });
const property = (ctx: Ctx) => `properties/${requireField(ctx, "ga4PropertyId")}`;
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
