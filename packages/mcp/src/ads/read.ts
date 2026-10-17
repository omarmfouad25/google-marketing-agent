// Google Ads read tools: reporting queries against the selected account.

import { z } from "zod";
import type { Ctx } from "../core/context.js";
import { Tool, text } from "../core/tool.js";
import { formatRows, toMarkdownTable } from "../core/format.js";
import * as queries from "./queries.js";
import { checkDates, DateRangeEnum, CustomDateFrom, CustomDateTo, CampaignId, Limit, OutputFormat } from "../shared-schemas.js";

async function runQuery(ctx: Ctx, query: string) {
  return formatRows((await ctx.customer().query(query)) as Record<string, unknown>[]);
}

export function parseDates(params: { dateRange?: string; dateFrom?: string; dateTo?: string }) {
  const customRange = checkDates(params.dateFrom, params.dateTo);
  const dateRange = customRange
    ? undefined
    : (params.dateRange as queries.DateRange) ?? undefined;
  return { dateRange, customRange };
}

export function formatOutput(
  rows: Record<string, unknown>[],
  format?: string
): string {
  if (format === "json") return JSON.stringify(rows, null, 2);
  return toMarkdownTable(rows);
}


export function registerAdsReadTools(tool: Tool) {
// Tool: Account Summary
tool(
  "get_account_summary",
  "Get account-level performance metrics (impressions, clicks, cost, conversions, ROAS)",
  {
    dateRange: DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const { dateRange, customRange } = parseDates(params);
    const rows = await runQuery(ctx, queries.accountSummary(dateRange, customRange));
    return text(formatOutput(rows, params.format));
  }
);

// Tool: Campaign Performance
tool(
  "get_campaign_performance",
  "Get performance metrics for all campaigns (or filter by status). Shows impressions, clicks, CTR, CPC, cost, conversions",
  {
    dateRange: DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    status: z
      .enum(["ENABLED", "PAUSED", "REMOVED"])
      .optional()
      .describe("Filter by campaign status"),
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const { dateRange, customRange } = parseDates(params);
    const rows = await runQuery(
      ctx,
      queries.campaignPerformance(dateRange, customRange, params.status, params.limit)
    );
    return text(formatOutput(rows, params.format));
  }
);

// Tool: Ad Group Performance
tool(
  "get_adgroup_performance",
  "Get performance metrics for ad groups. Optionally filter by campaign or status",
  {
    dateRange: DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    campaignId: CampaignId,
    status: z
      .enum(["ENABLED", "PAUSED", "REMOVED"])
      .optional()
      .describe("Filter by ad group status"),
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const { dateRange, customRange } = parseDates(params);
    const rows = await runQuery(
      ctx,
      queries.adGroupPerformance(
        dateRange,
        customRange,
        params.campaignId,
        params.status,
        params.limit
      )
    );
    return text(formatOutput(rows, params.format));
  }
);

// Tool: Keyword Performance
tool(
  "get_keyword_performance",
  "Get keyword-level performance including quality score, match type, impressions, clicks, cost, conversions",
  {
    dateRange: DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    campaignId: CampaignId,
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const { dateRange, customRange } = parseDates(params);
    const rows = await runQuery(
      ctx,
      queries.keywordPerformance(dateRange, customRange, params.campaignId, params.limit)
    );
    return text(formatOutput(rows, params.format));
  }
);

// Tool: Search Terms Report
tool(
  "get_search_terms",
  "Get actual search queries that triggered your ads: shows what users really searched for, with performance metrics",
  {
    dateRange: DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    campaignId: CampaignId,
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const { dateRange, customRange } = parseDates(params);
    const rows = await runQuery(
      ctx,
      queries.searchTerms(dateRange, customRange, params.campaignId, params.limit)
    );
    return text(formatOutput(rows, params.format));
  }
);

// Tool: Performance by Date
tool(
  "get_performance_by_date",
  "Get daily performance breakdown: trend data for impressions, clicks, cost, conversions over time",
  {
    dateRange: DateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    campaignId: CampaignId,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const { dateRange, customRange } = parseDates(params);
    const rows = await runQuery(
      ctx,
      queries.performanceByDate(dateRange, customRange, params.campaignId)
    );
    return text(formatOutput(rows, params.format));
  }
);

// Tool: Campaign Budgets
tool(
  "get_campaign_budgets",
  "Get budget allocation and spend for all active campaigns",
  {
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await runQuery(ctx, queries.campaignBudgets());
    return text(formatOutput(rows, params.format));
  }
);

// Tool: Raw GAQL Query
tool(
  "run_gaql_query",
  "Run a raw GAQL (Google Ads Query Language) query for advanced reporting. Use this for custom queries not covered by other tools",
  {
    query: z.string().describe("GAQL query string"),
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await runQuery(ctx, params.query);
    return text(formatOutput(rows, params.format));
  }
);
}
