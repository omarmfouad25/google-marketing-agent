// GA4 Data API client: reads run against the profile's ga4PropertyId with the shared OAuth login.

import { Ctx, requireField } from "../core/context.js";
import { checkDates } from "../shared-schemas.js";
import { toMarkdownTable } from "../core/format.js";

function source(ctx: Ctx) {
  const client = ctx.ga4Data();
  return { client, property: `properties/${requireField(ctx, "ga4PropertyId")}` };
}

export type GA4DateRange = {
  startDate: string; // YYYY-MM-DD or relative: "today", "yesterday", "7daysAgo", "30daysAgo", "90daysAgo"
  endDate: string;
};

function buildDateRange(
  dateRange?: string,
  dateFrom?: string,
  dateTo?: string
): GA4DateRange {
  const custom = checkDates(dateFrom, dateTo);
  if (custom) return { startDate: custom.from, endDate: custom.to };

  const rangeMap: Record<string, GA4DateRange> = {
    TODAY: { startDate: "today", endDate: "today" },
    YESTERDAY: { startDate: "yesterday", endDate: "yesterday" },
    LAST_7_DAYS: { startDate: "7daysAgo", endDate: "today" },
    LAST_14_DAYS: { startDate: "14daysAgo", endDate: "today" },
    LAST_30_DAYS: { startDate: "30daysAgo", endDate: "today" },
    LAST_90_DAYS: { startDate: "90daysAgo", endDate: "today" },
  };

  return rangeMap[dateRange ?? ""] ?? { startDate: "30daysAgo", endDate: "today" };
}

type GA4ReportParams = {
  dateRange?: string;
  dateFrom?: string;
  dateTo?: string;
  dimensions: string[];
  metrics: string[];
  limit?: number;
  orderBy?: { metric?: string; dimension?: string; desc?: boolean };
  dimensionFilter?: {
    fieldName: string;
    stringFilter: { matchType: string; value: string };
  };
};

async function runReport(ctx: Ctx, params: GA4ReportParams): Promise<Record<string, unknown>[]> {
  const { client, property } = source(ctx);
  const range = buildDateRange(params.dateRange, params.dateFrom, params.dateTo);

  const request: Record<string, unknown> = {
    property,
    dateRanges: [range],
    dimensions: params.dimensions.map((name) => ({ name })),
    metrics: params.metrics.map((name) => ({ name })),
    limit: params.limit ?? 50,
  };

  if (params.orderBy) {
    const order: Record<string, unknown> = { desc: params.orderBy.desc ?? true };
    if (params.orderBy.metric) {
      order.metric = { metricName: params.orderBy.metric };
    } else if (params.orderBy.dimension) {
      order.dimension = { dimensionName: params.orderBy.dimension };
    }
    request.orderBys = [order];
  }

  if (params.dimensionFilter) {
    request.dimensionFilter = {
      filter: {
        fieldName: params.dimensionFilter.fieldName,
        stringFilter: params.dimensionFilter.stringFilter,
      },
    };
  }

  const [response] = await client.runReport(request);

  if (!response.rows || response.rows.length === 0) return [];

  const dimNames = params.dimensions;
  const metNames = params.metrics;

  return response.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    row.dimensionValues?.forEach((dv, i) => {
      obj[dimNames[i]!] = dv.value;
    });
    row.metricValues?.forEach((mv, i) => {
      const val = mv.value ?? "0";
      obj[metNames[i]!] = val.includes(".") ? parseFloat(val) : parseInt(val, 10);
    });
    return obj;
  });
}

async function runRealtimeReport(
  ctx: Ctx,
  dimensions: string[],
  metrics: string[],
  limit?: number
): Promise<Record<string, unknown>[]> {
  const { client, property } = source(ctx);

  const [response] = await client.runRealtimeReport({
    property,
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
    limit: limit ?? 20,
  });

  if (!response.rows || response.rows.length === 0) return [];

  return response.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    row.dimensionValues?.forEach((dv, i) => {
      obj[dimensions[i]!] = dv.value;
    });
    row.metricValues?.forEach((mv, i) => {
      const val = mv.value ?? "0";
      obj[metrics[i]!] = val.includes(".") ? parseFloat(val) : parseInt(val, 10);
    });
    return obj;
  });
}

// --- Exported report functions ---

export async function trafficOverview(
  ctx: Ctx,
  dateRange?: string,
  dateFrom?: string,
  dateTo?: string
): Promise<Record<string, unknown>[]> {
  return runReport(ctx, {
    dateRange,
    dateFrom,
    dateTo,
    dimensions: ["date"],
    metrics: [
      "sessions",
      "totalUsers",
      "newUsers",
      "screenPageViews",
      "bounceRate",
      "averageSessionDuration",
      "engagementRate",
      "engagedSessions",
    ],
    orderBy: { dimension: "date", desc: true },
    limit: 90,
  });
}

export async function topPages(
  ctx: Ctx,
  dateRange?: string,
  dateFrom?: string,
  dateTo?: string,
  limit?: number
): Promise<Record<string, unknown>[]> {
  return runReport(ctx, {
    dateRange,
    dateFrom,
    dateTo,
    dimensions: ["pagePath", "pageTitle"],
    metrics: [
      "screenPageViews",
      "totalUsers",
      "averageSessionDuration",
      "bounceRate",
      "engagementRate",
    ],
    orderBy: { metric: "screenPageViews", desc: true },
    limit: limit ?? 30,
  });
}

export async function trafficSources(
  ctx: Ctx,
  dateRange?: string,
  dateFrom?: string,
  dateTo?: string,
  limit?: number
): Promise<Record<string, unknown>[]> {
  return runReport(ctx, {
    dateRange,
    dateFrom,
    dateTo,
    dimensions: ["sessionSource", "sessionMedium"],
    metrics: [
      "sessions",
      "totalUsers",
      "newUsers",
      "bounceRate",
      "averageSessionDuration",
      "engagementRate",
      "conversions",
    ],
    orderBy: { metric: "sessions", desc: true },
    limit: limit ?? 30,
  });
}

export async function userDemographics(
  ctx: Ctx,
  dateRange?: string,
  dateFrom?: string,
  dateTo?: string,
  dimension: "country" | "city" | "deviceCategory" | "browser" = "country",
  limit?: number
): Promise<Record<string, unknown>[]> {
  return runReport(ctx, {
    dateRange,
    dateFrom,
    dateTo,
    dimensions: [dimension],
    metrics: ["sessions", "totalUsers", "newUsers", "engagementRate", "bounceRate"],
    orderBy: { metric: "sessions", desc: true },
    limit: limit ?? 20,
  });
}

export async function ga4Conversions(
  ctx: Ctx,
  dateRange?: string,
  dateFrom?: string,
  dateTo?: string,
  limit?: number
): Promise<Record<string, unknown>[]> {
  return runReport(ctx, {
    dateRange,
    dateFrom,
    dateTo,
    dimensions: ["eventName"],
    metrics: ["conversions", "totalUsers", "eventCount"],
    orderBy: { metric: "conversions", desc: true },
    limit: limit ?? 20,
  });
}

export async function landingPages(
  ctx: Ctx,
  dateRange?: string,
  dateFrom?: string,
  dateTo?: string,
  limit?: number
): Promise<Record<string, unknown>[]> {
  return runReport(ctx, {
    dateRange,
    dateFrom,
    dateTo,
    dimensions: ["landingPage"],
    metrics: [
      "sessions",
      "totalUsers",
      "bounceRate",
      "averageSessionDuration",
      "engagementRate",
      "conversions",
    ],
    orderBy: { metric: "sessions", desc: true },
    limit: limit ?? 30,
  });
}

export async function realtimeOverview(
  ctx: Ctx,
  limit?: number
): Promise<Record<string, unknown>[]> {
  return runRealtimeReport(
    ctx,
    ["unifiedScreenName"],
    ["activeUsers", "screenPageViews"],
    limit ?? 20
  );
}

export async function customGA4Report(
  ctx: Ctx,
  dimensions: string[],
  metrics: string[],
  dateRange?: string,
  dateFrom?: string,
  dateTo?: string,
  limit?: number,
  orderByMetric?: string
): Promise<Record<string, unknown>[]> {
  return runReport(ctx, {
    dateRange,
    dateFrom,
    dateTo,
    dimensions,
    metrics,
    orderBy: orderByMetric ? { metric: orderByMetric, desc: true } : undefined,
    limit: limit ?? 50,
  });
}

export function formatGA4Output(
  rows: Record<string, unknown>[],
  format?: string
): string {
  if (format === "json") return JSON.stringify(rows, null, 2);
  return toMarkdownTable(rows, false);
}
