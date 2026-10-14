// The only path for Google Ads writes: guard → preview or (snapshot → apply → log).

import type { Ctx } from "./context.js";
import { appendChange, Op, Snapshot } from "./changelog.js";
import { readSnapshot, snapshotQueries, unsnapshotted } from "./snapshot.js";
import { formatError } from "./errors.js";
import { text, ToolResult } from "./tool.js";

export function assertWritable(ctx: Ctx): string | undefined {
  if (ctx.profile.writes === true) return undefined;
  return `REFUSED: profile "${ctx.alias}" is read-only. Set "writes": true for it in accounts.json to allow changes (see docs/safety.md).`;
}

export async function runAdsWrite(
  ctx: Ctx,
  w: { tool: string; summary: string; ops: Op[]; confirm?: boolean; extra?: Record<string, unknown> }
): Promise<ToolResult> {
  const refused = assertWritable(ctx);
  if (refused) return text(refused);
  const customer = ctx.customer();
  if (!w.confirm) {
    try {
      await customer.mutateResources(w.ops as any, { validate_only: true });
      return text(`DRY RUN OK (nothing changed)\n\n${w.summary}\n\nGoogle validated ${w.ops.length} operation(s). Call again with confirm: true to apply.`);
    } catch (err) {
      return text(`DRY RUN FAILED (nothing changed)\n\n${w.summary}\n\n${formatError(err)}`);
    }
  }
  // fail closed: without the prior state the change couldn't be reverted, so don't make it
  const before: Snapshot[] = [];
  let notSnapshotted: string[];
  try {
    notSnapshotted = unsnapshotted(w.ops);
    for (const q of snapshotQueries(w.ops)) before.push(readSnapshot((await customer.query(q.gaql))[0], q));
  } catch (err) {
    return text(`FAILED (nothing changed) — couldn't capture prior state: ${formatError(err)}\n\n${w.summary}`);
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
    const created = w.ops.flatMap((op, i) => (op.operation === "create" && names[i] ? [{ entity: op.entity, resource_name: names[i]! }] : []));
    const entry = appendChange(ctx.alias, { ...w.extra, product: "ads", tool: w.tool, summary: w.summary, ops: w.ops, before, created, notSnapshotted });
    return text(`APPLIED (changeId: ${entry.id})\n\n${w.summary}\n\n${resources}Revert with ads_rollback { changeId: "${entry.id}" }.`);
  } catch (err) {
    return text(`APPLIED but NOT LOGGED (${formatError(err)})\n\n${w.summary}\n\n${resources}This change can't be rolled back automatically.`);
  }
}
