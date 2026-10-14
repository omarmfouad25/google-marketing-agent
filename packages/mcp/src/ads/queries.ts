// GAQL query templates for Google Ads reporting

export type DateRange =
  | "TODAY"
  | "YESTERDAY"
  | "LAST_7_DAYS"
  | "LAST_14_DAYS"
  | "LAST_30_DAYS"
  | "LAST_90_DAYS"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_QUARTER"
  | "LAST_QUARTER"
  | "THIS_YEAR"
  | "LAST_YEAR";

export type CustomDateRange = { from: string; to: string };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;

const STATUSES = ["ENABLED", "PAUSED", "REMOVED"];
export function assertStatus(status: string): string {
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(", ")}`);
  return status;
}

export function assertId(id: string): string {
  if (!/^\d+$/.test(id)) throw new Error("campaignId must be numeric");
  return id;
}

// GAQL DURING has no LAST_90_DAYS, THIS/LAST_QUARTER or THIS/LAST_YEAR: compute those as BETWEEN.
// THIS_* run from period start to yesterday, LAST_* cover the whole previous period.
// ponytail: UTC dates, can be one day off the account timezone near midnight; pass dateFrom/dateTo when it matters.
function computedRange(range: DateRange, today: Date): [Date, Date] | undefined {
  const y = today.getUTCFullYear();
  const q = Math.floor(today.getUTCMonth() / 3) * 3;
  const yesterday = new Date(today.getTime() - DAY);
  // first day of a period: yesterday is before the start, so cover just today (like GAQL THIS_MONTH)
  const toYesterday = (start: Date): [Date, Date] => [start, yesterday < start ? today : yesterday];
  const utc = (yy: number, m: number, d: number) => new Date(Date.UTC(yy, m, d));
  switch (range) {
    case "LAST_90_DAYS": return [new Date(today.getTime() - 90 * DAY), yesterday];
    case "THIS_QUARTER": return toYesterday(utc(y, q, 1));
    case "LAST_QUARTER": return [utc(y, q - 3, 1), utc(y, q, 0)];
    case "THIS_YEAR": return toYesterday(utc(y, 0, 1));
    case "LAST_YEAR": return [utc(y - 1, 0, 1), utc(y, 0, 0)];
    default: return undefined;
  }
}

export function buildDateClause(dateRange?: DateRange, customRange?: CustomDateRange, today = new Date()): string {
  if (customRange) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customRange.from) || !/^\d{4}-\d{2}-\d{2}$/.test(customRange.to)) {
      throw new Error("dates must be YYYY-MM-DD");
    }
    return `segments.date BETWEEN '${customRange.from}' AND '${customRange.to}'`;
  }
  const r = dateRange && computedRange(dateRange, today);
  if (r) return `segments.date BETWEEN '${isoDay(r[0])}' AND '${isoDay(r[1])}'`;
  return `segments.date DURING ${dateRange ?? "LAST_30_DAYS"}`;
}

export function accountSummary(
  dateRange?: DateRange,
  customRange?: CustomDateRange
): string {
  return `
    SELECT
      customer.id,
      customer.descriptive_name,
      customer.currency_code,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_per_conversion
    FROM customer
    WHERE ${buildDateClause(dateRange, customRange)}
  `;
}

export function campaignPerformance(
  dateRange?: DateRange,
  customRange?: CustomDateRange,
  status?: string,
  limit?: number
): string {
  const conditions = [buildDateClause(dateRange, customRange)];
  if (status) conditions.push(`campaign.status = '${assertStatus(status)}'`);

  return `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_per_conversion,
      metrics.all_conversions,
      metrics.interaction_rate
    FROM campaign
    WHERE ${conditions.join(" AND ")}
    ORDER BY metrics.cost_micros DESC
    ${limit ? `LIMIT ${limit}` : ""}
  `;
}

export function adGroupPerformance(
  dateRange?: DateRange,
  customRange?: CustomDateRange,
  campaignId?: string,
  status?: string,
  limit?: number
): string {
  const conditions = [buildDateClause(dateRange, customRange)];
  if (campaignId) conditions.push(`campaign.id = ${assertId(campaignId)}`);
  if (status) conditions.push(`ad_group.status = '${assertStatus(status)}'`);

  return `
    SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group.status,
      ad_group.type,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_per_conversion
    FROM ad_group
    WHERE ${conditions.join(" AND ")}
    ORDER BY metrics.cost_micros DESC
    ${limit ? `LIMIT ${limit}` : ""}
  `;
}

export function keywordPerformance(
  dateRange?: DateRange,
  customRange?: CustomDateRange,
  campaignId?: string,
  limit?: number
): string {
  const conditions = [
    buildDateClause(dateRange, customRange),
    "ad_group_criterion.type = 'KEYWORD'",
  ];
  if (campaignId) conditions.push(`campaign.id = ${assertId(campaignId)}`);

  return `
    SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.quality_info.quality_score,
      ad_group_criterion.status,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_per_conversion
    FROM keyword_view
    WHERE ${conditions.join(" AND ")}
    ORDER BY metrics.impressions DESC
    ${limit ? `LIMIT ${limit}` : ""}
  `;
}

export function searchTerms(
  dateRange?: DateRange,
  customRange?: CustomDateRange,
  campaignId?: string,
  limit?: number
): string {
  const conditions = [buildDateClause(dateRange, customRange)];
  if (campaignId) conditions.push(`campaign.id = ${assertId(campaignId)}`);

  return `
    SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      search_term_view.search_term,
      search_term_view.status,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM search_term_view
    WHERE ${conditions.join(" AND ")}
    ORDER BY metrics.clicks DESC
    ${limit ? `LIMIT ${limit}` : ""}
  `;
}

export function performanceByDate(
  dateRange?: DateRange,
  customRange?: CustomDateRange,
  campaignId?: string
): string {
  const conditions = [buildDateClause(dateRange, customRange)];
  if (campaignId) conditions.push(`campaign.id = ${assertId(campaignId)}`);

  return `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE ${conditions.join(" AND ")}
    ORDER BY segments.date DESC
  `;
}

export function campaignBudgets(): string {
  return `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign_budget.amount_micros,
      campaign_budget.total_amount_micros,
      campaign_budget.delivery_method,
      metrics.cost_micros
    FROM campaign
    WHERE campaign.status = 'ENABLED'
    ORDER BY metrics.cost_micros DESC
  `;
}
