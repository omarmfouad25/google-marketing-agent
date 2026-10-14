import { Config, loadConfig, saveConfig } from "../core/config.js";
import { setPath } from "../core/paths.js";

const BOOL = new Set(["writes"]);
const NUM = new Set(["guardrails.maxBudgetChangePct"]);
const LIST = new Set(["geos", "languages", "brand.colors"]);
const DIGITS = new Set(["customerId", "loginCustomerId"]);
const STR = new Set([...DIGITS, "currency", "timezone", "ga4PropertyId", "gscSiteUrl", "gtmContainerId", "brand.name", "brand.logo"]);

export function setField(config: Config, alias: string, field: string, value: string): Config {
  const profile = Object.hasOwn(config.accounts, alias) ? config.accounts[alias] : undefined;
  if (!profile) throw new Error(`Unknown account "${alias}". Known: ${Object.keys(config.accounts).join(", ")}`);
  let v: unknown;
  if (BOOL.has(field)) {
    if (value !== "true" && value !== "false") throw new Error(`${field} must be true or false`);
    v = value === "true";
  } else if (NUM.has(field)) {
    v = /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
    if (!Number.isFinite(v) || (v as number) <= 0) throw new Error(`${field} must be a positive number`);
  } else if (LIST.has(field)) v = value.split(",").map((x) => x.trim()).filter(Boolean);
  else if (STR.has(field)) {
    v = DIGITS.has(field) ? value.replace(/-/g, "") : value;
    if (DIGITS.has(field) && !/^\d+$/.test(v as string)) throw new Error(`${field} must be a numeric Google Ads customer ID`);
  }
  else throw new Error(`Unknown field "${field}". Fields: ${[...BOOL, ...NUM, ...LIST, ...STR].join(", ")}`);
  setPath(profile, field, v);
  return config;
}

export async function accountsCommand(args: string[], addProfiles = async () => (await import("./init.js")).addProfiles()): Promise<number> {
  const [sub, ...rest] = args;
  const config = loadConfig();
  if (!sub) {
    const rows = Object.entries(config.accounts).map(
      ([a, p]) => `${a === config.default ? "*" : " "} ${a}  ${p.customerId}  ${p.currency}  writes=${p.writes === true ? "on" : "off"}`
    );
    console.log(rows.join("\n") || "No profiles. Run: npx google-marketing-agent init");
    return 0;
  }
  if (sub === "set") {
    const [alias, field, value] = rest;
    if (!alias || !field || value === undefined) throw new Error("Usage: accounts set <alias> <field> <value>");
    saveConfig(setField(config, alias, field, value));
    console.log(`${alias}.${field} = ${value}${field === "writes" ? "\nRestart your MCP client so write tools load or unload." : ""}`);
    return 0;
  }
  if (sub === "default") {
    if (!rest[0]) throw new Error("Usage: accounts default <alias>");
    if (!Object.hasOwn(config.accounts, rest[0])) throw new Error(`Unknown account "${rest[0]}"`);
    saveConfig({ ...config, default: rest[0] });
    return 0;
  }
  if (sub === "add") return addProfiles();
  throw new Error(`Unknown accounts command "${sub}"`);
}
