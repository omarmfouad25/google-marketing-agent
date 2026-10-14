// Zod fragments shared by the read tools.

import { z } from "zod";

// --- Shared schemas ---
export const DateRangeEnum = z
  .enum([
    "TODAY",
    "YESTERDAY",
    "LAST_7_DAYS",
    "LAST_14_DAYS",
    "LAST_30_DAYS",
    "LAST_90_DAYS",
    "THIS_MONTH",
    "LAST_MONTH",
    "THIS_QUARTER",
    "LAST_QUARTER",
    "THIS_YEAR",
    "LAST_YEAR",
  ])
  .optional()
  .describe("Predefined date range. Defaults to LAST_30_DAYS");

const IsoDay = /^\d{4}-\d{2}-\d{2}$/;

/** Both dates or neither; each must be YYYY-MM-DD (the CLI can bypass zod, so builders call this too). */
export function checkDates(from?: string, to?: string): { from: string; to: string } | undefined {
  if (!from && !to) return undefined;
  if (!from || !to) throw new Error("give both dateFrom and dateTo");
  if (!IsoDay.test(from) || !IsoDay.test(to)) throw new Error("dates must be YYYY-MM-DD");
  return { from, to };
}

export const CustomDateFrom = z
  .string()
  .regex(IsoDay, "YYYY-MM-DD")
  .optional()
  .describe("Custom date range start (YYYY-MM-DD). Overrides dateRange");

export const CustomDateTo = z
  .string()
  .regex(IsoDay, "YYYY-MM-DD")
  .optional()
  .describe("Custom date range end (YYYY-MM-DD). Overrides dateRange");

export const CampaignId = z
  .string()
  .regex(/^\d+$/, "numeric campaign ID")
  .optional()
  .describe("Filter by campaign ID");

export const Limit = z
  .number()
  .optional()
  .describe("Max rows to return");

export const OutputFormat = z
  .enum(["json", "markdown"])
  .optional()
  .describe("Output format: json or markdown table. Defaults to markdown");

// --- GA4 Shared Schemas ---
export const GA4DateRangeEnum = z
  .enum([
    "TODAY",
    "YESTERDAY",
    "LAST_7_DAYS",
    "LAST_14_DAYS",
    "LAST_30_DAYS",
    "LAST_90_DAYS",
  ])
  .optional()
  .describe("Predefined date range. Defaults to LAST_30_DAYS");

// --- GSC Shared Schemas ---
export const GSCDateRangeEnum = z
  .enum([
    "LAST_7_DAYS",
    "LAST_28_DAYS",
    "LAST_3_MONTHS",
    "LAST_6_MONTHS",
    "LAST_12_MONTHS",
    "LAST_16_MONTHS",
  ])
  .optional()
  .describe("Predefined date range. Defaults to LAST_28_DAYS (with 3-day data lag)");
