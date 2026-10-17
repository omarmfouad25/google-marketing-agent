// Shared GTM helpers: container/workspace path resolution, entity API lookup, change logging, diffing.

import { z } from "zod";
import { google } from "googleapis";
import { requireField, type Ctx } from "../core/context.js";
import type { Profile } from "../core/config.js";
import { appendChange } from "../core/changelog.js";
import { text } from "../core/tool.js";
import { formatError } from "../core/errors.js";

export const Entity = z.enum(["tags", "triggers", "variables"]);
export type Entity = z.infer<typeof Entity>;

export const Container = z.string().optional().describe("Container public ID (GTM-XXXXXXX). Defaults to the profile's gtmContainerId. Writes only reach containers in the profile");
export const Workspace = z
  .string()
  .optional()
  .describe("Workspace ID. Defaults to the first workspace (usually 'Default Workspace')");
export { Confirm } from "../core/confirm.js";

// keyed by public ID: the same container ID resolves to the same path for every account
export const containerPaths = new Map<string, string>();

export const gtm = (ctx: Ctx) => google.tagmanager({ version: "v2", auth: ctx.trackingAuth() as any });
/** Log a change that is already live; if logging fails, say so instead of reporting an error. */
export function logged(ctx: Ctx, entry: Parameters<typeof appendChange>[1], applied: unknown) {
  try {
    appendChange(ctx.alias, entry);
  } catch (err) {
    return text(`APPLIED but NOT LOGGED (${formatError(err)})\n\n${JSON.stringify(applied, null, 2)}\n\nThis change can't be rolled back from the change log.`);
  }
  return json(applied);
}
export const json = (v: unknown) => text(typeof v === "string" ? v : JSON.stringify(v, null, 2));

/** GTM containers in the Profile scope; the first is the default */
export const scopeContainers = (p: Profile) => [...new Set([p.gtmContainerId, ...(p.gtmContainerIds ?? [])].filter((c): c is string => Boolean(c)))];

/** Writes stay inside the Profile scope (docs/adr/0002): the refusal to return, or undefined */
export function outOfScope(ctx: Ctx, publicId?: string): string | undefined {
  const allowed = scopeContainers(ctx.profile);
  const target = publicId ?? allowed[0];
  if (target && allowed.includes(target)) return undefined;
  if (!target) return `REFUSED (nothing changed): profile "${ctx.alias}" has no GTM container. Add gtmContainerId to it in accounts.json (see docs/profiles.md).`;
  return `REFUSED (nothing changed): GTM container ${target} is outside profile "${ctx.alias}" (${allowed.join(", ") || "no containers"}). Add it to the profile's gtmContainerIds in accounts.json, or use the profile that lists it.`;
}

export const WORKSPACE_ROLLBACK =
  "not through rollback, because workspace edits are invisible until published. Before publishing, revert it in Tag Manager → Workspace Changes; after publishing, roll back the publish.";

export async function containerPath(ctx: Ctx, publicId?: string): Promise<string> {
  const id = publicId ?? scopeContainers(ctx.profile)[0] ?? requireField(ctx, "gtmContainerId");
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

/** The live version, or undefined when the container was never published (the API answers 404) */
export async function liveVersion(ctx: Ctx, parent: string) {
  try {
    return (await gtm(ctx).accounts.containers.versions.live({ parent })).data;
  } catch (e: any) {
    if ([e?.code, e?.status, e?.response?.status].some((v) => Number(v) === 404)) return undefined;
    throw e;
  }
}
export const NO_LIVE = "none (first published version)";

export async function workspacePath(ctx: Ctx, publicId?: string, workspaceId?: string): Promise<string> {
  const parent = await containerPath(ctx, publicId);
  if (workspaceId) return `${parent}/workspaces/${workspaceId}`;
  const { data } = await gtm(ctx).accounts.containers.workspaces.list({ parent });
  const ws = data.workspace?.[0];
  if (!ws) throw new Error("No workspace found");
  return ws.path!;
}

export function entityApi(ctx: Ctx, entity: Entity) {
  const ws = gtm(ctx).accounts.containers.workspaces;
  return { tags: ws.tags, triggers: ws.triggers, variables: ws.variables }[entity];
}

export const idField = { tags: "tagId", triggers: "triggerId", variables: "variableId" } as const;

/** Top-level keys whose values differ */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = { before: before[k], after: after[k] };
  }
  return out;
}


/** Built-in triggers (All Pages, Initialization, Consent Initialization…) use reserved IDs from 2147479000 up */
export const isBuiltInTrigger = (id: string) => Number(id) >= 2147479000;

/** Everything in a workspace that references can point at */
export async function listAll(ctx: Ctx, ws: string) {
  const w = gtm(ctx).accounts.containers.workspaces;
  const [tags, triggers, variables, builtIns] = await Promise.all([
    w.tags.list({ parent: ws }),
    w.triggers.list({ parent: ws }),
    w.variables.list({ parent: ws }),
    w.built_in_variables.list({ parent: ws }),
  ]);
  return {
    tags: (tags.data.tag ?? []) as any[],
    triggers: (triggers.data.trigger ?? []) as any[],
    variables: (variables.data.variable ?? []) as any[],
    builtIns: (builtIns.data.builtInVariable ?? []).map((b) => ({ name: b.name!, type: b.type! })),
  };
}
