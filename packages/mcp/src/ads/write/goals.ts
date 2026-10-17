import { z } from "zod";
import { enums } from "google-ads-api";
import type { Tool } from "../../core/tool.js";
import { text } from "../../core/tool.js";
import { assertWritable, runAdsWrite } from "../../core/runner.js";
import type { Op } from "../../core/changelog.js";
import { Confirm, Id, rn, rows } from "./shared.js";

const GoalCategory = z.enum(["DEFAULT", "SUBMIT_LEAD_FORM", "OUTBOUND_CLICK", "CONTACT", "PHONE_CALL_LEAD", "PAGE_VIEW", "PURCHASE", "GET_DIRECTIONS"]);

/** conversionId and label from a tag snippet ("send_to': 'AW-<id>/<label>'"), for gtm_build ads_conversion_tag */
export function parseSendTo(snippets: { event_snippet?: string }[] | undefined) {
  for (const s of snippets ?? []) {
    const m = /AW-(\d+)\/([\w-]+)/.exec(s.event_snippet ?? "");
    if (m) return { conversionId: m[1], conversionLabel: m[2] };
  }
  return undefined;
}

export function registerGoals(tool: Tool) {
  tool(
    "ads_set_conversion_primary",
    "Make conversion actions primary (used for bidding) or secondary (reporting only). Preview first; apply with confirm set to its Preview ID",
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
    "ads_create_conversion_action",
    "Create a website (WEBPAGE) conversion action, e.g. a lead form or contact click, and print its conversion ID and label for gtm_build ads_conversion_tag. Counting defaults to ONE_PER_CLICK (right for leads). A primary action starts counting in bidding for campaigns using that goal category: primary false to stage it. Preview first; apply with confirm set to its Preview ID; rollback removes it",
    {
      name: z.string().min(1).max(100).refine((s) => !/['\\]/.test(s), "no quotes or backslashes").refine((s) => !/[\r\n\x00-\x1f]/.test(s), "no newlines or control characters"),
      category: z.enum(["SUBMIT_LEAD_FORM", "CONTACT", "PHONE_CALL_LEAD", "BOOK_APPOINTMENT", "REQUEST_QUOTE", "SIGNUP", "OUTBOUND_CLICK", "PURCHASE", "PAGE_VIEW", "DEFAULT"]),
      countingType: z.enum(["ONE_PER_CLICK", "MANY_PER_CLICK"]).optional().describe("Default ONE_PER_CLICK; MANY_PER_CLICK for purchases"),
      value: z.number().positive().optional().describe("Default value per conversion"),
      currency: z.string().regex(/^[A-Z]{3}$/).optional().describe("Defaults to the profile currency"),
      primary: z.boolean().optional().describe("Default true (used for bidding)"),
      clickThroughWindowDays: z.number().int().min(1).max(90).optional().describe("Default 30"),
      confirm: Confirm,
    },
    async ({ name, category, countingType, value, currency, primary, clickThroughWindowDays, confirm }, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      if (/['\\]/.test(name)) return text("The name can't contain quotes or backslashes.");
      if (/[\r\n\x00-\x1f]/.test(name)) return text("The name can't contain newlines or control characters.");
      const [dup] = await rows(ctx, `SELECT conversion_action.id, conversion_action.name FROM conversion_action WHERE conversion_action.name = '${name}' AND conversion_action.status != 'REMOVED'`);
      if (dup) return text(`A conversion action named "${name}" already exists (id ${dup.conversion_action.id}). Reuse it, or rename with ads_update_conversion_action.`);
      const counting = countingType ?? "ONE_PER_CLICK";
      const resource: Record<string, unknown> = {
        name,
        type: enums.ConversionActionType.WEBPAGE,
        category: enums.ConversionActionCategory[category],
        counting_type: enums.ConversionActionCountingType[counting],
        status: enums.ConversionActionStatus.ENABLED,
        primary_for_goal: primary ?? true,
        click_through_lookback_window_days: clickThroughWindowDays ?? 30,
      };
      if (value !== undefined) resource.value_settings = { default_value: value, default_currency_code: currency ?? ctx.profile.currency, always_use_default_value: false };
      const result = await runAdsWrite(ctx, {
        tool: "ads_create_conversion_action",
        summary: `Create conversion action "${name}" (${category}, ${counting}${value !== undefined ? `, value ${value}` : ""}, ${primary ?? true ? "primary" : "secondary"})`,
        ops: [{ entity: "conversion_action", operation: "create", resource }],
        confirm,
      });
      const out = result.content[0].text;
      if (!out.startsWith("APPLIED")) return result;
      const [row] = await rows(ctx, `SELECT conversion_action.id, conversion_action.tag_snippets FROM conversion_action WHERE conversion_action.name = '${name}' AND conversion_action.status != 'REMOVED'`).catch(() => []);
      const ids = parseSendTo(row?.conversion_action?.tag_snippets);
      return text(`${out}\n\n${ids ? `For gtm_build ads_conversion_tag: conversionId "${ids.conversionId}", conversionLabel "${ids.conversionLabel}"` : "Couldn't read the tag snippet yet: run_gaql_query SELECT conversion_action.tag_snippets FROM conversion_action WHERE conversion_action.name = '<name>'"}`);
    }
  );

  tool(
    "ads_update_conversion_action",
    "Rename a conversion action and/or change its category, counting (ONE_PER_CLICK / MANY_PER_CLICK) or primary flag. Tag labels are unchanged. Preview first; apply with confirm set to its Preview ID",
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
    "Create a custom conversion goal from specific conversion actions (e.g. 'B2B Leads'). Preview first; apply with confirm set to its Preview ID",
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
    "Make a campaign bid on a custom goal instead of account/category goals. Find goal IDs with run_gaql_query on custom_conversion_goal. Preview first; apply with confirm set to its Preview ID",
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
    "Choose which conversion categories (website origin) a campaign bids on. Unlisted categories are left as they are. Preview first; apply with confirm set to its Preview ID",
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
