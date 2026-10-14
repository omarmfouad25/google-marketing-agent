import { Tool, text } from "../core/tool.js";

// Documented profile fields only; anything else a user adds to accounts.json stays out of tool output
const FIELDS = ["customerId", "loginCustomerId", "currency", "timezone", "geos", "languages", "writes", "guardrails", "brand", "ga4PropertyId", "gscSiteUrl", "gtmContainerId"] as const;

export function registerProfileTool(tool: Tool) {
  tool(
    "account_profile",
    "The resolved profile for an account: currency, timezone, geos, languages, writes, guardrails, brand and linked GA4/Search Console/Tag Manager",
    {},
    async (_args, ctx) => {
      const p = ctx.profile as Record<string, unknown>;
      const out: Record<string, unknown> = { alias: ctx.alias };
      for (const f of FIELDS) if (p[f] !== undefined) out[f] = p[f];
      return text(JSON.stringify(out, null, 2));
    }
  );
}
