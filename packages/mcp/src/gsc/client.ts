// Google Search Console client: reads run against the profile's gscSiteUrl with the shared OAuth login.

import { google, searchconsole_v1 } from "googleapis";
import { Ctx, requireField } from "../core/context.js";
import { checkDates } from "../shared-schemas.js";
import { toMarkdownTable } from "../core/format.js";

const source = (ctx: Ctx) => ({ client: google.searchconsole({ version: "v1", auth: ctx.oauth() }), siteUrl: requireField(ctx, "gscSiteUrl") });

// --- Date helpers ---

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0]!;
}

export type GSCDateRange = { startDate: string; endDate: string };

const gscRangeMap = (): Record<string, GSCDateRange> => ({
  LAST_7_DAYS: { startDate: daysAgo(10), endDate: daysAgo(3) },
  LAST_28_DAYS: { startDate: daysAgo(31), endDate: daysAgo(3) },
  LAST_3_MONTHS: { startDate: daysAgo(93), endDate: daysAgo(3) },
  LAST_6_MONTHS: { startDate: daysAgo(183), endDate: daysAgo(3) },
  LAST_12_MONTHS: { startDate: daysAgo(368), endDate: daysAgo(3) },
  LAST_16_MONTHS: { startDate: daysAgo(489), endDate: daysAgo(3) },
});

function buildDateRange(
  dateRange?: string,
  dateFrom?: string,
  dateTo?: string
): GSCDateRange {
  const custom = checkDates(dateFrom, dateTo);
  if (custom) return { startDate: custom.from, endDate: custom.to };
  const map = gscRangeMap();
  return map[dateRange ?? ""] ?? map["LAST_28_DAYS"]!;
}

// --- Core search analytics ---

export type SearchAnalyticsParams = {
  dimensions?: string[];
  dateRange?: string;
  dateFrom?: string;
  dateTo?: string;
  searchType?: string;
  filters?: Array<{
    dimension: string;
    operator?: string;
    expression: string;
  }>;
  limit?: number;
};

export async function searchAnalytics(
  ctx: Ctx,
  params: SearchAnalyticsParams
): Promise<Record<string, unknown>[]> {
  const { client, siteUrl } = source(ctx);
  const range = buildDateRange(params.dateRange, params.dateFrom, params.dateTo);
  const dimensions = params.dimensions ?? ["query"];

  const requestBody: searchconsole_v1.Schema$SearchAnalyticsQueryRequest = {
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions,
    rowLimit: params.limit ?? 50,
    type: params.searchType ?? "web",
  };

  if (params.filters && params.filters.length > 0) {
    requestBody.dimensionFilterGroups = [
      {
        filters: params.filters.map((f) => ({
          dimension: f.dimension,
          operator: f.operator ?? "equals",
          expression: f.expression,
        })),
      },
    ];
  }

  const res = await client.searchanalytics.query({
    siteUrl,
    requestBody,
  });

  if (!res.data.rows || res.data.rows.length === 0) return [];

  return res.data.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    row.keys?.forEach((key, i) => {
      obj[dimensions[i]!] = key;
    });
    obj.clicks = row.clicks ?? 0;
    obj.impressions = row.impressions ?? 0;
    obj.ctr = row.ctr ? parseFloat((row.ctr * 100).toFixed(2)) : 0;
    obj.position = row.position ? parseFloat(row.position.toFixed(1)) : 0;
    return obj;
  });
}

// --- Convenience wrappers ---

export async function topQueries(
  ctx: Ctx,
  dateRange?: string,
  dateFrom?: string,
  dateTo?: string,
  limit?: number,
  country?: string
): Promise<Record<string, unknown>[]> {
  const filters = country
    ? [{ dimension: "country", expression: country }]
    : undefined;

  return searchAnalytics(ctx, {
    dimensions: ["query"],
    dateRange,
    dateFrom,
    dateTo,
    limit: limit ?? 30,
    filters,
  });
}

export async function topPages(
  ctx: Ctx,
  dateRange?: string,
  dateFrom?: string,
  dateTo?: string,
  limit?: number
): Promise<Record<string, unknown>[]> {
  return searchAnalytics(ctx, {
    dimensions: ["page"],
    dateRange,
    dateFrom,
    dateTo,
    limit: limit ?? 20,
  });
}

export async function queryPageMatrix(
  ctx: Ctx,
  dateRange?: string,
  dateFrom?: string,
  dateTo?: string,
  limit?: number
): Promise<Record<string, unknown>[]> {
  return searchAnalytics(ctx, {
    dimensions: ["query", "page"],
    dateRange,
    dateFrom,
    dateTo,
    limit: limit ?? 50,
  });
}

// --- URL Inspection ---

export async function inspectUrl(
  ctx: Ctx,
  url: string
): Promise<Record<string, unknown>> {
  const { client, siteUrl } = source(ctx);

  const res = await client.urlInspection.index.inspect({
    requestBody: {
      inspectionUrl: url,
      siteUrl,
    },
  });

  const result = res.data.inspectionResult;
  if (!result) return { error: "No inspection result returned" };

  return {
    url,
    verdict: result.indexStatusResult?.verdict ?? "unknown",
    coverageState: result.indexStatusResult?.coverageState ?? "unknown",
    robotsTxtState: result.indexStatusResult?.robotsTxtState ?? "unknown",
    indexingState: result.indexStatusResult?.indexingState ?? "unknown",
    lastCrawlTime: result.indexStatusResult?.lastCrawlTime ?? "unknown",
    pageFetchState: result.indexStatusResult?.pageFetchState ?? "unknown",
    crawledAs: result.indexStatusResult?.crawledAs ?? "unknown",
    mobileUsability: result.mobileUsabilityResult?.verdict ?? "unknown",
    richResults: result.richResultsResult?.verdict ?? "unknown",
  };
}

// --- Sitemaps ---

export async function listSitemaps(ctx: Ctx): Promise<Record<string, unknown>[]> {
  const { client, siteUrl } = source(ctx);

  const res = await client.sitemaps.list({
    siteUrl,
  });

  if (!res.data.sitemap || res.data.sitemap.length === 0) return [];

  return res.data.sitemap.map((s) => ({
    path: s.path ?? "",
    lastSubmitted: s.lastSubmitted ?? "",
    isPending: s.isPending ?? false,
    isSitemapsIndex: s.isSitemapsIndex ?? false,
    type: s.type ?? "",
    lastDownloaded: s.lastDownloaded ?? "",
    warnings: s.warnings ?? 0,
    errors: s.errors ?? 0,
  }));
}

// --- Output formatter ---

export function formatGSCOutput(
  rows: Record<string, unknown>[] | Record<string, unknown>,
  format?: string
): string {
  if (format === "json") return JSON.stringify(rows, null, 2);

  // Single object (e.g., inspectUrl result)
  if (!Array.isArray(rows)) {
    return Object.entries(rows)
      .map(([k, v]) => `**${k}:** ${v}`)
      .join("\n");
  }

  return toMarkdownTable(rows, false);
}
