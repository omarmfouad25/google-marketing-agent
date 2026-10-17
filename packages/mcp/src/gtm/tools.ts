// Google Tag Manager tools: read the container, edit the workspace, publish versions.
// Workspace edits are invisible to visitors until published; edits and publishes are
// still Previews until confirmed with a Preview ID, and applied ones go to the profile's Change log.

import { z } from "zod";
import { assertWritable } from "../core/runner.js";
import { gated } from "../core/confirm.js";
import { text, type Tool } from "../core/tool.js";
import { Confirm, Container, Entity, NO_LIVE, Workspace, containerPath, diff, entityApi, gtm, idField, json, liveVersion, logged, outOfScope, WORKSPACE_ROLLBACK, workspacePath } from "./shared.js";
import { registerGtmBuild } from "./build.js";
import { registerGtmBuiltins, registerGtmDelete } from "./manage.js";
import { registerGtmVersions } from "./versions.js";

function summarize(entity: Entity, items: Record<string, any>[]) {
  return items.map((i) => ({
    id: i[idField[entity]],
    name: i.name,
    type: i.type,
    ...(entity === "tags"
      ? { firingTriggerId: i.firingTriggerId, blockingTriggerId: i.blockingTriggerId, paused: i.paused ?? false }
      : {}),
  }));
}

export function registerGtmTools(tool: Tool, { writes }: { writes: boolean }) {
  tool("gtm_list_containers", "List GTM accounts and containers visible to this Google account", {}, async (_p, ctx) => {
    const { data } = await gtm(ctx).accounts.list();
    const out = [];
    for (const a of data.account ?? []) {
      const res = await gtm(ctx).accounts.containers.list({ parent: a.path! });
      for (const c of res.data.container ?? []) {
        out.push({ account: a.name, publicId: c.publicId, name: c.name, path: c.path });
      }
    }
    return json(out);
  });

  tool(
    "gtm_overview",
    "Live (published) version, workspaces, and pending unpublished changes for a container",
    { container: Container, workspaceId: Workspace },
    async ({ container, workspaceId }, ctx) => {
      const parent = await containerPath(ctx, container);
      const c = gtm(ctx).accounts.containers;
      const [live, workspaces, ws] = await Promise.all([
        liveVersion(ctx, parent),
        c.workspaces.list({ parent }),
        workspacePath(ctx, container, workspaceId),
      ]);
      const status = await c.workspaces.getStatus({ path: ws });
      return json({
        live: live
          ? { versionId: live.containerVersionId, name: live.name, tags: live.tag?.length ?? 0, triggers: live.trigger?.length ?? 0, variables: live.variable?.length ?? 0 }
          : null,
        workspaces: workspaces.data.workspace?.map((w) => ({ id: w.workspaceId, name: w.name })),
        pendingChanges: status.data.workspaceChange?.map((ch) => ({
          change: ch.changeStatus,
          tag: ch.tag?.name,
          trigger: ch.trigger?.name,
          variable: ch.variable?.name,
        })),
        mergeConflicts: status.data.mergeConflict?.length ?? 0,
      });
    }
  );

  tool(
    "gtm_list",
    "List tags, triggers, or variables in a workspace (compact: id, name, type, triggers, paused)",
    { entity: Entity, container: Container, workspaceId: Workspace },
    async ({ entity, container, workspaceId }, ctx) => {
      const parent = await workspacePath(ctx, container, workspaceId);
      const { data } = await entityApi(ctx, entity).list({ parent });
      const items = (data as Record<string, any>)[entity.slice(0, -1)] ?? [];
      return json(summarize(entity, items));
    }
  );

  tool(
    "gtm_get",
    "Get the full JSON definition of one tag, trigger, or variable",
    { entity: Entity, id: z.string().regex(/^\d+$/), container: Container, workspaceId: Workspace },
    async ({ entity, id, container, workspaceId }, ctx) => {
      const path = `${await workspacePath(ctx, container, workspaceId)}/${entity}/${id}`;
      const { data } = await entityApi(ctx, entity).get({ path });
      return json(data);
    }
  );

  registerGtmVersions(tool);
  registerGtmBuiltins(tool);

  if (!writes) return;
  registerGtmBuild(tool);
  registerGtmDelete(tool);

  tool(
    "gtm_upsert",
    "Create (no id) or update (id) a tag, trigger, or variable in the workspace. For updates, `resource` is shallow-merged onto the current definition (pass full nested arrays like `parameter`). Not live until gtm_publish. Preview first; apply with confirm set to its Preview ID",
    {
      entity: Entity,
      id: z.string().regex(/^\d+$/).optional(),
      resource: z.record(z.string(), z.unknown()).describe("GTM API resource fields (name, type, parameter, firingTriggerId, paused, ...)"),
      container: Container,
      workspaceId: Workspace,
      confirm: Confirm,
    },
    async ({ entity, id, resource, container, workspaceId, confirm }, ctx) => {
      const refused = assertWritable(ctx) ?? outOfScope(ctx, container);
      if (refused) return text(refused);
      const ws = await workspacePath(ctx, container, workspaceId);
      const apiFor = entityApi(ctx, entity) as any;
      if (!id) {
        const g = await gated(ctx, { tool: "gtm_upsert", confirm, headline: `PREVIEW: CREATE ${entity} (nothing changed)`, detail: { workspace: ws, resource }, rollback: WORKSPACE_ROLLBACK });
        if (typeof g !== "string") return g;
        const { data } = await apiFor.create({ parent: ws, requestBody: resource });
        return logged(ctx, { product: "gtm", tool: "gtm_upsert", summary: `create ${entity} "${data.name ?? resource.name ?? ""}"`, confirmation: g, action: "create", entity, workspace: ws, result: data }, { applied: "CREATED in workspace (not live until gtm_publish)", resource: data });
      }
      const path = `${ws}/${entity}/${id}`;
      const { data: before } = await apiFor.get({ path });
      const after = { ...before, ...resource };
      const changes = diff(before, after);
      if (!Object.keys(changes).length) return json("No differences: nothing to update.");
      const g = await gated(ctx, { tool: "gtm_upsert", confirm, headline: `PREVIEW: UPDATE ${entity}/${id} "${before.name}" (nothing changed)`, detail: { changes }, state: before.fingerprint, rollback: WORKSPACE_ROLLBACK });
      if (typeof g !== "string") return g;
      const { data } = await apiFor.update({ path, fingerprint: before.fingerprint, requestBody: after });
      return logged(ctx, { product: "gtm", tool: "gtm_upsert", summary: `update ${entity}/${id} "${before.name}"`, confirmation: g, action: "update", entity, path, before, changes }, { applied: "UPDATED in workspace (not live until gtm_publish)", changes, fingerprint: data.fingerprint });
    }
  );

  tool(
    "gtm_publish",
    "Publish the workspace as a new live container version, or re-publish an existing versionId. To undo a publish, use rollback with its changeId. Preview first; apply with confirm set to its Preview ID",
    {
      name: z.string().optional().describe("Version name (required when publishing the workspace)"),
      notes: z.string().optional(),
      versionId: z.string().regex(/^\d+$/).optional().describe("Re-publish this existing version instead"),
      container: Container,
      workspaceId: Workspace,
      confirm: Confirm,
    },
    async ({ name, notes, versionId, container, workspaceId, confirm }, ctx) => {
      const refused = assertWritable(ctx) ?? outOfScope(ctx, container);
      if (refused) return text(refused);
      const parent = await containerPath(ctx, container);
      const c = gtm(ctx).accounts.containers;
      const liveId = (await liveVersion(ctx, parent))?.containerVersionId ?? undefined;
      const liveLabel = liveId ?? NO_LIVE;
      const rollback = liveId ? `possible with rollback (re-publishes version ${liveId}, live now).` : "not possible: this is the container's first published version, so there is nothing to go back to.";

      if (versionId) {
        if (versionId === liveId) return json(`Version ${versionId} is already live: nothing to publish.`);
        const g = await gated(ctx, { tool: "gtm_publish", confirm, headline: `PREVIEW: RE-PUBLISH version ${versionId} (live is ${liveLabel}, nothing changed)`, state: { parent }, rollback });
        if (typeof g !== "string") return g;
        await c.versions.publish({ path: `${parent}/versions/${versionId}` });
        return logged(ctx, { product: "gtm", tool: "gtm_publish", summary: `republish version ${versionId}`, confirmation: g, action: "republish", container: parent, versionId, previousLive: liveId }, { applied: `Version ${versionId} is now live`, previousLive: liveLabel });
      }

      const ws = await workspacePath(ctx, container, workspaceId);
      const status = (await c.workspaces.getStatus({ path: ws })).data;
      const changes = status.workspaceChange?.map((ch) => ({
        change: ch.changeStatus,
        name: ch.tag?.name ?? ch.trigger?.name ?? ch.variable?.name,
        kind: ch.tag ? "tag" : ch.trigger ? "trigger" : "variable",
      }));
      if (!changes?.length) return json("Workspace has no pending changes: nothing to publish.");
      if (status.mergeConflict?.length) return json("BLOCKED: workspace has merge conflicts. Resolve in the GTM UI.");
      if (!name) return json("Provide a version name.");
      const g = await gated(ctx, { tool: "gtm_publish", confirm, headline: `PREVIEW: PUBLISH "${name}" (nothing changed)`, detail: { liveVersion: liveLabel, changes, notes }, state: { ws }, rollback });
      if (typeof g !== "string") return g;

      const created = (await c.workspaces.create_version({ path: ws, requestBody: { name, notes } })).data;
      if (created.compilerError || !created.containerVersion?.path) {
        return json({ failed: "Version did not compile; nothing published", created });
      }
      await c.versions.publish({ path: created.containerVersion.path });
      const newId = created.containerVersion.containerVersionId;
      return logged(ctx, { product: "gtm", tool: "gtm_publish", summary: `publish version ${newId} "${name}"`, confirmation: g, action: "publish", container: parent, name, newVersion: newId, previousLive: liveId, changes }, {
        applied: `Version ${newId} "${name}" is live`,
        rollback: liveId ? "rollback with the changeId from changes_list re-publishes the previous version" : NO_LIVE,
        changes,
      });
    }
  );
}
