import { z } from "zod";
import { enums } from "google-ads-api";
import type { Tool } from "../../core/tool.js";
import { text } from "../../core/tool.js";
import { assertWritable, runAdsWrite } from "../../core/runner.js";
import type { Op } from "../../core/changelog.js";
import { Confirm, Id, rn, rows } from "./shared.js";

const GoalCategory = z.enum(["DEFAULT", "SUBMIT_LEAD_FORM", "OUTBOUND_CLICK", "CONTACT", "PHONE_CALL_LEAD", "PAGE_VIEW", "PURCHASE", "GET_DIRECTIONS"]);

export function registerGoals(tool: Tool) {
  tool(
    "ads_set_conversion_primary",
    "Make conversion actions primary (used for bidding) or secondary (reporting only). Dry run unless confirm=true",
    { conversionActionIds: z.array(Id).min(1), primary: z.boolean(), confirm: Confirm },
    async ({ conversionActionIds, primary, confirm }, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      const found = await rows(
        ctx,
        `SELECT conversion_action.id, conversion_action.name FROM conversion_action WHERE conversion_action.id IN (${conversionActionIds.join(",")})`
      );
      const names = found.map((r) => `"${r.conversion_action.name}"`).join(", ");
      return runAdsWrite(ctx, {
        tool: "ads_set_conversion_primary",
        summary: `Set ${names} → ${primary ? "PRIMARY (bidding)" : "SECONDARY (reporting only)"}`,
        ops: conversionActionIds.map((id) => ({
          entity: "conversion_action",
          operation: "update" as const,
          resource: { resource_name: rn(ctx, "conversionActions", id), primary_for_goal: primary },
        })),
        confirm,
      });
    }
  );

  tool(
    "ads_update_conversion_action",
    "Rename a conversion action and/or change its category, counting (ONE_PER_CLICK / MANY_PER_CLICK) or primary flag. Tag labels are unchanged. Dry run unless confirm=true",
    {
      conversionActionId: Id,
      name: z.string().min(1).optional(),
      category: z.enum(["SUBMIT_LEAD_FORM", "CONTACT", "PHONE_CALL_LEAD", "OUTBOUND_CLICK", "PAGE_VIEW", "DEFAULT"]).optional(),
      countingType: z.enum(["ONE_PER_CLICK", "MANY_PER_CLICK"]).optional(),
      primary: z.boolean().optional(),
      confirm: Confirm,
    },
    async ({ conversionActionId, name, category, countingType, primary, confirm }, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      const [row] = await rows(ctx, `SELECT conversion_action.name FROM conversion_action WHERE conversion_action.id = ${conversionActionId}`);
      if (!row) return text(`Conversion action ${conversionActionId} not found.`);
      const resource: Record<string, unknown> = { resource_name: rn(ctx, "conversionActions", conversionActionId) };
      if (name) resource.name = name;
      if (category) resource.category = enums.ConversionActionCategory[category];
      if (countingType) resource.counting_type = enums.ConversionActionCountingType[countingType];
      if (primary !== undefined) resource.primary_for_goal = primary;
      if (Object.keys(resource).length === 1) return text("Nothing to change.");
      const changes = [
        name && `name → "${name}"`,
        category && `category → ${category}`,
        countingType && `counting → ${countingType}`,
        primary !== undefined && `primary → ${primary}`,
      ].filter(Boolean);
      return runAdsWrite(ctx, {
        tool: "ads_update_conversion_action",
        summary: `"${row.conversion_action.name}" (${conversionActionId}): ${changes.join(", ")}`,
        ops: [{ entity: "conversion_action", operation: "update", resource }],
        confirm,
      });
    }
  );

  tool(
    "ads_create_custom_goal",
    "Create a custom conversion goal from specific conversion actions (e.g. 'B2B Leads'). Dry run unless confirm=true",
    { name: z.string().min(1), conversionActionIds: z.array(Id).min(1), confirm: Confirm },
    async ({ name, conversionActionIds, confirm }, ctx) =>
      runAdsWrite(ctx, {
        tool: "ads_create_custom_goal",
        summary: `Create custom goal "${name}" from conversion actions ${conversionActionIds.join(", ")}`,
        ops: [
          {
            entity: "custom_conversion_goal",
            operation: "create",
            resource: {
              name,
              conversion_actions: conversionActionIds.map((id) => rn(ctx, "conversionActions", id)),
              status: enums.CustomConversionGoalStatus.ENABLED,
            },
          },
        ],
        confirm,
      })
  );

  tool(
    "ads_assign_custom_goal",
    "Make a campaign bid on a custom goal instead of account/category goals. Find goal IDs with run_gaql_query on custom_conversion_goal. Dry run unless confirm=true",
    { campaignId: Id, customGoalId: Id, confirm: Confirm },
    async ({ campaignId, customGoalId, confirm }, ctx) =>
      runAdsWrite(ctx, {
        tool: "ads_assign_custom_goal",
        summary: `Campaign ${campaignId} → bid on custom goal ${customGoalId}`,
        ops: [
          {
            entity: "conversion_goal_campaign_config",
            operation: "update",
            resource: {
              resource_name: rn(ctx, "conversionGoalCampaignConfigs", campaignId),
              goal_config_level: enums.GoalConfigLevel.CAMPAIGN,
              custom_conversion_goal: rn(ctx, "customConversionGoals", customGoalId),
            },
          },
        ],
        confirm,
      })
  );

  tool(
    "ads_set_campaign_goals",
    "Choose which conversion categories (website origin) a campaign bids on. Unlisted categories are left as they are. Dry run unless confirm=true",
    {
      campaignId: Id,
      biddable: z.array(GoalCategory).optional().describe("Categories to bid on"),
      notBiddable: z.array(GoalCategory).optional().describe("Categories to stop bidding on"),
      confirm: Confirm,
    },
    async ({ campaignId, biddable = [], notBiddable = [], confirm }, ctx) => {
      if (!biddable.length && !notBiddable.length) return text("Set biddable and/or notBiddable.");
      const ops: Op[] = [...biddable.map((c) => [c, true] as const), ...notBiddable.map((c) => [c, false] as const)].map(([category, on]) => ({
        entity: "campaign_conversion_goal",
        operation: "update" as const,
        resource: { resource_name: rn(ctx, "campaignConversionGoals", `${campaignId}~${category}~WEBSITE`), biddable: on },
      }));
      return runAdsWrite(ctx, {
        tool: "ads_set_campaign_goals",
        summary: `Campaign ${campaignId} website goals: bid on [${biddable.join(", ")}]; stop bidding on [${notBiddable.join(", ")}]`,
        ops,
        confirm,
      });
    }
  );
}
