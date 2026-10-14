import { z } from "zod";
import { enums } from "google-ads-api";
import type { Tool } from "../../core/tool.js";
import { text } from "../../core/tool.js";
import { runAdsWrite } from "../../core/runner.js";
import type { Op } from "../../core/changelog.js";
import { toMicros } from "../../core/format.js";
import { Confirm, Id, KeywordList, money, rn } from "./shared.js";

export function registerKeywords(tool: Tool) {
  tool(
    "ads_add_keywords",
    "Add keywords to an ad group. Dry run unless confirm=true",
    {
      adGroupId: Id,
      keywords: KeywordList,
      cpcBid: z.number().positive().optional().describe("Optional max CPC (account currency) for all, manual CPC only"),
      confirm: Confirm,
    },
    async ({ adGroupId, keywords, cpcBid, confirm }, ctx) =>
      runAdsWrite(ctx, {
        tool: "ads_add_keywords",
        summary:
          `Add ${keywords.length} keyword(s) to ad group ${adGroupId}${cpcBid ? ` at ${money(ctx, cpcBid)}` : ""}:\n` +
          keywords.map((k) => `- [${k.matchType}] ${k.text}`).join("\n"),
        ops: keywords.map((k) => ({
          entity: "ad_group_criterion",
          operation: "create" as const,
          resource: {
            ad_group: rn(ctx, "adGroups", adGroupId),
            status: enums.AdGroupCriterionStatus.ENABLED,
            keyword: { text: k.text, match_type: enums.KeywordMatchType[k.matchType] },
            ...(cpcBid ? { cpc_bid_micros: toMicros(cpcBid) } : {}),
          },
        })),
        confirm,
      })
  );

  tool(
    "ads_add_negative_keywords",
    "Add campaign-level negative keywords. Dry run unless confirm=true",
    { campaignId: Id, keywords: KeywordList, confirm: Confirm },
    async ({ campaignId, keywords, confirm }, ctx) =>
      runAdsWrite(ctx, {
        tool: "ads_add_negative_keywords",
        summary: `Add ${keywords.length} negative keyword(s) to campaign ${campaignId}:\n` + keywords.map((k) => `- [${k.matchType}] ${k.text}`).join("\n"),
        ops: keywords.map((k) => ({
          entity: "campaign_criterion",
          operation: "create" as const,
          resource: {
            campaign: rn(ctx, "campaigns", campaignId),
            negative: true,
            keyword: { text: k.text, match_type: enums.KeywordMatchType[k.matchType] },
          },
        })),
        confirm,
      })
  );

  tool(
    "ads_negative_list",
    "Shared negative keyword list: create one (name) or add to an existing one (sharedSetId), and attach it to " +
      "campaigns. Dry run unless confirm=true",
    {
      name: z.string().min(1).optional().describe("Create a new list with this name"),
      sharedSetId: Id.optional().describe("Add to this existing list instead"),
      keywords: KeywordList.optional(),
      campaignIds: z.array(Id).optional().describe("Campaigns to attach the list to"),
      confirm: Confirm,
    },
    async ({ name, sharedSetId, keywords, campaignIds, confirm }, ctx) => {
      if (!name === !sharedSetId) return text("Give exactly one of name (new list) or sharedSetId (existing).");
      const set = rn(ctx, "sharedSets", sharedSetId ?? "-1");
      const ops: Op[] = [
        ...(name ? [{ entity: "shared_set", operation: "create" as const, resource: { resource_name: set, name, type: enums.SharedSetType.NEGATIVE_KEYWORDS } }] : []),
        ...(keywords ?? []).map((k) => ({
          entity: "shared_criterion",
          operation: "create" as const,
          resource: { shared_set: set, keyword: { text: k.text, match_type: enums.KeywordMatchType[k.matchType] } },
        })),
        ...(campaignIds ?? []).map((c) => ({
          entity: "campaign_shared_set",
          operation: "create" as const,
          resource: { campaign: rn(ctx, "campaigns", c), shared_set: set },
        })),
      ];
      if (!ops.length) return text("Nothing to do: give keywords and/or campaignIds.");
      return runAdsWrite(ctx, {
        tool: "ads_negative_list",
        summary:
          `${name ? `Create negative list "${name}"` : `Update negative list ${sharedSetId}`}: ` +
          `+${keywords?.length ?? 0} keyword(s), attach to [${(campaignIds ?? []).join(", ")}]\n` +
          (keywords ?? []).map((k) => `- [${k.matchType}] ${k.text}`).join("\n"),
        ops,
        confirm,
      });
    }
  );
}
