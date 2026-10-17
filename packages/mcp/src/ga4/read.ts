// GA4 read tools: reports against the profile's GA4 property.

import { z } from "zod";
import { Tool, text } from "../core/tool.js";
import * as ga4 from "./client.js";
import { GA4DateRangeEnum, CustomDateFrom, CustomDateTo, Limit, OutputFormat } from "../shared-schemas.js";

export function registerGa4ReadTools(tool: Tool) {
// Tool: GA4 Traffic Overview
tool(
  "ga4_traffic_overview",
  "Get daily traffic overview from GA4: sessions, users, pageviews, bounce rate, engagement rate, avg session duration",
  {
    dateRange: GA4DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await ga4.trafficOverview(ctx, params.dateRange, params.dateFrom, params.dateTo);
    return text(ga4.formatGA4Output(rows, params.format));
  }
);

// Tool: GA4 Top Pages
tool(
  "ga4_top_pages",
  "Get top pages by pageviews from GA4: see which content performs best with engagement metrics",
  {
    dateRange: GA4DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await ga4.topPages(ctx, params.dateRange, params.dateFrom, params.dateTo, params.limit);
    return text(ga4.formatGA4Output(rows, params.format));
  }
);

// Tool: GA4 Traffic Sources
tool(
  "ga4_traffic_sources",
  "Get traffic source breakdown from GA4: source/medium with sessions, users, bounce rate, conversions",
  {
    dateRange: GA4DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await ga4.trafficSources(ctx, params.dateRange, params.dateFrom, params.dateTo, params.limit);
    return text(ga4.formatGA4Output(rows, params.format));
  }
);

// Tool: GA4 User Demographics
tool(
  "ga4_user_demographics",
  "Get user demographics from GA4: breakdown by country, city, device, or browser",
  {
    dateRange: GA4DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    dimension: z
      .enum(["country", "city", "deviceCategory", "browser"])
      .optional()
      .describe("Dimension to group by. Defaults to country"),
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await ga4.userDemographics(ctx, params.dateRange,
      params.dateFrom,
      params.dateTo,
      params.dimension ?? "country",
      params.limit
    );
    return text(ga4.formatGA4Output(rows, params.format));
  }
);

// Tool: GA4 Conversions
tool(
  "ga4_conversions",
  "Get conversion events from GA4: which events (form submits, calls, etc.) are driving conversions",
  {
    dateRange: GA4DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await ga4.ga4Conversions(ctx, params.dateRange, params.dateFrom, params.dateTo, params.limit);
    return text(ga4.formatGA4Output(rows, params.format));
  }
);

// Tool: GA4 Landing Pages
tool(
  "ga4_landing_pages",
  "Get landing page performance from GA4: entry pages with bounce rate, engagement, and conversions",
  {
    dateRange: GA4DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await ga4.landingPages(ctx, params.dateRange, params.dateFrom, params.dateTo, params.limit);
    return text(ga4.formatGA4Output(rows, params.format));
  }
);

// Tool: GA4 Realtime
tool(
  "ga4_realtime",
  "Get realtime active users and page views from GA4: who is on the site right now",
  {
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await ga4.realtimeOverview(ctx, params.limit);
    return text(ga4.formatGA4Output(rows, params.format));
  }
);

// Tool: GA4 Custom Report
tool(
  "ga4_custom_report",
  "Run a custom GA4 report with any dimensions and metrics. Use for advanced queries not covered by other GA4 tools",
  {
    dimensions: z.array(z.string()).describe("GA4 dimension names (e.g. pagePath, sessionSource, country)"),
    metrics: z.array(z.string()).describe("GA4 metric names (e.g. sessions, totalUsers, bounceRate)"),
    dateRange: GA4DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    limit: Limit,
    orderByMetric: z.string().optional().describe("Metric to order results by (descending)"),
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await ga4.customGA4Report(ctx, params.dimensions,
      params.metrics,
      params.dateRange,
      params.dateFrom,
      params.dateTo,
      params.limit,
      params.orderByMetric
    );
    return text(ga4.formatGA4Output(rows, params.format));
  }
);
}
