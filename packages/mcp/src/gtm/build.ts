// gtm_build: create or update a tag, trigger or variable from a typed recipe (see recipes.ts).
// Pre-flight catches what Google would only reject at create time: duplicate names, missing variables/triggers.

import { z } from "zod";
import type { Ctx } from "../core/context.js";
import { assertWritable } from "../core/runner.js";
import { text, type Tool } from "../core/tool.js";
import { BUILTIN_TYPES, Recipe, compile, referencedVariables, type Compiled } from "./recipes.js";
import { Confirm, Container, Workspace, diff, entityApi, idField, isBuiltInTrigger, json, listAll, logged, preview, workspacePath } from "./shared.js";

async function preflight(ctx: Ctx, ws: string, c: Compiled, id?: string): Promise<string[]> {
  const all = await listAll(ctx, ws);
  const problems: string[] = [];
  const same = all[c.entity].find((x) => x.name === c.resource.name && x[idField[c.entity]] !== id);
  if (same) problems.push(`${c.entity} named "${c.resource.name}" already exists (id ${same[idField[c.entity]]})`);
  const known = new Set([...all.variables.map((v) => v.name), ...all.builtIns.map((b) => b.name)]);
  for (const name of referencedVariables(c.resource)) {
    if (known.has(name)) continue;
    const type = BUILTIN_TYPES[name];
    problems.push(type
      ? `{{${name}}} is a built-in variable that is not enabled: gtm_builtin_variables { action: "enable", types: ["${type}"] }`
      : `{{${name}}} does not exist: create it with gtm_build kind datalayer_variable (or gtm_upsert for other variable types)`);
  }
  const triggerIds = new Set(all.triggers.map((t) => t.triggerId));
  for (const t of (c.resource.firingTriggerId as string[] | undefined) ?? []) {
    if (!isBuiltInTrigger(t) && !triggerIds.has(t)) problems.push(`trigger ${t} does not exist (gtm_list entity triggers)`);
  }
  return problems;
}

export function registerGtmBuild(tool: Tool) {
  tool(
    "gtm_build",
    "Create (no id) or update (id) a GTM tag, trigger or variable from a typed recipe: datalayer_variable, custom_event_trigger, " +
      "link_click_trigger, ga4_event_tag, ads_conversion_tag (conditions, negation and consent included). Checks names, variables and " +
      "triggers first. Not live until gtm_publish. Preview unless confirm=true. For anything else use gtm_upsert",
    { recipe: Recipe, id: z.string().regex(/^\d+$/).optional().describe("Update this existing entity instead of creating"), container: Container, workspaceId: Workspace, confirm: Confirm },
    async ({ recipe, id, container, workspaceId, confirm }, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      const c = compile(recipe);
      const ws = await workspacePath(ctx, container, workspaceId);
      const api = entityApi(ctx, c.entity) as any;
      let before: Record<string, any> | undefined;
      if (id) {
        before = (await api.get({ path: `${ws}/${c.entity}/${id}` })).data;
        if (before!.type !== c.resource.type) return text(`NOT BUILT (nothing changed)\n\n- ${c.entity}/${id} is type ${before!.type}, this recipe builds ${c.resource.type}`);
      }
      const problems = await preflight(ctx, ws, c, id);
      if (problems.length) return text(`NOT BUILT (nothing changed)\n\n- ${problems.join("\n- ")}`);

      if (!before) {
        if (!confirm) return preview(`CREATE ${c.entity} "${c.resource.name}" (nothing changed)`, { workspace: ws, resource: c.resource });
        const { data } = await api.create({ parent: ws, requestBody: c.resource });
        return logged(ctx, { product: "gtm", tool: "gtm_build", summary: `create ${c.entity} "${data.name}" (${recipe.kind})`, action: "create", entity: c.entity, workspace: ws, result: data }, { applied: "CREATED in workspace (not live until gtm_publish)", id: data[idField[c.entity]], resource: data });
      }
      const after = { ...before, ...c.resource };
      const changes = diff(before, after);
      if (!Object.keys(changes).length) return json("No differences: nothing to update.");
      if (!confirm) return preview(`UPDATE ${c.entity}/${id} "${before.name}" (nothing changed)`, { changes });
      const path = `${ws}/${c.entity}/${id}`;
      const { data } = await api.update({ path, fingerprint: before.fingerprint, requestBody: after });
      return logged(ctx, { product: "gtm", tool: "gtm_build", summary: `update ${c.entity}/${id} "${before.name}" (${recipe.kind})`, action: "update", entity: c.entity, path, before, changes }, { applied: "UPDATED in workspace (not live until gtm_publish)", changes, fingerprint: data.fingerprint });
    }
  );
}
