import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Credentials, Profile, loadConfig, loadCredentials, saveConfig, saveCredentials, configPaths } from "../core/config.js";
import { DiscoveredAccount, discoverAccounts, liveDiscoverDeps } from "../core/discover.js";
import { signIn } from "./oauth.js";

/** Everything that touches the network, browser or terminal, so tests can swap it. */
export type InitDeps = {
  ask(question: string): Promise<string>;
  signIn(clientId: string, clientSecret: string): Promise<string>;
  discover(creds: Credentials): Promise<DiscoveredAccount[]>;
  log(line: string): void;
  close(): void;
};

export function liveInitDeps(): InitDeps {
  const rl = createInterface({ input: stdin, output: stdout });
  return {
    ask: (q) => rl.question(q),
    signIn,
    discover: (c) => discoverAccounts(liveDiscoverDeps(c)),
    log: console.log,
    close: () => rl.close(),
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "account";

export async function addProfiles(d: InitDeps = liveInitDeps()): Promise<number> {
  try {
    const creds = loadCredentials();
    if (!creds) throw new Error("Not signed in. Run: npx google-marketing-agent init");
    const config = loadConfig();
    const accounts = (await d.discover(creds)).filter((a) => !a.manager);
    if (!accounts.length) {
      d.log("No Google Ads accounts reachable with this login.");
      return 1;
    }
    accounts.forEach((a, i) => d.log(`${i + 1}. ${a.name} (${a.id}, ${a.currency})${a.loginCustomerId ? ` via manager ${a.loginCustomerId}` : ""}`));
    const pick = (await d.ask("Accounts to add (e.g. 1,3 or all): ")).trim();
    const chosen = pick === "all" ? accounts : pick.split(",").map((n) => accounts[Number(n.trim()) - 1]).filter(Boolean);
    if (!chosen.length) {
      d.log("No accounts selected.");
      return 1;
    }
    for (const a of chosen) {
      const alias = (await d.ask(`Alias for ${a.name} [${slug(a.name)}]: `)).trim() || slug(a.name);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(alias)) throw new Error(`Invalid alias "${alias}": use lowercase letters, digits and dashes`);
      const found = { customerId: a.id, currency: a.currency, timezone: a.timezone };
      const prior = Object.hasOwn(config.accounts, alias) ? config.accounts[alias] : undefined;
      if (prior) {
        // re-picking an existing alias refreshes only what discovery knows; everything else (writes, guardrails, geos...) stays
        config.accounts[alias] = { ...prior, ...found };
        if (a.loginCustomerId) config.accounts[alias].loginCustomerId = a.loginCustomerId;
        else delete config.accounts[alias].loginCustomerId;
        d.log(`Updated existing profile "${alias}" (kept your other settings).`);
        continue;
      }
      const profile: Profile = { ...found, writes: false };
      if (a.loginCustomerId) profile.loginCustomerId = a.loginCustomerId;
      const ga4 = (await d.ask("  GA4 property ID (Enter to skip): ")).trim();
      const gsc = (await d.ask("  Search Console site, e.g. sc-domain:example.com (Enter to skip): ")).trim();
      const gtm = (await d.ask("  Tag Manager container GTM-XXXX (Enter to skip): ")).trim();
      if (ga4) profile.ga4PropertyId = ga4;
      if (gsc) profile.gscSiteUrl = gsc;
      if (gtm) profile.gtmContainerId = gtm;
      config.accounts[alias] = profile;
      config.default ??= alias;
    }
    saveConfig(config);
    d.log(`\nSaved ${chosen.length} profile(s) to ${configPaths().accounts} (read-only). Next: npx google-marketing-agent doctor`);
    return 0;
  } finally {
    d.close();
  }
}

const SETUP_INTRO = `
google-marketing-agent uses your own Google Cloud OAuth client (one-time, about 10 minutes):
  1. console.cloud.google.com: create a project, enable "Google Ads API" (+ Analytics Data / Admin,
     Search Console, Tag Manager APIs if you use them)
  2. Google Ads API page in that project: apply for Explorer access (usually approved in minutes)
  3. OAuth consent screen: Internal (Workspace) or External + In production (Testing tokens expire in 7 days)
  4. Credentials → Create credentials → OAuth client ID → Desktop app → copy the ID and secret
Full guide: https://github.com/omarmfouad25/google-marketing-agent/blob/main/docs/setup.md
`;

export async function initCommand(flags: { serviceAccount?: string }, mk: () => InitDeps = liveInitDeps): Promise<number> {
  const serviceAccount = flags.serviceAccount && resolve(flags.serviceAccount);
  if (serviceAccount && !existsSync(serviceAccount)) throw new Error(`Service account key not found: ${serviceAccount}`);
  const d = mk();
  let existing: Credentials | undefined;
  try {
    existing = loadCredentials();
    const reuse = existing && (await d.ask("Reuse the saved OAuth client? [Y/n] ")).trim().toLowerCase() !== "n";
    if (!reuse) d.log(SETUP_INTRO);
    const clientId = reuse ? existing!.clientId : (await d.ask("OAuth Client ID: ")).trim();
    const clientSecret = reuse ? existing!.clientSecret : (await d.ask("OAuth Client secret: ")).trim();
    if (!clientId || !clientSecret) throw new Error("Client ID and secret are required (see docs/setup.md)");
    const refreshToken = await d.signIn(clientId, clientSecret);
    // the service account is stored as a path only; the key file itself is never read or copied
    saveCredentials({ clientId, clientSecret, refreshToken, serviceAccountKey: serviceAccount || existing?.serviceAccountKey });
    d.log(`Signed in. Credentials saved to ${configPaths().credentials}`);
  } catch (err) {
    d.close();
    throw err;
  }
  return addProfiles(d);
}
