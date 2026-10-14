// Prior-state capture for updates and the inverse operations used by ads_rollback. Pure functions.

import { getPath, setPath } from "./paths.js";
import type { ChangeEntry, Op, Snapshot } from "./changelog.js";

// Created resources this rollback can't remove through mutateResources: assets (Google keeps them, unused once the
// ad is removed) and custom segments (own service; remove them in the UI or reuse them via customAudienceId)
const NOT_REMOVABLE = new Set(["asset", "custom_audience"]);

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    if (!prefix && k === "resource_name") return [];
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array) ? flatten(v as Record<string, unknown>, path) : [path];
  });
}

const SAFE_NAME = /^customers\/\d+\/[A-Za-z]+\/[\w~]+$/;

function updates(ops: Op[]) {
  return ops
    .filter((op) => op.operation === "update")
    .map((op) => {
      const name = op.resource.resource_name;
      if (typeof name !== "string" || !SAFE_NAME.test(name)) throw new Error(`Refusing to snapshot unexpected resource name: ${JSON.stringify(name)}`);
      return { op, resource_name: name, fields: flatten(op.resource) };
    });
}

// Updates whose fields flatten to nothing (e.g. maximize_conversions: {}) have nothing to select
export const unsnapshotted = (ops: Op[]) => updates(ops).filter((u) => !u.fields.length).map((u) => u.resource_name);

export function snapshotQueries(ops: Op[]) {
  return updates(ops)
    .filter((u) => u.fields.length)
    .map(({ op, resource_name, fields }) => ({
      entity: op.entity,
      resource_name,
      fields,
      booleans: fields.filter((f) => typeof getPath(op.resource, f) === "boolean"),
      gaql: `SELECT ${fields.map((f) => `${op.entity}.${f}`).join(", ")} FROM ${op.entity} WHERE ${op.entity}.resource_name = '${resource_name}'`,
    }));
}

// A field Google returned as unset/absent is recorded as null (never dropped) so rollback can report it.
// Exception: when a row came back and the op sets a boolean, absence means the proto3 default, false.
export function readSnapshot(row: any, q: { entity: string; resource_name: string; fields: string[]; booleans?: string[] }): Snapshot {
  const values: Record<string, unknown> = {};
  for (const f of q.fields) values[f] = getPath(row?.[q.entity], f) ?? (row && q.booleans?.includes(f) ? false : null);
  return { entity: q.entity, resource_name: q.resource_name, values };
}

export function rollbackOps(e: ChangeEntry): { ops: Op[]; skipped: string[] } {
  if (e.product !== "ads") throw new Error(`Only Google Ads changes roll back here. For Tag Manager, re-publish the previous version with gtm_publish; for GA4 key events, call ga4_set_key_event again.`);
  if (e.snapshotError) throw new Error(`The prior state wasn't captured for change ${e.id} (${e.snapshotError}), so it can't be reverted automatically.`);
  const ops: Op[] = [];
  const skipped: string[] = [];
  for (const s of e.before ?? []) {
    const resource: Record<string, any> = { resource_name: s.resource_name };
    let restorable = 0;
    for (const [path, v] of Object.entries(s.values)) {
      if (v === null || v === undefined) skipped.push(`${s.resource_name} ${path} (no prior value recorded) not reverted`);
      else {
        setPath(resource, path, v);
        restorable++;
      }
    }
    if (restorable) ops.push({ entity: s.entity, operation: "update", resource });
  }
  for (const r of e.notSnapshotted ?? []) skipped.push(`${r} not snapshotted, not reverted`);
  for (const op of e.ops ?? []) if (op.operation === "remove") skipped.push(`${op.resource} removal not reverted`);
  // remove in reverse creation order: criteria/ads, then ad groups, then campaigns, then budgets
  for (const c of [...(e.created ?? [])].reverse()) {
    if (NOT_REMOVABLE.has(c.entity)) skipped.push(`${c.resource_name} (${c.entity} is not removed automatically)`);
    else ops.push({ entity: c.entity, operation: "remove", resource: c.resource_name });
  }
  return { ops, skipped };
}
