import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { enums } from "google-ads-api";
import type { Tool } from "../../core/tool.js";
import { text } from "../../core/tool.js";
import { adsRollbackNote, assertWritable, runAdsWrite } from "../../core/runner.js";
import { appendChange } from "../../core/changelog.js";
import type { Op } from "../../core/changelog.js";
import { formatError } from "../../core/errors.js";
import { toMicros } from "../../core/format.js";
import { languageIds } from "../languages.js";
import { Confirm, Id, Languages, geosFor, money, rn } from "./shared.js";

const ImagePaths = z.array(z.string().min(1)).max(20);

export function registerDemandGen(tool: Tool) {
  tool(
    "ads_create_demand_gen_campaign",
    "Create a Demand Gen campaign (always PAUSED) with its own daily budget and presence-only location setting. Locations and languages go on each ad group (ads_create_demand_gen_ad). Assign its goal with ads_assign_custom_goal. Preview first; apply with confirm set to its Preview ID",
    {
      name: z.string().min(1),
      dailyBudget: z.number().positive().describe("Daily budget in the account currency"),
      bidding: z.enum(["MAXIMIZE_CONVERSIONS", "MAXIMIZE_CLICKS"]),
      targetCpa: z.number().positive().optional().describe("Target CPA (account currency), MAXIMIZE_CONVERSIONS only"),
      confirm: Confirm,
    },
    async (p, ctx) => {
      if (p.targetCpa && p.bidding !== "MAXIMIZE_CONVERSIONS") return text("targetCpa only applies to MAXIMIZE_CONVERSIONS.");
      const budget = rn(ctx, "campaignBudgets", "-1");
      const campaign = rn(ctx, "campaigns", "-2");
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
            advertising_channel_type: enums.AdvertisingChannelType.DEMAND_GEN,
            campaign_budget: budget,
            geo_target_type_setting: { positive_geo_target_type: enums.PositiveGeoTargetType.PRESENCE },
            contains_eu_political_advertising: enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
            ...(p.bidding === "MAXIMIZE_CONVERSIONS"
              ? { maximize_conversions: p.targetCpa ? { target_cpa_micros: toMicros(p.targetCpa) } : {} }
              : { target_spend: {} }),
          },
        },
      ];
      return runAdsWrite(ctx, {
        tool: "ads_create_demand_gen_campaign",
        summary:
          `Create PAUSED Demand Gen campaign "${p.name}": ${money(ctx, p.dailyBudget)}/day, ${p.bidding}` +
          `${p.targetCpa ? ` (tCPA ${money(ctx, p.targetCpa)})` : ""}`,
        ops,
        confirm: p.confirm,
      });
    }
  );

  tool(
    "ads_create_demand_gen_ad",
    "Create a Demand Gen ad group (or use an existing one) with one multi-asset image ad (always PAUSED). Images are local JPG/PNG paths: landscape 1.91:1, square 1:1, portrait 4:5, logo 1:1. Preview first; apply with confirm set to its Preview ID",
    {
      campaignId: Id,
      adGroupName: z.string().min(1).optional().describe("Create a new ad group with this name"),
      adGroupId: Id.optional().describe("Or add the ad to this existing ad group"),
      languages: Languages,
      geoTargetIds: z.array(Id).optional().describe("New ad group only. Geo target constant IDs. Defaults to the profile's geos"),
      landscapeImages: ImagePaths.min(1),
      squareImages: ImagePaths.min(1),
      portraitImages: ImagePaths.optional(),
      logoImage: z.string().min(1),
      headlines: z.array(z.string().min(1).max(40)).min(1).max(5),
      descriptions: z.array(z.string().min(1).max(90)).min(1).max(5),
      businessName: z.string().min(1).max(25),
      callToAction: z.string().max(10).optional().describe("Button text, e.g. 'Book now'; omit for automated"),
      finalUrl: z.string().url(),
      confirm: Confirm,
    },
    async (p, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      if (!p.adGroupName === !p.adGroupId) return text("Provide exactly one of adGroupName or adGroupId.");
      const missing = [...p.landscapeImages, ...p.squareImages, ...(p.portraitImages ?? []), p.logoImage].filter((f) => !existsSync(f));
      if (missing.length) return text(`Image file(s) not found:\n${missing.join("\n")}`);

      const ops: Op[] = [];
      let tmp = -10;
      const adGroup = rn(ctx, "adGroups", p.adGroupId ?? "-1");
      if (p.adGroupName) {
        const geos = geosFor(ctx, p.geoTargetIds);
        const langIds = await languageIds(ctx, p.languages ?? ctx.profile.languages ?? ["en"]);
        ops.push({
          entity: "ad_group",
          operation: "create",
          resource: { resource_name: adGroup, name: p.adGroupName, campaign: rn(ctx, "campaigns", p.campaignId), status: enums.AdGroupStatus.ENABLED },
        });
        // Demand Gen targets locations and languages per ad group
        for (const g of geos) {
          ops.push({ entity: "ad_group_criterion", operation: "create", resource: { ad_group: adGroup, location: { geo_target_constant: `geoTargetConstants/${g}` } } });
        }
        for (const l of langIds) {
          ops.push({ entity: "ad_group_criterion", operation: "create", resource: { ad_group: adGroup, language: { language_constant: `languageConstants/${l}` } } });
        }
      }
      const upload = (paths: string[]) =>
        paths.map((path) => {
          const name = rn(ctx, "assets", String(tmp--));
          ops.push({
            entity: "asset",
            operation: "create",
            resource: {
              resource_name: name,
              name: `${basename(path)} ${Date.now()}`, // asset names must be unique in the account
              type: enums.AssetType.IMAGE,
              image_asset: { data: readFileSync(path) },
            },
          });
          return { asset: name };
        });
      const ad = {
        marketing_images: upload(p.landscapeImages),
        square_marketing_images: upload(p.squareImages),
        portrait_marketing_images: upload(p.portraitImages ?? []),
        logo_images: upload([p.logoImage]),
        headlines: p.headlines.map((t) => ({ text: t })),
        descriptions: p.descriptions.map((t) => ({ text: t })),
        business_name: p.businessName,
        ...(p.callToAction ? { call_to_action_text: p.callToAction } : {}),
      };
      ops.push({
        entity: "ad_group_ad",
        operation: "create",
        resource: { ad_group: adGroup, status: enums.AdGroupAdStatus.PAUSED, ad: { final_urls: [p.finalUrl], demand_gen_multi_asset_ad: ad } },
      });
      const images = p.landscapeImages.length + p.squareImages.length + (p.portraitImages?.length ?? 0);
      return runAdsWrite(ctx, {
        tool: "ads_create_demand_gen_ad",
        summary:
          `${p.adGroupName ? `Create ad group "${p.adGroupName}" in` : `Add to ad group ${p.adGroupId} of`} campaign ${p.campaignId}: ` +
          `PAUSED Demand Gen image ad, ${images} image(s) + logo, ${p.headlines.length} headline(s), ` +
          `${p.descriptions.length} description(s), "${p.businessName}" → ${p.finalUrl}`,
        ops,
        confirm: p.confirm,
      });
    }
  );

  tool(
    "ads_demand_gen_audience",
    "Build a Demand Gen audience from existing user lists, an optional new lookalike (seeded from a user list; countryCodes required) and an " +
      "optional new custom segment (search terms + competitor URLs), then attach it to ad groups. Segments are OR'd. " +
      "A new custom segment is its own API call, made first once the change is confirmed (reuse it later via customAudienceId). " +
      "Preview first; apply with confirm set to its Preview ID",
    {
      name: z.string().min(1).describe("Audience name (unique in the account)"),
      adGroupIds: z.array(Id).min(1),
      userListIds: z.array(Id).optional().describe("Existing user lists (Customer Match, remarketing)"),
      lookalikeSeedId: Id.optional().describe("Create a lookalike of this user list"),
      lookalikeLevel: z.enum(["NARROW", "BALANCED", "BROAD"]).optional().describe("Defaults to NARROW"),
      countryCodes: z.array(z.string().length(2)).optional().describe("Lookalike countries (ISO codes). Required with lookalikeSeedId"),
      customSegment: z
        .object({
          keywords: z.array(z.string().min(1)).optional().describe("Search terms people used on Google"),
          urls: z.array(z.string().min(1)).optional().describe("Sites people browse"),
        })
        .optional(),
      customAudienceId: Id.optional().describe("Reuse an existing custom segment instead of customSegment"),
      confirm: Confirm,
    },
    async (p, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      if (p.customSegment && p.customAudienceId) return text("Give customSegment or customAudienceId, not both.");
      if (p.lookalikeSeedId && !p.countryCodes?.length) return text("countryCodes is required with lookalikeSeedId (ISO 3166 country codes for the lookalike).");
      const members = [
        ...(p.customSegment?.keywords ?? []).map((keyword) => ({ member_type: enums.CustomAudienceMemberType.KEYWORD, keyword })),
        ...(p.customSegment?.urls ?? []).map((url) => ({ member_type: enums.CustomAudienceMemberType.URL, url })),
      ];
      if (p.customSegment && !members.length) return text("customSegment needs keywords and/or urls.");

      // A new custom segment is its own API call, made only after the Confirmation. Until then the plan refers to
      // it by a placeholder, so the Preview binds the whole plan (segment included) before anything exists.
      const NEW_SEGMENT = "<new custom segment>";
      const isNew = (s: Record<string, any>) => s.custom_audience?.custom_audience === NEW_SEGMENT;
      const ca = members.length ? { name: `${p.name} | custom segment`, type: enums.CustomAudienceType.SEARCH, members } : undefined;
      const customAudience = p.customAudienceId ? rn(ctx, "customAudiences", p.customAudienceId) : ca ? NEW_SEGMENT : undefined;

      const ops: Op[] = [];
      const segments: Record<string, any>[] = (p.userListIds ?? []).map((id) => ({ user_list: { user_list: rn(ctx, "userLists", id) } }));
      if (p.lookalikeSeedId) {
        const lookalike = rn(ctx, "userLists", "-1");
        ops.push({
          entity: "user_list",
          operation: "create",
          resource: {
            resource_name: lookalike,
            name: `${p.name} | lookalike ${p.lookalikeSeedId}`,
            lookalike_user_list: {
              seed_user_list_ids: [p.lookalikeSeedId],
              expansion_level: enums.LookalikeExpansionLevel[p.lookalikeLevel ?? "NARROW"],
              country_codes: p.countryCodes,
            },
          },
        });
        segments.push({ user_list: { user_list: lookalike } });
      }
      if (customAudience) segments.push({ custom_audience: { custom_audience: customAudience } });
      if (!segments.length) return text("No segments: give userListIds, lookalikeSeedId or a custom segment.");

      const audience = rn(ctx, "audiences", "-2");
      ops.push({
        entity: "audience",
        operation: "create",
        resource: {
          resource_name: audience,
          name: p.name,
          scope: enums.AudienceScope.CUSTOMER,
          dimensions: [{ audience_segments: { segments } }],
        },
      });
      for (const id of p.adGroupIds) {
        ops.push({ entity: "ad_group_criterion", operation: "create", resource: { ad_group: rn(ctx, "adGroups", id), audience: { audience } } });
      }
      const summary =
        `Audience "${p.name}": ${segments.length} segment(s) [user lists ${(p.userListIds ?? []).join(", ") || "none"}` +
        `${p.lookalikeSeedId ? `, lookalike of ${p.lookalikeSeedId} (${p.lookalikeLevel ?? "NARROW"})` : ""}` +
        `${customAudience ? `, ${ca ? `new custom segment "${ca.name}" (${members.length} members)` : "custom segment"}` : ""}] → ad groups ${p.adGroupIds.join(", ")}`;
      const content = { ca, ops, summary };

      if (!p.confirm) {
        if (ca) {
          try {
            await ctx.customer().customAudiences.create([ca], { validate_only: true });
          } catch (err) {
            return text(`PREVIEW FAILED (nothing changed): custom segment\n\n${formatError(err)}`);
          }
        }
        // the batch can only be validated without the segment that doesn't exist yet
        const batch = ops.map((op) => (op.entity !== "audience" ? op : { ...op, resource: { ...op.resource, dimensions: [{ audience_segments: { segments: segments.filter((s) => !isNew(s)) } }] } }));
        const validatable = segments.some((s) => !isNew(s));
        if (validatable) {
          try {
            await ctx.customer().mutateResources(batch as any, { validate_only: true });
          } catch (err) {
            return text(`PREVIEW FAILED (nothing changed)\n\n${summary}\n\n${formatError(err)}`);
          }
        }
        const checked = ca ? `Google validated the custom segment${validatable ? " and the rest of the batch without it (it doesn't exist yet)" : "; the audience can only be checked once the segment exists"}.` : `Google validated ${ops.length} operation(s).`;
        return ctx.gate.preview(ctx, "ads_demand_gen_audience", content, `PREVIEW (nothing changed). ${checked}\n\n${summary}`, adsRollbackNote([...(ca ? [{ entity: "custom_audience", operation: "create" as const, resource: ca }] : []), ...ops]));
      }

      const ok = await ctx.gate.confirm(ctx, "ads_demand_gen_audience", content, p.confirm, summary);
      if ("refused" in ok) return text(ok.refused);
      let note = "";
      let real = ops;
      if (ca) {
        let segment: string;
        try {
          segment = (await ctx.customer().customAudiences.create([ca])).results[0]!.resource_name!;
        } catch (err) {
          return text(`FAILED (nothing changed): custom segment\n\n${formatError(err)}`);
        }
        appendChange(ctx.alias, {
          product: "ads",
          tool: "ads_demand_gen_audience",
          summary: `Create custom segment ${ca.name}`,
          confirmation: ok.kind,
          created: [{ entity: "custom_audience", resource_name: segment }],
        });
        note = `Custom segment created: ${segment} (reuse it later via customAudienceId)\n`;
        real = JSON.parse(JSON.stringify(ops).replaceAll(JSON.stringify(NEW_SEGMENT), JSON.stringify(segment)));
      }
      return runAdsWrite(ctx, { tool: "ads_demand_gen_audience", summary: `${note}${summary}`, ops: real, confirmed: ok.kind });
    }
  );
}
