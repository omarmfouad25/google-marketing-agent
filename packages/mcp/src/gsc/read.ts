// Search Console read tools: analytics, URL inspection and sitemaps for the profile's site.

import { z } from "zod";
import { Tool, text } from "../core/tool.js";
import * as gsc from "./client.js";
import { GSCDateRangeEnum, CustomDateFrom, CustomDateTo, Limit, OutputFormat } from "../shared-schemas.js";

export function registerGscReadTools(tool: Tool) {
// Tool: GSC Search Analytics
tool(
  "gsc_search_analytics",
  "Flexible Google Search Console query: get clicks, impressions, CTR, avg position by any dimension (query, page, country, device, date, searchAppearance)",
  {
    dimensions: z
      .array(z.enum(["query", "page", "country", "device", "date", "searchAppearance"]))
      .optional()
      .describe("Dimensions to group by. Defaults to ['query']"),
    dateRange: GSCDateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    searchType: z
      .enum(["web", "image", "video", "news", "discover", "googleNews"])
      .optional()
      .describe("Search type filter. Defaults to web"),
    filters: z
      .array(
        z.object({
          dimension: z.string().describe("Dimension to filter (query, page, country, device)"),
          operator: z
            .enum(["equals", "contains", "notContains", "includingRegex", "excludingRegex"])
            .optional()
            .describe("Filter operator. Defaults to equals"),
          expression: z.string().describe("Filter value"),
        })
      )
      .optional()
      .describe("Dimension filters"),
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await gsc.searchAnalytics(ctx, {
      dimensions: params.dimensions ?? ["query"],
      dateRange: params.dateRange,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      searchType: params.searchType,
      filters: params.filters,
      limit: params.limit,
    });
    return text(gsc.formatGSCOutput(rows, params.format));
  }
);

// Tool: GSC Top Queries
tool(
  "gsc_top_queries",
  "Get top search queries from Google Search Console by clicks: see what users search to find your site",
  {
    dateRange: GSCDateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    limit: Limit,
    country: z
      .string()
      .optional()
      .describe("3-letter country code filter (e.g. USA, GBR, DEU)"),
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await gsc.topQueries(ctx, params.dateRange,
      params.dateFrom,
      params.dateTo,
      params.limit,
      params.country
    );
    return text(gsc.formatGSCOutput(rows, params.format));
  }
);

// Tool: GSC Top Pages
tool(
  "gsc_top_pages",
  "Get top pages from Google Search Console by clicks: see which pages get the most organic search traffic",
  {
    dateRange: GSCDateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await gsc.topPages(ctx, params.dateRange,
      params.dateFrom,
      params.dateTo,
      params.limit
    );
    return text(gsc.formatGSCOutput(rows, params.format));
  }
);

// Tool: GSC Query-Page Matrix
tool(
  "gsc_query_page_matrix",
  "Cross-reference which search queries drive traffic to which pages: find content gaps and cannibalization",
  {
    dateRange: GSCDateRangeEnum,
    dateFrom: CustomDateFrom,
    dateTo: CustomDateTo,
    limit: Limit,
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await gsc.queryPageMatrix(ctx, params.dateRange,
      params.dateFrom,
      params.dateTo,
      params.limit
    );
    return text(gsc.formatGSCOutput(rows, params.format));
  }
);

// Tool: GSC Index Status
tool(
  "gsc_index_status",
  "Inspect a specific URL's index status in Google: coverage, crawl info, mobile usability, rich results",
  {
    url: z.string().describe("Full URL to inspect (e.g. https://www.example.com/products)"),
    format: OutputFormat,
  },
  async (params, ctx) => {
    const result = await gsc.inspectUrl(ctx, params.url);
    return text(gsc.formatGSCOutput(result, params.format));
  }
);

// Tool: GSC Sitemaps
tool(
  "gsc_sitemaps",
  "List submitted sitemaps and their status: see submission dates, errors, warnings, and pending state",
  {
    format: OutputFormat,
  },
  async (params, ctx) => {
    const rows = await gsc.listSitemaps(ctx);
    return text(gsc.formatGSCOutput(rows, params.format));
  }
);
}
