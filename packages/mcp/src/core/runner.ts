// The only path for Google Ads writes: guard → Preview, or (Confirmation → snapshot → apply → log).

import type { Ctx } from "./context.js";
import { appendChange, Op, Snapshot } from "./changelog.js";
import { NOT_REMOVABLE, readSnapshot, snapshotQueries, unsnapshotted } from "./snapshot.js";
import type { ConfirmationKind } from "./confirm.js";
import { formatError } from "./errors.js";
import { text, ToolResult } from "./tool.js";

export function assertWritable(ctx: Ctx): string | undefined {
  if (ctx.profile.writes === true) return undefined;
  return `REFUSED: profile "${ctx.alias}" is read-only. Set "writes": true for it in accounts.json to allow changes (see docs/safety.md).`;
}

/** What a Rollback of these operations can't undo, for the Preview (docs/adr/0003) */
export function adsRollbackNote(ops: Op[]): string {
  const kept = ops.filter((op) => op.operation === "create" && NOT_REMOVABLE.has(op.entity)).map((op) => op.entity);
  const removed = ops.filter((op) => op.operation === "remove").length;
  const limits = [
    kept.length && `the ${kept.length} ${[...new Set(kept)].join("/")} resource(s) it creates stay in the account`,
    removed && `the ${removed} removal(s) can't be undone`,
  ].filter(Boolean);
  return limits.length ? `possible with rollback, except: ${limits.join("; ")}.` : "possible with rollback.";
}

type AdsWrite = {
  tool: string;
  summary: string;
  ops: Op[];
  /** The Preview ID to apply; absent = Preview */
  confirm?: string;
  extra?: Record<string, unknown>;
  /** Set when the caller already checked the Confirmation (it had a side effect of its own to make first) */
  confirmed?: ConfirmationKind;
  /** What the Preview says about rolling this back, when not the usual adsRollbackNote */
  rollback?: string;
};

export async function runAdsWrite(ctx: Ctx, w: AdsWrite): Promise<ToolResult> {
  const refused = assertWritable(ctx);
  if (refused) return text(refused);
  const customer = ctx.customer();
  const content = { ops: w.ops, summary: w.summary };
  if (!w.confirm && !w.confirmed) {
    try {
      await customer.mutateResources(w.ops as any, { validate_only: true });
    } catch (err) {
      return text(`PREVIEW FAILED (nothing changed)\n\n${w.summary}\n\n${formatError(err)}`);
    }
    const body = `PREVIEW (nothing changed). Google validated ${w.ops.length} operation(s).\n\n${w.summary}`;
    return ctx.gate.preview(ctx, w.tool, content, body, w.rollback ?? adsRollbackNote(w.ops));
  }
  let confirmation = w.confirmed;
  if (!confirmation) {
    const ok = await ctx.gate.confirm(ctx, w.tool, content, w.confirm!, w.summary);
    if ("refused" in ok) return text(ok.refused);
    confirmation = ok.kind;
  }
  // fail closed: without the prior state the change couldn't be reverted, so don't make it
  const before: Snapshot[] = [];
  let notSnapshotted: string[];
  try {
    notSnapshotted = unsnapshotted(w.ops);
    for (const q of snapshotQueries(w.ops)) before.push(readSnapshot((await customer.query(q.gaql))[0], q));
  } catch (err) {
    return text(`FAILED (nothing changed): couldn't capture prior state: ${formatError(err)}\n\n${w.summary}`);
  }
  let res;
  try {
    res = await customer.mutateResources(w.ops as any);
  } catch (err) {
    return text(`FAILED (nothing changed)\n\n${w.summary}\n\n${formatError(err)}`);
  }
  // from here the change is live: no path below may say "nothing changed"
  let resources = "";
  try {
    const names = (res.mutate_operation_responses ?? []).map(
      (r: any) => (Object.values(r).find((v: any) => v && typeof v === "object" && "resource_name" in v) as any)?.resource_name as string | undefined
    );
    resources = `Resources:\n${names.filter(Boolean).map((n) => `- ${n}`).join("\n")}\n\n`;
    // the status each created resource was given: a Rollback treats a different status later as Drift
    const created = w.ops.flatMap((op, i) =>
      op.operation === "create" && names[i] ? [{ entity: op.entity, resource_name: names[i]!, ...(op.resource?.status !== undefined ? { status: op.resource.status } : {}) }] : []
    );
    const entry = appendChange(ctx.alias, { ...w.extra, product: "ads", tool: w.tool, summary: w.summary, confirmation, ops: w.ops, before, created, notSnapshotted });
    return text(`APPLIED (changeId: ${entry.id}, ${confirmation})\n\n${w.summary}\n\n${resources}Roll back with rollback { changeId: "${entry.id}" }.`);
  } catch (err) {
    return text(`APPLIED but NOT LOGGED (${formatError(err)})\n\n${w.summary}\n\n${resources}This change can't be rolled back automatically.`);
  }
}
