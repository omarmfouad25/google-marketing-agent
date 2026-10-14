import { z } from "zod";
import { Tool, text } from "../../core/tool.js";
import { getChange, listChanges } from "../../core/changelog.js";
import { rollbackOps } from "../../core/snapshot.js";
import { runAdsWrite } from "../../core/runner.js";
import { Confirm } from "./shared.js";

export function registerRollback(tool: Tool) {
  tool(
    "ads_rollback",
    "Revert one applied Google Ads change from the change log (changes_list shows IDs): restores prior values and removes " +
      "what it created. It restores the values logged at the time of the change, overwriting any later edits to the same fields. Anything it can't revert is listed. Dry run unless confirm=true",
    { changeId: z.string().min(1), confirm: Confirm },
    async ({ changeId, confirm }, ctx) => {
      const entry = getChange(ctx.alias, changeId);
      if (!entry) return text(`No change "${changeId}" for account ${ctx.alias}. Use changes_list to see recent IDs.`);
      if (entry.rollbackOf) return text(`${entry.id} is itself a rollback; re-run the original change instead (nothing changed).`);
      const done = listChanges(ctx.alias, Number.MAX_SAFE_INTEGER).find((e) => e.rollbackOf === changeId);
      if (done) return text(`Already rolled back by ${done.id} — nothing changed`);
      let plan;
      try {
        plan = rollbackOps(entry);
      } catch (err) {
        return text(`REFUSED (nothing changed): ${err instanceof Error ? err.message : String(err)}`);
      }
      const { ops, skipped } = plan;
      const notReverted = skipped.length ? `\nNot reverted:\n- ${skipped.join("\n- ")}` : "";
      if (!ops.length) return text(`Nothing to revert for ${changeId}.${notReverted}`);
      return runAdsWrite(ctx, {
        tool: "ads_rollback",
        summary: `Rollback of ${changeId} (${entry.tool}: ${entry.summary}): ${ops.length} operation(s)${notReverted}`,
        ops,
        confirm,
        extra: { rollbackOf: changeId },
      });
    }
  );
}
