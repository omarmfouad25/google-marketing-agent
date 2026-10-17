import { Tool, text } from "../core/tool.js";

// Documented profile fields only; anything else a user adds to accounts.json stays out of tool output
const FIELDS = ["customerId", "loginCustomerId", "currency", "timezone", "geos", "languages", "writes", "requireHumanApproval", "guardrails", "brand", "ga4PropertyId", "gscSiteUrl", "gtmContainerId", "gtmContainerIds"] as const;

export function registerProfileTool(tool: Tool) {
  tool(
    "get_profile",
    "The resolved profile: currency, timezone, geos, languages, writes, human-approval setting, guardrails, brand and its Google Ads account, GA4 property, Search Console site and GTM containers",
    {},
    async (_args, ctx) => {
      const p = ctx.profile as Record<string, unknown>;
      const out: Record<string, unknown> = { alias: ctx.alias };
      for (const f of FIELDS) if (p[f] !== undefined) out[f] = p[f];
      return text(JSON.stringify(out, null, 2));
    }
  );
}
