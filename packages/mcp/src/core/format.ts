// Formatting for Google Ads rows: micros to currency, enum numbers to names, markdown tables.
import { enums } from "google-ads-api";

/** Convert micros (1/1,000,000) to currency value */
export function fromMicros(micros: number | string | Long): number {
  const val = typeof micros === "object" ? Number(micros) : Number(micros);
  return val / 1_000_000;
}

type Long = { low: number; high: number; unsigned: boolean };

// Money metrics returned in micros without a `_micros` suffix
const MICROS_METRICS = new Set([
  "average_cpc",
  "average_cpm",
  "average_cpe",
  "average_cpv",
  "average_cost",
  "cost_per_conversion",
  "cost_per_all_conversions",
  "cost_per_current_model_attributed_conversion",
]);

// Enum fields keyed by "<parent>.<field>"; the API returns them as numbers
const ENUM_FIELDS: Record<string, keyof typeof enums> = {
  "campaign.status": "CampaignStatus",
  "campaign.serving_status": "CampaignServingStatus",
  "campaign.primary_status": "CampaignPrimaryStatus",
  "campaign.advertising_channel_type": "AdvertisingChannelType",
  "campaign.advertising_channel_sub_type": "AdvertisingChannelSubType",
  "campaign.bidding_strategy_type": "BiddingStrategyType",
  "geo_target_type_setting.positive_geo_target_type": "PositiveGeoTargetType",
  "ad_group.status": "AdGroupStatus",
  "ad_group.type": "AdGroupType",
  "ad_group_ad.status": "AdGroupAdStatus",
  "ad_group_ad.ad_strength": "AdStrength",
  "ad.type": "AdType",
  "policy_summary.approval_status": "PolicyApprovalStatus",
  "policy_summary.review_status": "PolicyReviewStatus",
  "ad_group_criterion.status": "AdGroupCriterionStatus",
  "keyword.match_type": "KeywordMatchType",
  "quality_info.creative_quality_score": "QualityScoreBucket",
  "quality_info.post_click_quality_score": "QualityScoreBucket",
  "quality_info.search_predicted_ctr": "QualityScoreBucket",
  "search_term_view.status": "SearchTermTargetingStatus",
  "campaign_budget.status": "BudgetStatus",
  "campaign_budget.delivery_method": "BudgetDeliveryMethod",
  "segments.device": "Device",
  "segments.ad_network_type": "AdNetworkType",
  "conversion_action.status": "ConversionActionStatus",
  "conversion_action.type": "ConversionActionType",
  "conversion_action.category": "ConversionActionCategory",
  "customer.status": "CustomerStatus",
  "campaign.primary_status_reasons": "CampaignPrimaryStatusReason",
  "campaign_conversion_goal.category": "ConversionActionCategory",
  "campaign_conversion_goal.origin": "ConversionOrigin",
  "conversion_goal_campaign_config.goal_config_level": "GoalConfigLevel",
  "segments.conversion_action_category": "ConversionActionCategory",
  "campaign_asset.field_type": "AssetFieldType",
  "campaign_asset.status": "AssetLinkStatus",
  "customer_asset.field_type": "AssetFieldType",
  "ad_group_asset.field_type": "AssetFieldType",
  "campaign_criterion.type": "CriterionType",
  "ad_group_criterion.type": "CriterionType",
  "shared_set.type": "SharedSetType",
  "shared_set.status": "SharedSetStatus",
  "geographic_view.location_type": "GeoTargetingType",
  "user_list.type": "UserListType",
  "conversion_action.counting_type": "ConversionActionCountingType",
};

function enumName(path: string, value: unknown): unknown {
  const e = ENUM_FIELDS[path];
  if (!e || typeof value !== "number") return value;
  return (enums[e] as Record<number, string>)[value] ?? value;
}

/** Format a row from Google Ads API: micros to currency, enum numbers to names */
export function formatRow(row: Record<string, unknown>, parent = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = formatRow(value as Record<string, unknown>, key);
    } else if (key.endsWith("_micros") && (typeof value === "number" || typeof value === "string")) {
      const cleanKey = key.replace("_micros", "");
      result[cleanKey] = fromMicros(value);
    } else if (MICROS_METRICS.has(key) && (typeof value === "number" || typeof value === "string")) {
      result[key] = fromMicros(value);
    } else {
      const p = `${parent}.${key}`;
      result[key] = Array.isArray(value) ? value.map((v) => enumName(p, v)) : enumName(p, value);
    }
  }

  return result;
}

/** Format an array of rows */
export function formatRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => formatRow(r));
}

/** Build a markdown table from rows */
export function toMarkdownTable(rows: Record<string, unknown>[], flatten = true): string {
  if (rows.length === 0) return "No data found.";

  const flatRows = flatten ? rows.map((r) => flattenObject(r)) : rows;
  const headers = Object.keys(flatRows[0]!);

  const headerRow = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const dataRows = flatRows.map(
    (row) => `| ${headers.map((h) => formatCell(row[h], h)).join(" | ")} |`
  );

  return [headerRow, separator, ...dataRows].join("\n");
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix = ""
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

function formatCell(value: unknown, header = ""): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") {
    // IDs stay copyable: no thousands separators (642263731332, not 642,263,731,332)
    if (/(^|[._])id$|_id$/.test(header)) return String(value);
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toFixed(2);
  }
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.replace(/\|/g, "\\|");
}

/** Convert a currency value to micros (1/1,000,000) */
export function toMicros(value: number): number {
  return Math.round(value * 1_000_000);
}
