import { z } from "zod";
import type { AccountStore } from "../core/context.js";
import { discoverAccounts, liveDiscoverDeps, type DiscoverDeps } from "../core/discover.js";
import { liveProbes, renderDoctor, runDoctor } from "../core/doctor.js";
import { Tool, text } from "../core/tool.js";

// deps is injectable for tests; defaults to live Google calls
export function registerAccountTools(tool: Tool, store: AccountStore, deps: () => DiscoverDeps = () => liveDiscoverDeps(store.credentials())) {
  tool(
    "setup_doctor",
    "Check sign-in, every API, each profile's accounts and the Ads access level; returns the exact fix for each failure",
    {},
    async () => text(renderDoctor(await runDoctor(liveProbes(store)))),
    { noAccount: true }
  );

  tool(
    "accounts_list",
    "Google Ads accounts this login can reach (including manager children), and which already have a profile",
    {},
    async () => {
      const found = await discoverAccounts(deps());
      const profiles = Object.entries(store.configSnapshot().accounts);
      const MAX_ROWS = 200;
      const rows = found.slice(0, MAX_ROWS).map((a) => {
        const alias = profiles.find(([, p]) => p.customerId === a.id)?.[0];
        const tags = [a.manager && "manager", a.currency, a.loginCustomerId && `via manager ${a.loginCustomerId}`].filter(Boolean).join(", ");
        return `- ${a.id} ${a.name}${tags ? ` (${tags})` : ""} → ${alias ? `profile "${alias}"` : "no profile (npx google-marketing-agent init)"}`;
      });
      const orphans = profiles.filter(([, p]) => !found.some((a) => a.id === p.customerId)).map(([alias, p]) => `- ${p.customerId} → profile "${alias}" (not reachable by this login)`);
      if (found.length > MAX_ROWS) rows.push(`…and ${found.length - MAX_ROWS} more`);
      return text([...rows, ...orphans].join("\n") || "No accounts reachable.");
    },
    { noAccount: true }
  );

  tool(
    "use_account",
    "Switch the default account for this session (not saved; edit \"default\" in accounts.json to persist)",
    { alias: z.string() },
    async ({ alias }) => {
      store.use(alias);
      return text(`Now using "${alias}" by default.`);
    },
    { noAccount: true }
  );
}
