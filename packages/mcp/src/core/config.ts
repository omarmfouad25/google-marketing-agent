// Profiles (accounts.json) and OAuth credentials (credentials.json), both owner-only.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export type Profile = {
  customerId: string;
  loginCustomerId?: string;
  currency: string;
  timezone: string;
  geos?: string[];
  languages?: string[];
  ga4PropertyId?: string;
  gscSiteUrl?: string;
  gtmContainerId?: string;
  /** More GTM containers in this Profile's scope; gtmContainerId (or the first of these) is the default */
  gtmContainerIds?: string[];
  writes?: boolean;
  /** Refuse Confirmations the human didn't answer directly (apps without MCP elicitation can't write) */
  requireHumanApproval?: boolean;
  guardrails?: { maxBudgetChangePct?: number };
  brand?: { name?: string; logo?: string; colors?: string[] };
};
export type Config = { default?: string; accounts: Record<string, Profile> };
export type Credentials = { clientId: string; clientSecret: string; refreshToken: string; serviceAccountKey?: string };

export class ConfigError extends Error {}

export function configPaths() {
  const accounts =
    process.env.GOOGLE_MARKETING_AGENT_CONFIG || join(homedir(), ".config", "google-marketing-agent", "accounts.json");
  const dir = dirname(accounts);
  return { dir, accounts, credentials: join(dir, "credentials.json"), changes: join(dir, "changes") };
}

export function writePrivate(path: string, data: string) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700); // mkdirSync leaves an existing dir's mode alone
  const tmp = path + ".tmp";
  writeFileSync(tmp, data, { mode: 0o600 });
  chmodSync(tmp, 0o600); // a stale tmp file keeps its old mode
  renameSync(tmp, path); // atomic: secrets never sit in a wider-permission file
}

// secret files: report the position only, JSON.parse messages can echo fragments of the content
function readJson(path: string, secret = false): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const msg = (err as Error).message;
    const pos = /position (\d+)/.exec(msg)?.[1];
    const detail = secret ? `invalid JSON${pos ? ` at position ${pos}` : ""}` : msg;
    throw new ConfigError(`Can't read ${path}: ${detail}`, { cause: err });
  }
}

const id = z.union([z.string(), z.number()]).transform((v) => String(v).replace(/-/g, ""));
const profileShape = z
  .object({
    customerId: id,
    loginCustomerId: id.optional(),
    writes: z.boolean().optional(),
    requireHumanApproval: z.boolean().optional(),
    gtmContainerIds: z.array(z.string().regex(/^GTM-[A-Z0-9]+$/)).optional(),
    guardrails: z.object({ maxBudgetChangePct: z.number().positive() }).partial().optional(),
  })
  .passthrough();
const ALIAS = /^[a-z0-9][a-z0-9-]*$/; // aliases name files under changes/: no path characters

export function loadConfig(): Config {
  const file = configPaths().accounts;
  const raw = readJson(file);
  if (raw === undefined) return { accounts: {} };
  const root = z.object({ accounts: z.record(z.string(), z.unknown()).optional() }).passthrough().safeParse(raw);
  if (!root.success) throw new ConfigError(`Invalid ${file}: "accounts" must be an object of profiles`);
  const accounts: Record<string, Profile> = {};
  for (const [alias, p] of Object.entries(root.data.accounts ?? {})) {
    if (!ALIAS.test(alias)) throw new ConfigError(`Invalid ${file}: alias "${alias}" must be lowercase letters, digits and dashes`);
    const r = profileShape.safeParse(p);
    if (!r.success) {
      const issue = r.error.issues[0];
      const field = issue.path.join(".") || "profile";
      const want =
        field === "writes" || field === "requireHumanApproval" ? "true or false"
        : field.startsWith("guardrails") ? "a positive number (guardrails.maxBudgetChangePct)"
        : field.startsWith("gtmContainerIds") ? 'a list of container IDs like ["GTM-ABC123"]'
        : "a string or number";
      throw new ConfigError(`Invalid ${file}: profile "${alias}" field "${field}" must be ${want}`);
    }
    accounts[alias] = { ...(p as object), ...r.data } as Profile;
  }
  return { ...(root.data as Config), accounts };
}

export function saveConfig(c: Config) {
  writePrivate(configPaths().accounts, JSON.stringify(c, null, 2) + "\n");
}

const credShape = z.object({ clientId: z.string(), clientSecret: z.string(), refreshToken: z.string() }).passthrough();

export function loadCredentials(): Credentials | undefined {
  const file = configPaths().credentials;
  const raw = readJson(file, true);
  if (raw === undefined) return undefined;
  const r = credShape.safeParse(raw);
  if (!r.success) {
    const field = r.error.issues[0].path.join(".") || "credentials";
    throw new ConfigError(`Invalid ${file}: field "${field}" is missing or not a string`);
  }
  return r.data as Credentials;
}

export function saveCredentials(c: Credentials) {
  writePrivate(configPaths().credentials, JSON.stringify(c, null, 2) + "\n");
}
