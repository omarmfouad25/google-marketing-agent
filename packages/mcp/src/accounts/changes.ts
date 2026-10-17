import { z } from "zod";
import { Tool, text } from "../core/tool.js";
import { listChanges } from "../core/changelog.js";

export function registerChangesList(tool: Tool) {
  tool(
    "changes_list",
    "Recent applied changes for a profile (newest first), with the IDs rollback takes and how each was confirmed",
    { limit: z.number().int().positive().max(200).optional().describe("Defaults to 20") },
    async ({ limit }, ctx) => {
      const rows = listChanges(ctx.alias, limit ?? 20);
      if (!rows.length) return text(`No changes logged for ${ctx.alias}.`);
      return text(rows.map((e) => `- ${e.id} · ${e.at} · ${e.product} · ${e.tool} · ${e.confirmation ?? "confirmed before 0.4"} · ${e.summary.replace(/\s*\n+\s*/g, " · ")}`).join("\n"));
    }
  );
}
