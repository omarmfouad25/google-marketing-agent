// Google Tag Manager tools: read the container, edit the workspace, publish versions.
// Workspace edits are invisible to visitors until published; edits and publishes are
// still dry runs unless confirm=true, and applied ones go to the account's change log.

import { z } from "zod";
import { google } from "googleapis";
import { requireField, type Ctx } from "../core/context.js";
import { assertWritable } from "../core/runner.js";
import { appendChange } from "../core/changelog.js";
import { text, type Tool } from "../core/tool.js";
import { formatError } from "../core/errors.js";

const Entity = z.enum(["tags", "triggers", "variables"]);
type Entity = z.infer<typeof Entity>;

const Container = z.string().optional().describe("Container public ID (GTM-XXXXXXX). Defaults to the profile's gtmContainerId");
const Workspace = z
  .string()
  .optional()
  .describe("Workspace ID. Defaults to the first workspace (usually 'Default Workspace')");
const Confirm = z.boolean().optional().describe("false/omitted = preview only. true = apply");

// keyed by public ID: the same container ID resolves to the same path for every account
const containerPaths = new Map<string, string>();

const gtm = (ctx: Ctx) => google.tagmanager({ version: "v2", auth: ctx.trackingAuth() as any });
/** Log a change that is already live; if logging fails, say so instead of reporting an error. */
function logged(ctx: Ctx, entry: Parameters<typeof appendChange>[1], applied: unknown) {
  try {
    appendChange(ctx.alias, entry);
  } catch (err) {
    return text(`APPLIED but NOT LOGGED (${formatError(err)})\n\n${JSON.stringify(applied, null, 2)}\n\nThis change can't be rolled back from the change log.`);
  }
  return json(applied);
}
const json = (v: unknown) => text(typeof v === "string" ? v : JSON.stringify(v, null, 2));

async function containerPath(ctx: Ctx, publicId?: string): Promise<string> {
  const id = publicId ?? requireField(ctx, "gtmContainerId");
  const cached = containerPaths.get(id);
  if (cached) return cached;
  const { data } = await gtm(ctx).accounts.list();
  for (const account of data.account ?? []) {
    const res = await gtm(ctx).accounts.containers.list({ parent: account.path! });
    for (const c of res.data.container ?? []) containerPaths.set(c.publicId!, c.path!);
  }
  const path = containerPaths.get(id);
  if (!path) throw new Error(`Container ${id} not visible to this Google account`);
  return path;
}

async function workspacePath(ctx: Ctx, publicId?: string, workspaceId?: string): Promise<string> {
  const parent = await containerPath(ctx, publicId);
  if (workspaceId) return `${parent}/workspaces/${workspaceId}`;
  const { data } = await gtm(ctx).accounts.containers.workspaces.list({ parent });
  const ws = data.workspace?.[0];
  if (!ws) throw new Error("No workspace found");
  return ws.path!;
}

function entityApi(ctx: Ctx, entity: Entity) {
  const ws = gtm(ctx).accounts.containers.workspaces;
  return { tags: ws.tags, triggers: ws.triggers, variables: ws.variables }[entity];
}

const idField = { tags: "tagId", triggers: "triggerId", variables: "variableId" } as const;

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

/** Top-level keys whose values differ */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = { before: before[k], after: after[k] };
  }
  return out;
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
        c.versions.live({ parent }),
        c.workspaces.list({ parent }),
        workspacePath(ctx, container, workspaceId),
      ]);
      const status = await c.workspaces.getStatus({ path: ws });
      return json({
        live: {
          versionId: live.data.containerVersionId,
          name: live.data.name,
          tags: live.data.tag?.length ?? 0,
          triggers: live.data.trigger?.length ?? 0,
          variables: live.data.variable?.length ?? 0,
        },
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

  if (!writes) return;

  tool(
    "gtm_upsert",
    "Create (no id) or update (id) a tag, trigger, or variable in the workspace. For updates, `resource` is shallow-merged onto the current definition (pass full nested arrays like `parameter`). Not live until gtm_publish. Preview unless confirm=true",
    {
      entity: Entity,
      id: z.string().regex(/^\d+$/).optional(),
      resource: z.record(z.string(), z.unknown()).describe("GTM API resource fields (name, type, parameter, firingTriggerId, paused, ...)"),
      container: Container,
      workspaceId: Workspace,
      confirm: Confirm,
    },
    async ({ entity, id, resource, container, workspaceId, confirm }, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      const ws = await workspacePath(ctx, container, workspaceId);
      const apiFor = entityApi(ctx, entity) as any;
      if (!id) {
        if (!confirm) return json({ preview: "CREATE (nothing changed)", entity, workspace: ws, resource });
        const { data } = await apiFor.create({ parent: ws, requestBody: resource });
        return logged(ctx, { product: "gtm", tool: "gtm_upsert", summary: `create ${entity} "${data.name ?? resource.name ?? ""}"`, action: "create", entity, workspace: ws, result: data }, { applied: "CREATED in workspace (not live until gtm_publish)", resource: data });
      }
      const path = `${ws}/${entity}/${id}`;
      const { data: before } = await apiFor.get({ path });
      const after = { ...before, ...resource };
      const changes = diff(before, after);
      if (!Object.keys(changes).length) return json("No differences: nothing to update.");
      if (!confirm) return json({ preview: `UPDATE ${entity}/${id} "${before.name}" (nothing changed)`, changes });
      const { data } = await apiFor.update({ path, fingerprint: before.fingerprint, requestBody: after });
      return logged(ctx, { product: "gtm", tool: "gtm_upsert", summary: `update ${entity}/${id} "${before.name}"`, action: "update", entity, path, before, changes }, { applied: "UPDATED in workspace (not live until gtm_publish)", changes, fingerprint: data.fingerprint });
    }
  );

  tool(
    "gtm_publish",
    "Publish the workspace as a new live container version, or re-publish an existing versionId (rollback). Preview unless confirm=true",
    {
      name: z.string().optional().describe("Version name (required when publishing the workspace)"),
      notes: z.string().optional(),
      versionId: z.string().regex(/^\d+$/).optional().describe("Re-publish this existing version instead (rollback)"),
      container: Container,
      workspaceId: Workspace,
      confirm: Confirm,
    },
    async ({ name, notes, versionId, container, workspaceId, confirm }, ctx) => {
      const refused = assertWritable(ctx);
      if (refused) return text(refused);
      const parent = await containerPath(ctx, container);
      const c = gtm(ctx).accounts.containers;
      const live = (await c.versions.live({ parent })).data;

      if (versionId) {
        const path = `${parent}/versions/${versionId}`;
        if (!confirm) return json({ preview: `RE-PUBLISH version ${versionId} (live is ${live.containerVersionId})` });
        await c.versions.publish({ path });
        return logged(ctx, { product: "gtm", tool: "gtm_publish", summary: `republish version ${versionId}`, action: "republish", versionId, previousLive: live.containerVersionId }, { applied: `Version ${versionId} is now live`, previousLive: live.containerVersionId });
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
      if (!confirm) return json({ preview: `PUBLISH "${name}" (nothing changed)`, liveVersion: live.containerVersionId, changes });

      const created = (await c.workspaces.create_version({ path: ws, requestBody: { name, notes } })).data;
      if (created.compilerError || !created.containerVersion?.path) {
        return json({ failed: "Version did not compile; nothing published", created });
      }
      await c.versions.publish({ path: created.containerVersion.path });
      const newId = created.containerVersion.containerVersionId;
      return logged(ctx, { product: "gtm", tool: "gtm_publish", summary: `publish version ${newId} "${name}"`, action: "publish", name, newVersion: newId, previousLive: live.containerVersionId, changes }, {
        applied: `Version ${newId} "${name}" is live`,
        rollback: `gtm_publish versionId=${live.containerVersionId}`,
        changes,
      });
    }
  );
}
