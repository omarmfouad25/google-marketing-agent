// Opt-in live check: reads and previews only, never confirm: true. Needs a real profile (GOOGLE_MARKETING_AGENT_CONFIG).
import { AccountStore } from "../src/core/context.js";
import { registerAll } from "../src/server.js";
import { renderDoctor, runDoctor, liveProbes } from "../src/core/doctor.js";

const store = new AccountStore();
console.log(renderDoctor(await runDoctor(liveProbes(store))));
const tools: Record<string, (a: any) => Promise<any>> = {};
registerAll({ tool: (n: string, _d: string, _s: unknown, h: any) => (tools[n] = h) }, store, { writes: true });
const out = async (name: string, args: object) => console.log(`\n## ${name}\n${(await tools[name](args)).content[0].text.slice(0, 800)}`);

await out("get_account_summary", { dateRange: "LAST_7_DAYS" });
await out("get_campaign_performance", { dateRange: "LAST_90_DAYS", limit: 5 });
await out("run_gaql_query", { query: "SELECT campaign.id, campaign.name FROM campaign LIMIT 3" });
await out("run_gaql_query", { query: "SELECT nope FROM campaign" }); // must print a readable error
if (process.env.GMA_LIVE_CAMPAIGN_ID) {
  await out("ads_set_status", { level: "campaign", ids: [process.env.GMA_LIVE_CAMPAIGN_ID], status: "PAUSED" }); // preview only
}
await out("ga4_traffic_overview", { dateRange: "LAST_7_DAYS" });
await out("gsc_top_queries", { limit: 5 });
await out("gtm_overview", {});
