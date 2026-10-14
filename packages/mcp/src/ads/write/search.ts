import { z } from "zod";
import { enums } from "google-ads-api";
import type { Tool } from "../../core/tool.js";
import { text } from "../../core/tool.js";
import { assertWritable, runAdsWrite } from "../../core/runner.js";
import type { Op } from "../../core/changelog.js";
import { toMicros } from "../../core/format.js";
import { languageIds } from "../languages.js";
import { Confirm, Id, KeywordList, Languages, geosFor, money, rn } from "./shared.js";

export function registerSearch(tool: Tool) {
  tool(
    "ads_create_search_campaign",
    "Create a Search campaign (always PAUSED) with its own daily budget, presence-only geo (profile geos by default), language targeting, Google Search only. Dry run unless confirm=true",
    {
      name: z.string().min(1),
      dailyBudget: z.number().positive().describe("Daily budget in the account currency"),
      bidding: z.enum(["MAXIMIZE_CONVERSIONS", "MAXIMIZE_CLICKS", "MANUAL_CPC"]),
      maxCpc: z.number().positive().optional().describe("Max CPC cap (account currency) for MAXIMIZE_CLICKS"),
      languages: Languages,
      geoTargetIds: z.array(Id).optional().describe("Geo target constant IDs. Defaults to the profile's geos"),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      confirm: Confirm,
    },
    async (p, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      if (p.maxCpc && p.bidding !== "MAXIMIZE_CLICKS") return text("maxCpc only applies to MAXIMIZE_CLICKS.");
      const geos = geosFor(ctx, p.geoTargetIds);
      const codes = p.languages ?? ctx.profile.languages ?? ["en"];
      const langIds = await languageIds(ctx, codes);
      const budget = rn(ctx, "campaignBudgets", "-1");
      const campaign = rn(ctx, "campaigns", "-2");
      const bidding = {
        MAXIMIZE_CONVERSIONS: { maximize_conversions: {} },
        MAXIMIZE_CLICKS: { target_spend: p.maxCpc ? { cpc_bid_ceiling_micros: toMicros(p.maxCpc) } : {} },
        MANUAL_CPC: { manual_cpc: { enhanced_cpc_enabled: false } },
      }[p.bidding];
      const ops: Op[] = [
        {
          entity: "campaign_budget",
          operation: "create",
          resource: {
            resource_name: budget,
            name: `${p.name} budget`,
            amount_micros: toMicros(p.dailyBudget),
            delivery_method: enums.BudgetDeliveryMethod.STANDARD,
            explicitly_shared: false,
          },
        },
        {
          entity: "campaign",
          operation: "create",
          resource: {
            resource_name: campaign,
            name: p.name,
            status: enums.CampaignStatus.PAUSED,
            advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
            campaign_budget: budget,
            network_settings: {
              target_google_search: true,
              target_search_network: false,
              target_content_network: false,
              target_partner_search_network: false,
            },
            // People in the targeted locations only; the API default also serves people "interested in" them
            geo_target_type_setting: { positive_geo_target_type: enums.PositiveGeoTargetType.PRESENCE },
            contains_eu_political_advertising: enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
            ...(p.startDate ? { start_date: p.startDate.replaceAll("-", "") } : {}),
            ...(p.endDate ? { end_date: p.endDate.replaceAll("-", "") } : {}),
            ...bidding,
          },
        },
        ...geos.map((g) => ({
          entity: "campaign_criterion",
          operation: "create" as const,
          resource: { campaign, location: { geo_target_constant: `geoTargetConstants/${g}` } },
        })),
        ...langIds.map((l) => ({
          entity: "campaign_criterion",
          operation: "create" as const,
          resource: { campaign, language: { language_constant: `languageConstants/${l}` } },
        })),
      ];
      return runAdsWrite(ctx, {
        tool: "ads_create_search_campaign",
        summary:
          `Create PAUSED Search campaign "${p.name}": ${money(ctx, p.dailyBudget)}/day, ${p.bidding}` +
          `${p.maxCpc ? ` (CPC cap ${money(ctx, p.maxCpc)})` : ""}, geo ${geos.join(",")}, languages ${codes.join(",")}`,
        ops,
        confirm: p.confirm,
      });
    }
  );

  tool(
    "ads_create_ad_group",
    "Create a Search ad group (ENABLED, inside its campaign) with optional keywords. Dry run unless confirm=true",
    {
      campaignId: Id,
      name: z.string().min(1),
      cpcBid: z.number().positive().optional().describe("Default max CPC (account currency), manual CPC only"),
      keywords: KeywordList.optional(),
      confirm: Confirm,
    },
    async ({ campaignId, name, cpcBid, keywords, confirm }, ctx) => {
      const adGroup = rn(ctx, "adGroups", "-1");
      const ops: Op[] = [
        {
          entity: "ad_group",
          operation: "create",
          resource: {
            resource_name: adGroup,
            name,
            campaign: rn(ctx, "campaigns", campaignId),
            status: enums.AdGroupStatus.ENABLED,
            type: enums.AdGroupType.SEARCH_STANDARD,
            ...(cpcBid ? { cpc_bid_micros: toMicros(cpcBid) } : {}),
          },
        },
        ...(keywords ?? []).map((k) => ({
          entity: "ad_group_criterion",
          operation: "create" as const,
          resource: {
            ad_group: adGroup,
            status: enums.AdGroupCriterionStatus.ENABLED,
            keyword: { text: k.text, match_type: enums.KeywordMatchType[k.matchType] },
          },
        })),
      ];
      return runAdsWrite(ctx, {
        tool: "ads_create_ad_group",
        summary: `Create ad group "${name}" in campaign ${campaignId} with ${keywords?.length ?? 0} keyword(s)`,
        ops,
        confirm,
      });
    }
  );

  tool(
    "ads_create_rsa",
    "Create a Responsive Search Ad (always PAUSED). 3-15 headlines (≤30 chars), 2-4 descriptions (≤90 chars). Dry run unless confirm=true",
    {
      adGroupId: Id,
      headlines: z.array(z.string().min(1).max(30)).min(3).max(15),
      descriptions: z.array(z.string().min(1).max(90)).min(2).max(4),
      finalUrl: z.string().url(),
      path1: z.string().max(15).optional(),
      path2: z.string().max(15).optional(),
      confirm: Confirm,
    },
    async (p, ctx) =>
      runAdsWrite(ctx, {
        tool: "ads_create_rsa",
        summary:
          `Create PAUSED RSA in ad group ${p.adGroupId} → ${p.finalUrl}\n` +
          `Headlines:\n${p.headlines.map((h) => `- ${h}`).join("\n")}\n` +
          `Descriptions:\n${p.descriptions.map((d) => `- ${d}`).join("\n")}`,
        ops: [
          {
            entity: "ad_group_ad",
            operation: "create",
            resource: {
              ad_group: rn(ctx, "adGroups", p.adGroupId),
              status: enums.AdGroupAdStatus.PAUSED,
              ad: {
                final_urls: [p.finalUrl],
                responsive_search_ad: {
                  headlines: p.headlines.map((t) => ({ text: t })),
                  descriptions: p.descriptions.map((t) => ({ text: t })),
                  ...(p.path1 ? { path1: p.path1 } : {}),
                  ...(p.path2 ? { path2: p.path2 } : {}),
                },
              },
            },
          },
        ],
        confirm: p.confirm,
      })
  );

  tool(
    "ads_add_extensions",
    "Add sitelink and/or callout assets to a campaign. Dry run unless confirm=true",
    {
      campaignId: Id,
      sitelinks: z
        .array(
          z.object({
            linkText: z.string().min(1).max(25),
            finalUrl: z.string().url(),
            description1: z.string().max(35).optional(),
            description2: z.string().max(35).optional(),
          })
        )
        .optional(),
      callouts: z.array(z.string().min(1).max(25)).optional(),
      confirm: Confirm,
    },
    async ({ campaignId, sitelinks = [], callouts = [], confirm }, ctx) => {
      if (!sitelinks.length && !callouts.length) return text("Provide sitelinks and/or callouts.");
      const campaign = rn(ctx, "campaigns", campaignId);
      const ops: Op[] = [];
      let tmp = -1;
      const link = (asset: Record<string, unknown>, fieldType: number) => {
        const name = rn(ctx, "assets", String(tmp--));
        ops.push({ entity: "asset", operation: "create", resource: { resource_name: name, ...asset } });
        ops.push({ entity: "campaign_asset", operation: "create", resource: { campaign, asset: name, field_type: fieldType } });
      };
      for (const s of sitelinks) {
        link(
          {
            final_urls: [s.finalUrl],
            sitelink_asset: {
              link_text: s.linkText,
              ...(s.description1 ? { description1: s.description1 } : {}),
              ...(s.description2 ? { description2: s.description2 } : {}),
            },
          },
          enums.AssetFieldType.SITELINK
        );
      }
      for (const c of callouts) link({ callout_asset: { callout_text: c } }, enums.AssetFieldType.CALLOUT);
      return runAdsWrite(ctx, {
        tool: "ads_add_extensions",
        summary: `Add ${sitelinks.length} sitelink(s) and ${callouts.length} callout(s) to campaign ${campaignId}`,
        ops,
        confirm,
      });
    }
  );
}
