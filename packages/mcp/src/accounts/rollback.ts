// rollback: restore the state from before one logged Change, in any product (docs/adr/0003).
// Drift (the state moved on since the Change) is shown and refused unless acceptDrift.

import { z } from "zod";
import { enums } from "google-ads-api";
import type { Ctx } from "../core/context.js";
import { Tool, text } from "../core/tool.js";
import { ChangeEntry, getChange, listChanges } from "../core/changelog.js";
import { NOT_REMOVABLE, readSnapshot, rollbackOps, snapshotQueries } from "../core/snapshot.js";
import { getPath } from "../core/paths.js";
import { assertWritable, runAdsWrite } from "../core/runner.js";
import { Confirm, gated } from "../core/confirm.js";
import { formatError } from "../core/errors.js";
import { WORKSPACE_ROLLBACK, containerPath, gtm, liveVersion, logged, scopeContainers } from "../gtm/shared.js";
import { admin, property } from "../ga4/admin.js";

const NOT_ROLLED_BACK = "not possible: a rollback can't itself be rolled back. Re-run the original change instead.";

// created resources carry their status as a number; REMOVED is 3 or 4 depending on the enum
const STATUS_ENUM: Record<string, Record<string | number, string | number>> = {
  campaign: enums.CampaignStatus,
  campaign_budget: enums.BudgetStatus,
  ad_group: enums.AdGroupStatus,
  ad_group_ad: enums.AdGroupAdStatus,
  ad_group_criterion: enums.AdGroupCriterionStatus,
  conversion_action: enums.ConversionActionStatus,
  custom_conversion_goal: enums.CustomConversionGoalStatus,
};
const statusName = (entity: string, v: unknown) => String(STATUS_ENUM[entity]?.[v as number] ?? v);
const SAFE_NAME = /^customers\/\d+\/[A-Za-z]+\/[\w~]+$/;
const primitive = (v: unknown) => v === null || typeof v !== "object";
// the API can return a logged number as a string (int64 micros), so primitives compare by their text
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b) || (primitive(a) && primitive(b) && String(a) === String(b));

type Opts = { acceptDrift: boolean; confirm?: string };

/** Drift on the fields an Ads Change updated */
async function updateDrift(ctx: Ctx, e: ChangeEntry): Promise<string[]> {
  const drift: string[] = [];
  const updates = (e.ops ?? []).filter((op) => op.operation === "update");
  for (const q of snapshotQueries(updates)) {
    const op = updates.find((u) => u.resource.resource_name === q.resource_name)!;
    const row = (await ctx.customer().query(q.gaql))[0];
    if (!row) {
      drift.push(`${q.resource_name} no longer exists`);
      continue;
    }
    const now = readSnapshot(row, q).values;
    for (const f of q.fields) {
      const set = getPath(op.resource, f);
      if (!same(now[f], set)) drift.push(`${q.resource_name} ${f}: now ${JSON.stringify(now[f])}, the change set ${JSON.stringify(set)}`);
    }
  }
  return drift;
}

/** Drift on what an Ads Change created (a different status), and the created resources that are already gone */
async function createdDrift(ctx: Ctx, e: ChangeEntry): Promise<{ drift: string[]; gone: Set<string> }> {
  const drift: string[] = [];
  const gone = new Set<string>();
  for (const c of e.created ?? []) {
    if (c.status === undefined || NOT_REMOVABLE.has(c.entity)) continue;
    if (!SAFE_NAME.test(c.resource_name)) throw new Error(`Refusing to check unexpected resource name: ${JSON.stringify(c.resource_name)}`);
    const row: any = (await ctx.customer().query(`SELECT ${c.entity}.status FROM ${c.entity} WHERE ${c.entity}.resource_name = '${c.resource_name}'`))[0];
    const now = row ? statusName(c.entity, row[c.entity]?.status) : "REMOVED";
    if (now === "REMOVED") gone.add(c.resource_name);
    else if (now !== statusName(c.entity, c.status)) drift.push(`${c.resource_name} was created ${statusName(c.entity, c.status)} and is now ${now}: rolling back removes it`);
  }
  return { drift, gone };
}

const driftRefusal = (drift: string[]) =>
  text(`DRIFT (nothing changed): the account moved on since this change.\n- ${drift.join("\n- ")}\n\nRolling back would overwrite this. If that is intended, call rollback again with acceptDrift: true.`);
const driftNote = (drift: string[]) => (drift.length ? `\nOverwrites Drift:\n- ${drift.join("\n- ")}` : "");

async function rollbackAds(ctx: Ctx, e: ChangeEntry, { acceptDrift, confirm }: Opts) {
  let plan;
  try {
    plan = rollbackOps(e);
  } catch (err) {
    return text(`REFUSED (nothing changed): ${err instanceof Error ? err.message : String(err)}`);
  }
  let drift: string[];
  let gone: Set<string>;
  try {
    const created = await createdDrift(ctx, e);
    drift = [...(await updateDrift(ctx, e)), ...created.drift];
    gone = created.gone;
  } catch (err) {
    return text(`REFUSED (nothing changed): couldn't check what changed since ${e.id}: ${formatError(err)}`);
  }
  const ops = plan.ops.filter((op) => !(op.operation === "remove" && gone.has(op.resource)));
  const skipped = [...plan.skipped, ...[...gone].map((r) => `${r} already removed`)];
  const notReverted = skipped.length ? `\nNot reverted:\n- ${skipped.join("\n- ")}` : "";
  if (!ops.length) return text(`Nothing to roll back for ${e.id}.${notReverted}`);
  if (drift.length && !acceptDrift) return driftRefusal(drift);
  return runAdsWrite(ctx, {
    tool: "rollback",
    summary: `Rollback of ${e.id} (${e.tool}: ${e.summary}): ${ops.length} operation(s)${notReverted}${driftNote(drift)}`,
    ops,
    confirm,
    rollback: NOT_ROLLED_BACK,
    extra: { rollbackOf: e.id },
  });
}

async function rollbackGtm(ctx: Ctx, e: ChangeEntry, { acceptDrift, confirm }: Opts) {
  if (e.action !== "publish" && e.action !== "republish") return text(`REFUSED (nothing changed): ${e.id} is a workspace edit, so rollback is ${WORKSPACE_ROLLBACK}`);
  const container = e.container as string | undefined;
  const target = e.previousLive as string | undefined;
  const left = (e.action === "publish" ? e.newVersion : e.versionId) as string;
  if (!container) return text(`REFUSED (nothing changed): ${e.id} was logged before 0.4 without its container. Re-publish version ${target ?? "<previous>"} yourself with gtm_publish versionId.`);
  if (!target) return text(`REFUSED (nothing changed): ${e.id} published the container's first version, so there is nothing to go back to.`);
  // writes stay inside the Profile scope (docs/adr/0002), also for a rollback
  const scope = await Promise.all(scopeContainers(ctx.profile).map((id) => containerPath(ctx, id).catch(() => undefined)));
  if (!scope.includes(container)) return text(`REFUSED (nothing changed): ${container} is outside profile "${ctx.alias}". Add it to the profile's gtmContainerIds in accounts.json.`);
  const live = (await liveVersion(ctx, container))?.containerVersionId ?? undefined;
  const drift = live === left ? [] : [`the live version is now ${live ?? "none"}, not version ${left} that this change left live`];
  if (drift.length && !acceptDrift) return driftRefusal(drift);
  const g = await gated(ctx, {
    tool: "rollback",
    confirm,
    headline: `PREVIEW: ROLLBACK ${e.id} (${e.summary}): re-publish version ${target} (live is ${live ?? "none"}, nothing changed)${driftNote(drift)}`,
    state: { container, live },
    rollback: NOT_ROLLED_BACK,
  });
  if (typeof g !== "string") return g;
  await gtm(ctx).accounts.containers.versions.publish({ path: `${container}/versions/${target}` });
  return logged(ctx, { product: "gtm", tool: "rollback", summary: `rollback of ${e.id}: republish version ${target}`, confirmation: g, rollbackOf: e.id, action: "republish", container, versionId: target, previousLive: live }, { applied: `Version ${target} is live again`, previousLive: live ?? "none" });
}

async function rollbackGa4(ctx: Ctx, e: ChangeEntry, { confirm }: Opts) {
  const parent = property(ctx);
  const api = admin(ctx).properties;
  const apply = async (headline: string, run: () => Promise<unknown>, rollback: string) => {
    const g = await gated(ctx, { tool: "rollback", confirm, headline: `PREVIEW: ROLLBACK ${e.id} (${e.summary}): ${headline} (nothing changed)`, detail: { property: parent }, rollback });
    if (typeof g !== "string") return g;
    await run();
    return logged(ctx, { product: "ga4", tool: "rollback", summary: `rollback of ${e.id}: ${headline}`, confirmation: g, rollbackOf: e.id }, { applied: `Rolled back ${e.id}: ${headline}` });
  };
  if (e.tool === "ga4_set_key_event") {
    const eventName = e.eventName as string;
    const existing = (await api.keyEvents.list({ parent })).data.keyEvents?.find((k) => k.eventName === eventName);
    if (e.action === "create") {
      if (!existing) return text(`Nothing to roll back: "${eventName}" is no longer a key event.`);
      return apply(`unmark key event "${eventName}"`, () => api.keyEvents.delete({ name: existing.name! }), NOT_ROLLED_BACK);
    }
    if (existing) return text(`Nothing to roll back: "${eventName}" is a key event again.`);
    const countingMethod = ((e.before as { countingMethod?: string } | undefined)?.countingMethod ?? "ONCE_PER_EVENT") as string;
    return apply(`mark "${eventName}" as a key event again (${countingMethod})`, () => api.keyEvents.create({ parent, requestBody: { eventName, countingMethod } }), NOT_ROLLED_BACK);
  }
  if (e.tool === "ga4_custom_dimensions" && e.action === "create") {
    const name = e.result as string;
    const dims = (await api.customDimensions.list({ parent, pageSize: 200 })).data.customDimensions ?? [];
    if (!dims.some((d) => d.name === name)) return text(`Nothing to roll back: ${name} is already archived.`);
    return apply(`archive custom dimension ${name} (permanent)`, () => api.customDimensions.archive({ name }), NOT_ROLLED_BACK);
  }
  return text(`REFUSED (nothing changed): ${e.id} (${e.tool} ${e.action ?? ""}) can't be rolled back: archived custom dimensions can't be restored.`);
}

export function registerRollback(tool: Tool) {
  tool(
    "rollback",
    "Roll back one applied change from the change log (changes_list shows IDs), in any product: Google Ads restores prior values and removes what it created; " +
      "a Tag Manager publish re-publishes the version that was live before; GA4 key events are unmarked or marked again. If the account moved on since the change " +
      "(Drift, e.g. a later edit or a newer live version) it is refused unless acceptDrift: true. Anything it can't roll back is listed. " +
      "Preview first; apply with confirm set to its Preview ID",
    {
      changeId: z.string().min(1),
      acceptDrift: z.boolean().optional().describe("Overwrite changes made since this change (shown in the DRIFT refusal)"),
      confirm: Confirm,
    },
    async ({ changeId, acceptDrift, confirm }, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      const entry = getChange(ctx.alias, changeId);
      if (!entry) return text(`No change "${changeId}" for profile ${ctx.alias}. Use changes_list to see recent IDs.`);
      if (entry.rollbackOf) return text(`${entry.id} is itself a rollback; re-run the original change instead (nothing changed).`);
      const done = listChanges(ctx.alias, Number.MAX_SAFE_INTEGER).find((e) => e.rollbackOf === changeId);
      if (done) return text(`Already rolled back by ${done.id}: nothing changed.`);
      const opts = { acceptDrift: acceptDrift === true, confirm };
      if (entry.product === "ads") return rollbackAds(ctx, entry, opts);
      if (entry.product === "gtm") return rollbackGtm(ctx, entry, opts);
      return rollbackGa4(ctx, entry, opts);
    }
  );
}
