import { z } from "zod";
import { enums } from "google-ads-api";
import type { Tool } from "../../core/tool.js";
import { text } from "../../core/tool.js";
import { assertWritable, runAdsWrite } from "../../core/runner.js";
import type { Op } from "../../core/changelog.js";
import { toMicros } from "../../core/format.js";
import { Confirm, Id, Status, money, rn, rows } from "./shared.js";

export function registerStatusBudgetBids(tool: Tool) {
  tool(
    "ads_set_status",
    "Pause or enable campaigns, ad groups, ads, or keywords. Dry run unless confirm=true",
    {
      level: z.enum(["campaign", "ad_group", "ad", "keyword"]),
      ids: z
        .array(z.string().regex(/^\d+(~\d+)?$/))
        .min(1)
        .describe("campaign/ad_group: numeric IDs. ad/keyword: adGroupId~adId / adGroupId~criterionId"),
      status: Status,
      confirm: Confirm,
    },
    async ({ level, ids, status, confirm }, ctx) => {
      const map = {
        campaign: ["campaigns", "campaign", enums.CampaignStatus],
        ad_group: ["adGroups", "ad_group", enums.AdGroupStatus],
        ad: ["adGroupAds", "ad_group_ad", enums.AdGroupAdStatus],
        keyword: ["adGroupCriteria", "ad_group_criterion", enums.AdGroupCriterionStatus],
      } as const;
      const [type, entity, statusEnum] = map[level];
      const composite = level === "ad" || level === "keyword";
      if (ids.some((id) => id.includes("~") !== composite)) {
        return text(`IDs for ${level} must be ${composite ? "adGroupId~id" : "plain numeric"}.`);
      }
      const ops: Op[] = ids.map((id) => ({
        entity,
        operation: "update",
        resource: { resource_name: rn(ctx, type, id), status: statusEnum[status] },
      }));
      return runAdsWrite(ctx, { tool: "ads_set_status", summary: `Set ${ids.length} ${level}(s) → ${status}: ${ids.join(", ")}`, ops, confirm });
    }
  );

  tool(
    "ads_update_budget",
    "Change a campaign's daily budget (in the account currency). Blocks changes beyond the profile's budget guardrail (default ±50%) unless allowLargeChange. Dry run unless confirm=true",
    {
      campaignId: Id,
      dailyBudget: z.number().positive().describe("New daily budget in the account currency"),
      allowLargeChange: z.boolean().optional(),
      confirm: Confirm,
    },
    async ({ campaignId, dailyBudget, allowLargeChange, confirm }, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      const [row] = await rows(
        ctx,
        `SELECT campaign.name, campaign_budget.resource_name, campaign_budget.amount_micros,
                campaign_budget.explicitly_shared
         FROM campaign WHERE campaign.id = ${campaignId}`
      );
      if (!row) return text(`Campaign ${campaignId} not found.`);
      const budget = row.campaign_budget;
      const limitPct = ctx.profile.guardrails?.maxBudgetChangePct ?? 50;
      const curMicros = Number(budget.amount_micros);
      if (!(curMicros > 0)) return text(`Campaign ${campaignId}: current daily budget unknown; can't apply the ±${limitPct}% guardrail.`);
      const current = curMicros / 1_000_000;
      const newMicros = toMicros(dailyBudget);
      const change = (newMicros - curMicros) / curMicros;
      const pct = `${change >= 0 ? "+" : ""}${Math.round(change * 100)}%`;
      // integer micros: no float drift at the exact limit
      if (Math.abs(newMicros - curMicros) * 100 > limitPct * curMicros && !allowLargeChange) {
        return text(`BLOCKED: ${current} → ${dailyBudget} ${ctx.profile.currency} is a ${pct} change (limit ±${limitPct}%). Pass allowLargeChange: true if intended.`);
      }
      const shared = budget.explicitly_shared ? " (SHARED budget: affects every campaign using it)" : "";
      return runAdsWrite(ctx, {
        tool: "ads_update_budget",
        summary: `"${row.campaign.name}" daily budget ${current} → ${money(ctx, dailyBudget)} (${pct})${shared}`,
        ops: [{ entity: "campaign_budget", operation: "update", resource: { resource_name: budget.resource_name, amount_micros: toMicros(dailyBudget) } }],
        confirm,
      });
    }
  );

  tool(
    "ads_update_cpc_bid",
    "Set max CPC bid (account currency) on an ad group or keyword. Only applies to manual CPC campaigns. Dry run unless confirm=true",
    {
      level: z.enum(["ad_group", "keyword"]),
      id: z.string().regex(/^\d+(~\d+)?$/).describe("ad_group: numeric ID. keyword: adGroupId~criterionId"),
      cpcBid: z.number().positive(),
      confirm: Confirm,
    },
    async ({ level, id, cpcBid, confirm }, ctx) => {
      const [type, entity] = level === "ad_group" ? ["adGroups", "ad_group"] : ["adGroupCriteria", "ad_group_criterion"];
      return runAdsWrite(ctx, {
        tool: "ads_update_cpc_bid",
        summary: `${level} ${id} max CPC → ${money(ctx, cpcBid)}`,
        ops: [{ entity, operation: "update", resource: { resource_name: rn(ctx, type, id), cpc_bid_micros: toMicros(cpcBid) } }],
        confirm,
      });
    }
  );

  tool(
    "ads_update_networks",
    "Opt a Search campaign in/out of Search Partners and Display expansion, and/or set location targeting to " +
      "presence only (people in the targeted locations) vs presence or interest. Dry run unless confirm=true",
    {
      campaignId: Id,
      searchPartners: z.boolean().optional(),
      display: z.boolean().optional(),
      presenceOnly: z.boolean().optional().describe("true = PRESENCE, false = PRESENCE_OR_INTEREST"),
      confirm: Confirm,
    },
    async ({ campaignId, searchPartners, display, presenceOnly, confirm }, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      if (searchPartners === undefined && display === undefined && presenceOnly === undefined) {
        return text("Set searchPartners, display and/or presenceOnly.");
      }
      const [row] = await rows(
        ctx,
        `SELECT campaign.name, campaign.network_settings.target_search_network,
                campaign.network_settings.target_content_network,
                campaign.geo_target_type_setting.positive_geo_target_type
         FROM campaign WHERE campaign.id = ${campaignId}`
      );
      if (!row) return text(`Campaign ${campaignId} not found.`);
      const before = {
        ...row.campaign.network_settings,
        positive_geo_target_type: row.campaign.geo_target_type_setting?.positive_geo_target_type,
      };
      const resource: Record<string, unknown> = { resource_name: rn(ctx, "campaigns", campaignId) };
      const changes: string[] = [];
      if (searchPartners !== undefined || display !== undefined) {
        const network_settings = {
          target_google_search: true,
          target_search_network: searchPartners ?? before.target_search_network,
          target_content_network: display ?? before.target_content_network,
        };
        resource.network_settings = network_settings;
        changes.push(
          `Search Partners ${before.target_search_network} → ${network_settings.target_search_network}`,
          `Display ${before.target_content_network} → ${network_settings.target_content_network}`
        );
      }
      if (presenceOnly !== undefined) {
        const target = presenceOnly ? "PRESENCE" : "PRESENCE_OR_INTEREST";
        resource.geo_target_type_setting = { positive_geo_target_type: enums.PositiveGeoTargetType[target] };
        changes.push(`Location ${enums.PositiveGeoTargetType[before.positive_geo_target_type] ?? before.positive_geo_target_type} → ${target}`);
      }
      return runAdsWrite(ctx, {
        tool: "ads_update_networks",
        summary: `"${row.campaign.name}": ${changes.join(", ")}`,
        ops: [{ entity: "campaign", operation: "update", resource }],
        confirm,
      });
    }
  );
}
