// Setup checks with the exact fix for each failure. Probes are injected so tests never call Google.

import { statSync } from "node:fs";
import { google } from "googleapis";
import { Config, Credentials, Profile, configPaths } from "./config.js";
import { AccountStore } from "./context.js";
import { liveDiscoverDeps } from "./discover.js";
import { formatError } from "./errors.js";

export type Line = { ok: boolean; label: string; fix?: string };
export type Probes = {
  credentials(): Credentials | undefined;
  config(): Config;
  listAccessible(): Promise<string[]>;
  adsRead(p: Profile, alias: string): Promise<void>;
  keywordPlanner(p: Profile, alias: string): Promise<void>;
  ga4(p: Profile, alias: string): Promise<void>;
  ga4Admin(p: Profile, alias: string): Promise<void>;
  gsc(p: Profile, alias: string): Promise<void>;
  gtm(p: Profile, alias: string): Promise<void>;
  /** true when credentials.json is readable by group/others */
  credentialsTooOpen?(): boolean;
  /** messages (file path + reason) for config files that failed to load */
  problems?(): string[];
};

const API_LIBRARY = {
  ads: "googleads.googleapis.com",
  ga4: "analyticsdata.googleapis.com",
  ga4admin: "analyticsadmin.googleapis.com",
  gsc: "searchconsole.googleapis.com",
  gtm: "tagmanager.googleapis.com",
};
type Product = keyof typeof API_LIBRARY;

const PLANNER_DENIED = /DEVELOPER_TOKEN|only approved for use with test accounts|PERMISSION_DENIED|not approved/i;

function fixFor(product: Product, msg: string, prof?: Profile): string {
  if (/invalid_grant/i.test(msg))
    return "Token expired or revoked. If your OAuth app is External in Testing status, tokens expire after 7 days (docs/setup.md §3). Run: npx google-marketing-agent init";
  if (/has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(msg))
    return `Enable the API: https://console.cloud.google.com/apis/library/${API_LIBRARY[product]}`;
  if (product === "ads" && /only approved for use with test accounts|DEVELOPER_TOKEN_NOT_APPROVED/i.test(msg))
    return "Your Cloud project is at Test level. Cloud Console → Google Ads API → Overview → Upgrade access level → apply for Explorer. Make sure the OAuth client is in that same project.";
  if (/USER_PERMISSION_DENIED|PERMISSION_DENIED|insufficient permissions|\b403\b/i.test(msg)) {
    if (product === "ads" && prof?.loginCustomerId)
      return `Access denied. Check loginCustomerId ${prof.loginCustomerId} is the manager that owns this account, and that this login has access to that manager.`;
    if (product === "ads") return "The login can't reach this account. If it's under a manager account, set loginCustomerId in the profile; otherwise ask for access in Google Ads.";
    if (product === "ga4") return "Add the login as Viewer (Editor for key events) in GA4 → Admin → Property access management.";
    if (product === "ga4admin") return "GA4 Admin needs Editor on the property, and the analytics.edit scope: re-run `npx google-marketing-agent init` if you signed in before it was requested.";
    if (product === "gsc") return "Add the signed-in Google account as a Full or Restricted user on the Search Console property (gscSiteUrl must match it exactly).";
    return "Add the login as a user on the Tag Manager container (Read; Edit/Publish for changes).";
  }
  return "See docs/troubleshooting.md";
}

async function check(label: string, product: Product, fn: () => Promise<unknown>, prof?: Profile): Promise<Line> {
  try {
    await fn();
    return { ok: true, label };
  } catch (err) {
    const msg = formatError(err);
    return { ok: false, label: `${label}: ${msg.split("\n")[0]}`, fix: fixFor(product, msg, prof) };
  }
}

export async function runDoctor(p: Probes): Promise<Line[]> {
  const broken = p.problems?.() ?? [];
  if (broken.length)
    return broken.map((label) => ({ ok: false, label, fix: "Fix the JSON / field shown, or re-run npx google-marketing-agent init" }));
  if (!p.credentials()) return [{ ok: false, label: "Not signed in", fix: "Run: npx google-marketing-agent init" }];
  const profiles = Object.entries(p.config().accounts);
  if (!profiles.length) return [{ ok: false, label: "No profiles configured", fix: "Run: npx google-marketing-agent init" }];

  const lines: Line[] = [];
  if (p.credentialsTooOpen?.())
    lines.push({ ok: false, label: "credentials.json is readable by other users", fix: `Run: chmod 600 "${configPaths().credentials}"` });

  let accessible: string[] = [];
  const token = await check("OAuth token", "ads", async () => (accessible = await p.listAccessible()));
  lines.push(token.ok ? { ok: true, label: `OAuth token valid (${accessible.length} Google Ads account(s) directly accessible)` } : token);
  if (!token.ok) return lines;

  let readable: [string, Profile] | undefined;
  for (const [alias, prof] of profiles) {
    const read = await check(`${alias}: Google Ads customer ${prof.customerId} readable`, "ads", () => p.adsRead(prof, alias), prof);
    if (read.ok) readable ??= [alias, prof];
    lines.push(read);
    if (prof.ga4PropertyId) {
      lines.push(await check(`${alias}: GA4 property ${prof.ga4PropertyId} readable`, "ga4", () => p.ga4(prof, alias)));
      lines.push(await check(`${alias}: GA4 Admin (key events) accessible`, "ga4admin", () => p.ga4Admin(prof, alias)));
    }
    if (prof.gscSiteUrl) lines.push(await check(`${alias}: GSC ${prof.gscSiteUrl} readable`, "gsc", () => p.gsc(prof, alias)));
    if (prof.gtmContainerId) lines.push(await check(`${alias}: Tag Manager ${prof.gtmContainerId} readable`, "gtm", () => p.gtm(prof, alias)));
  }

  if (readable) {
    const planner = await check("Google Ads API access", "ads", () => p.keywordPlanner(readable![1], readable![0]), readable[1]);
    if (planner.ok) lines.push({ ok: true, label: "Google Ads API access: Basic or higher" });
    else if (PLANNER_DENIED.test(planner.label)) lines.push({ ok: true, label: "Google Ads API access: Explorer (Keyword Planner needs Basic)" });
    else lines.push(planner);
  }
  const writable = profiles.filter(([, pr]) => pr.writes === true).map(([a]) => a);
  lines.push({ ok: true, label: `Writes enabled: ${writable.length ? writable.join(", ") : "none (read-only everywhere)"}` });
  return lines;
}

export const renderDoctor = (lines: Line[]) =>
  lines.map((l) => `${l.ok ? "✓" : "✗"} ${l.label}${l.fix ? `\n    → ${l.fix}` : ""}`).join("\n");

export function liveProbes(store: AccountStore): Probes {
  const ctxFor = (alias: string) => store.context(alias);
  return {
    credentials: () => {
      try {
        return store.credentials();
      } catch {
        return undefined;
      }
    },
    config: () => store.configSnapshot(),
    listAccessible: () => liveDiscoverDeps(store.credentials()).listAccessible(),
    adsRead: async (_p, alias) => {
      await ctxFor(alias).customer().query("SELECT customer.id FROM customer LIMIT 1");
    },
    keywordPlanner: async (p, alias) => {
      await ctxFor(alias).customer().keywordPlanIdeas.generateKeywordIdeas({
        customer_id: p.customerId,
        keyword_seed: { keywords: ["test"] },
        page_size: 1,
      } as any);
    },
    ga4: async (p, alias) => {
      await ctxFor(alias).ga4Data().getMetadata({ name: `properties/${p.ga4PropertyId}/metadata` });
    },
    ga4Admin: async (p, alias) => {
      await google.analyticsadmin({ version: "v1beta", auth: ctxFor(alias).trackingAuth() as any }).properties.keyEvents.list({ parent: `properties/${p.ga4PropertyId}` });
    },
    gsc: async (p, alias) => {
      await google.searchconsole({ version: "v1", auth: ctxFor(alias).oauth() }).sites.get({ siteUrl: p.gscSiteUrl! });
    },
    gtm: async (p, alias) => {
      const tm = google.tagmanager({ version: "v2", auth: ctxFor(alias).trackingAuth() as any });
      for (const a of (await tm.accounts.list()).data.account ?? []) {
        const cs = (await tm.accounts.containers.list({ parent: a.path! })).data.container ?? [];
        if (cs.some((c) => c.publicId === p.gtmContainerId)) return;
      }
      throw new Error(`PERMISSION_DENIED: container ${p.gtmContainerId} not visible to this login`);
    },
    problems: () => store.loadProblems(),
    credentialsTooOpen: () => {
      try {
        return (statSync(configPaths().credentials).mode & 0o077) !== 0;
      } catch {
        return false;
      }
    },
  };
}
