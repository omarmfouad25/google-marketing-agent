import { z } from "zod";
import type { Ctx } from "../../core/context.js";

export const Id = z.string().regex(/^\d+$/, "numeric ID");
export const CompositeId = z.string().regex(/^\d+~\d+$/, "format adGroupId~id").describe("adGroupId~id (e.g. 123~456)");
export const Confirm = z.boolean().optional().describe("false/omitted = dry run (validate_only). true = apply the change for real");
export const Status = z.enum(["ENABLED", "PAUSED"]);
export const MatchType = z.enum(["EXACT", "PHRASE", "BROAD"]);
export const KeywordList = z.array(z.object({ text: z.string().min(1).max(80), matchType: MatchType })).min(1);
export const Languages = z
  .array(z.string().regex(/^[A-Za-z]{2,3}([_-][A-Za-z]+)?$/, "language code like en, de, zh-CN"))
  .min(1)
  .optional()
  .describe("Language codes (en, de, ar…). Defaults to the profile's languages");

export const rn = (ctx: Ctx, type: string, id: string) => `customers/${ctx.profile.customerId}/${type}/${id}`;
export const money = (ctx: Ctx, n: number) => `${n} ${ctx.profile.currency}`;
export const rows = async (ctx: Ctx, gaql: string) => (await ctx.customer().query(gaql)) as any[];

export function geosFor(ctx: Ctx, given?: string[]): string[] {
  const geos = given ?? ctx.profile.geos;
  if (!geos?.length) throw new Error(`No locations: pass geoTargetIds, or set "geos" in the profile "${ctx.alias}" (see docs/profiles.md).`);
  return geos;
}
