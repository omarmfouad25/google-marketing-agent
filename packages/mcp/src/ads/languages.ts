import type { Ctx } from "../core/context.js";

/** Language codes (en, de, ar…) → Google Ads language constant IDs, in the order given */
export async function languageIds(ctx: Ctx, codes: string[]): Promise<string[]> {
  const list = codes.map((c) => `'${c.replace(/'/g, "")}'`).join(", ");
  const rows = (await ctx.customer().query(
    `SELECT language_constant.id, language_constant.code FROM language_constant WHERE language_constant.code IN (${list})`
  )) as { language_constant: { id: number; code: string } }[];
  const byCode = new Map(rows.map((r) => [r.language_constant.code, String(r.language_constant.id)]));
  const unknown = codes.filter((c) => !byCode.has(c));
  if (unknown.length) throw new Error(`Unknown language code(s): ${unknown.join(", ")}`);
  return codes.map((c) => byCode.get(c)!);
}
