// Applied changes per account, one JSON line each, with what's needed to revert them.

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { configPaths } from "./config.js";

export type Op = { entity: string; operation: "create" | "update" | "remove"; resource: any };
export type Snapshot = { entity: string; resource_name: string; values: Record<string, unknown> };
export type ChangeEntry = {
  id: string;
  at: string;
  account: string;
  product: "ads" | "gtm" | "ga4";
  tool: string;
  summary: string;
  ops?: Op[];
  before?: Snapshot[];
  created?: { entity: string; resource_name: string }[];
  snapshotError?: string;
  notSnapshotted?: string[];
  [k: string]: unknown;
};

const file = (alias: string) => join(configPaths().changes, `${alias}.jsonl`);

export function appendChange(alias: string, e: Omit<ChangeEntry, "id" | "at" | "account">): ChangeEntry {
  const entry = { id: randomUUID().slice(0, 8), at: new Date().toISOString(), account: alias, ...e } as ChangeEntry;
  const dir = configPaths().changes;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  // uploaded image bytes would bloat the log: record their size instead
  const line = JSON.stringify(entry, (_k, v) => (v instanceof Uint8Array || v?.type === "Buffer" ? `<${v.length ?? v.data?.length} bytes>` : v));
  appendFileSync(file(alias), line + "\n", { mode: 0o600 });
  chmodSync(file(alias), 0o600); // an existing file keeps its old mode
  return entry;
}

export function listChanges(alias: string, limit = 20): ChangeEntry[] {
  if (!existsSync(file(alias))) return [];
  const lines = readFileSync(file(alias), "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).reverse().flatMap((l) => {
    try {
      return [JSON.parse(l) as ChangeEntry];
    } catch {
      return []; // a truncated line must not block every rollback
    }
  });
}

export function getChange(alias: string, id: string): ChangeEntry | undefined {
  return listChanges(alias, Number.MAX_SAFE_INTEGER).find((e) => e.id === id);
}
