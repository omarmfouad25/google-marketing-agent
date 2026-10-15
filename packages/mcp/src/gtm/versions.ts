// GTM versions (list + diff) and a check of what the live gtm.js actually serves to visitors.

import { z } from "zod";
import type { Ctx } from "../core/context.js";
import { requireField } from "../core/context.js";
import { text, type Tool } from "../core/tool.js";
import { Container, Workspace, containerPath, diff, gtm, json, listAll, liveVersion, workspacePath } from "./shared.js";

type Snapshot = { tag?: any[]; trigger?: any[]; variable?: any[] };
const VOLATILE = new Set(["fingerprint", "path", "accountId", "containerId", "workspaceId", "containerVersionId", "tagManagerUrl", "tagId", "triggerId", "variableId", "parentFolderId"]);
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !VOLATILE.has(k)));

export function compareEntities(older: Snapshot, newer: Snapshot) {
  const out: Record<"tags" | "triggers" | "variables", { added: string[]; removed: string[]; changed: { name: string; changes: Record<string, { before: unknown; after: unknown }> }[] }> = {} as any;
  for (const [key, plural] of [["tag", "tags"], ["trigger", "triggers"], ["variable", "variables"]] as const) {
    const a = new Map((older[key] ?? []).map((x) => [x.name as string, x]));
    const b = new Map((newer[key] ?? []).map((x) => [x.name as string, x]));
    out[plural] = {
      added: [...b.keys()].filter((n) => !a.has(n)),
      removed: [...a.keys()].filter((n) => !b.has(n)),
      changed: [...b.keys()].filter((n) => a.has(n)).flatMap((name) => {
        const changes = diff(clean(a.get(name)), clean(b.get(name)));
        return Object.keys(changes).length ? [{ name, changes }] : [];
      }),
    };
  }
  return out;
}

const param = (t: any, key: string) => t.parameter?.find((p: any) => p.key === key)?.value as string | undefined;

/** Strings a working live container must serve: conversion labels, GA4 event names and measurement IDs of active tags */
export function expectedStrings(live: Snapshot): string[] {
  const out = new Set<string>();
  for (const t of live.tag ?? []) {
    if (t.paused) continue;
    for (const key of ["conversionLabel", "eventName", "measurementIdOverride", "tagId"]) {
      const v = param(t, key);
      if (v && !v.includes("{{")) out.add(v);
    }
  }
  return [...out].sort();
}

async function snapshot(ctx: Ctx, parent: string, id: string, container?: string, workspaceId?: string): Promise<Snapshot> {
  if (id === "workspace") {
    const all = await listAll(ctx, await workspacePath(ctx, container, workspaceId));
    return { tag: all.tags, trigger: all.triggers, variable: all.variables };
  }
  return ((await gtm(ctx).accounts.containers.versions.get({ path: `${parent}/versions/${id}` })).data ?? {}) as Snapshot;
}

export function registerGtmVersions(tool: Tool) {
  tool(
    "gtm_versions",
    'List container versions (no versionId), or diff a version against another: added / removed / changed tags, triggers and variables by name. versionId "workspace" diffs unpublished workspace changes against the live version',
    {
      versionId: z.string().regex(/^(\d+|workspace)$/).optional(),
      compareTo: z.string().regex(/^\d+$/).optional().describe("Older version to compare against. Default: the previous version (live, for workspace)"),
      container: Container,
      workspaceId: Workspace,
    },
    async ({ versionId, compareTo, container, workspaceId }, ctx) => {
      const parent = await containerPath(ctx, container);
      const c = gtm(ctx).accounts.containers;
      const liveId = (await liveVersion(ctx, parent))?.containerVersionId ?? undefined;
      if (!versionId) {
        const headers = (await c.version_headers.list({ parent })).data.containerVersionHeader ?? [];
        return json(
          headers
            .filter((h) => !h.deleted)
            .sort((a, b) => Number(b.containerVersionId) - Number(a.containerVersionId))
            .map((h) => ({ versionId: h.containerVersionId, name: h.name, tags: h.numTags, triggers: h.numTriggers, variables: h.numVariables, live: h.containerVersionId === liveId }))
        );
      }
      let from = compareTo;
      if (!from && versionId === "workspace") {
        if (!liveId) return json({ from: "none (never published)", to: versionId, ...compareEntities({}, await snapshot(ctx, parent, versionId, container, workspaceId)) });
        from = liveId;
      }
      if (!from) {
        const ids = ((await c.version_headers.list({ parent })).data.containerVersionHeader ?? []).filter((h) => !h.deleted).map((h) => Number(h.containerVersionId)).filter((n) => n < Number(versionId));
        if (!ids.length) return text(`Version ${versionId} has no earlier version to compare with.`);
        from = String(Math.max(...ids));
      }
      const [older, newer] = await Promise.all([snapshot(ctx, parent, from), snapshot(ctx, parent, versionId, container, workspaceId)]);
      const label = from === liveId ? `${from} (live)` : from;
      return json({ from: label, to: versionId, ...compareEntities(older, newer) });
    }
  );

  tool(
    "gtm_live_check",
    "Fetch the live gtm.js that visitors receive and check it contains the expected strings. Default: every conversion label, GA4 event name and measurement ID of the live version's active tags. Run right after gtm_publish",
    { expect: z.array(z.string().min(1)).optional().describe("Strings to look for instead of the default"), container: Container },
    async ({ expect, container }, ctx) => {
      const publicId = container ?? requireField(ctx, "gtmContainerId");
      const parent = await containerPath(ctx, publicId);
      const live = (await liveVersion(ctx, parent)) as (Snapshot & { containerVersionId?: string }) | undefined;
      if (!live) return text(`Container ${publicId} has no published version yet: publish one with gtm_publish first.`);
      const wanted = expect ?? expectedStrings(live);
      const url = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(publicId)}`;
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      } catch (e) {
        return text(`Could not reach googletagmanager.com for ${publicId}: ${(e as Error).message}. Check the network and try again.`);
      }
      if (!res.ok) return text(`gtm.js returned ${res.status} for ${publicId}: the container is not published or the ID is wrong.`);
      const body = await res.text();
      return json({
        container: publicId,
        liveVersion: live.containerVersionId,
        bytes: body.length,
        found: wanted.filter((s) => body.includes(s)),
        missing: wanted.filter((s) => !body.includes(s)),
        note: "Google's CDN can take a few minutes to serve a new version; re-run if something just published is missing.",
      });
    }
  );
}
