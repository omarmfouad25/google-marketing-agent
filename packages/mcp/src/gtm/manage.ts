// Built-in variables (list / enable / disable) and deleting workspace entities. Writes are Previews until
// confirmed with a Preview ID, refused on read-only profiles and outside the Profile scope, and logged with the prior state.

import { z } from "zod";
import { assertWritable } from "../core/runner.js";
import { gated } from "../core/confirm.js";
import { text, type Tool } from "../core/tool.js";
import { BUILTIN_TYPES } from "./recipes.js";
import { Confirm, Container, Entity, WORKSPACE_ROLLBACK, Workspace, entityApi, gtm, idField, json, listAll, logged, outOfScope, workspacePath } from "./shared.js";

type All = Awaited<ReturnType<typeof listAll>>;

/** What in the workspace points at `target`: tags firing/blocking on a trigger, or anything using {{variable}} */
export function referencesTo(all: All, entity: Entity, target: any): string[] {
  if (entity === "tags") return [];
  if (entity === "triggers") {
    const id = target.triggerId;
    return all.tags.filter((t) => [...(t.firingTriggerId ?? []), ...(t.blockingTriggerId ?? [])].includes(id)).map((t) => `tag "${t.name}"`);
  }
  const needle = `{{${target.name}}}`;
  const uses = (x: unknown) => JSON.stringify(x).includes(needle);
  return [
    ...all.tags.filter(uses).map((t) => `tag "${t.name}"`),
    ...all.triggers.filter(uses).map((t) => `trigger "${t.name}"`),
    ...all.variables.filter((v) => v.name !== target.name && uses(v)).map((v) => `variable "${v.name}"`),
  ];
}

export function registerGtmBuiltins(tool: Tool) {
  tool(
    "gtm_builtin_variables",
    'List enabled built-in variables (Page Path, Click URL…) with the display name ↔ type map, or enable/disable some by type. Recipes need the built-ins they reference enabled. enable/disable: preview first, apply with confirm set to its Preview ID',
    {
      action: z.enum(["list", "enable", "disable"]),
      types: z.array(z.string().regex(/^[a-zA-Z]+$/)).optional().describe('Built-in types, e.g. ["pagePath", "clickUrl"]'),
      container: Container,
      workspaceId: Workspace,
      confirm: Confirm,
    },
    async ({ action, types, container, workspaceId, confirm }, ctx) => {
      // enable/disable are writes: refuse before any GTM call
      const refused = action === "list" ? undefined : assertWritable(ctx) ?? outOfScope(ctx, container);
      if (refused) return text(refused);
      const ws = await workspacePath(ctx, container, workspaceId);
      const api = gtm(ctx).accounts.containers.workspaces.built_in_variables;
      const enabled = ((await api.list({ parent: ws })).data.builtInVariable ?? []).map((b) => ({ name: b.name!, type: b.type! }));
      if (action === "list") return json({ enabled, available: BUILTIN_TYPES });
      if (!types?.length) return text(`Pass types for ${action}, e.g. ["pagePath", "clickUrl"].`);
      const on = new Set(enabled.map((b) => b.type));
      const todo = types.filter((t) => (action === "enable" ? !on.has(t) : on.has(t)));
      if (!todo.length) return text(`Nothing to do: ${types.join(", ")} already ${action === "enable" ? "enabled" : "disabled"}.`);
      const g = await gated(ctx, { tool: "gtm_builtin_variables", confirm, headline: `PREVIEW: ${action.toUpperCase()} built-in variables: ${todo.join(", ")} (nothing changed)`, detail: { workspace: ws, types: todo }, rollback: WORKSPACE_ROLLBACK });
      if (typeof g !== "string") return g;
      if (action === "enable") await api.create({ parent: ws, type: todo });
      else await api.delete({ path: `${ws}/built_in_variables`, type: todo });
      return logged(ctx, { product: "gtm", tool: "gtm_builtin_variables", summary: `${action} built-ins ${todo.join(", ")}`, confirmation: g, action, workspace: ws, types: todo }, { applied: `${action === "enable" ? "ENABLED" : "DISABLED"} in workspace (not live until gtm_publish)`, types: todo });
    }
  );
}

export function registerGtmDelete(tool: Tool) {
  tool(
    "gtm_delete",
    "Delete one tag, trigger or variable from the workspace. Refused while anything references it. Prefer pausing a tag (gtm_upsert with resource: { paused: true }) when you may want it back. Not live until gtm_publish. Preview first; apply with confirm set to its Preview ID",
    { entity: Entity, id: z.string().regex(/^\d+$/), container: Container, workspaceId: Workspace, confirm: Confirm },
    async ({ entity, id, container, workspaceId, confirm }, ctx) => {
      const refused = assertWritable(ctx) ?? outOfScope(ctx, container);
      if (refused) return text(refused);
      const ws = await workspacePath(ctx, container, workspaceId);
      const path = `${ws}/${entity}/${id}`;
      const api = entityApi(ctx, entity) as any;
      const before = (await api.get({ path })).data;
      const refs = referencesTo(await listAll(ctx, ws), entity, before);
      if (refs.length) return text(`REFUSED (nothing changed): ${entity}/${id} "${before.name}" is used by ${refs.join(", ")}. Change those first.`);
      const g = await gated(ctx, {
        tool: "gtm_delete",
        confirm,
        headline: `PREVIEW: DELETE ${entity}/${id} "${before.name}" (nothing changed)`,
        detail: { note: entity === "tags" ? "Consider pausing instead (gtm_upsert with resource: { paused: true }): it keeps the tag for later." : undefined, resource: before },
        state: before.fingerprint,
        rollback: `${WORKSPACE_ROLLBACK} It can also be re-created with gtm_upsert from the logged resource.`,
      });
      if (typeof g !== "string") return g;
      await api.delete({ path });
      return logged(ctx, { product: "gtm", tool: "gtm_delete", summary: `delete ${entity}/${id} "${before.name}"`, confirmation: g, action: "delete", entity, path, before }, {
        applied: "DELETED from workspace (not live until gtm_publish)",
        undo: "Before publishing: Tag Manager → Workspace Changes → Revert. After publishing: rollback the publish, or re-create it with gtm_upsert from the logged resource.",
        [idField[entity]]: id,
      });
    }
  );
}
