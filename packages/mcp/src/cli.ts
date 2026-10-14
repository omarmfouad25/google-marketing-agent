#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { AccountStore } from "./core/context.js";
import { registerAll } from "./server.js";
import { serve } from "./index.js";
import { formatError } from "./core/errors.js";

const HELP = `google-marketing-agent <command>

  (no command) | serve           Run the MCP server on stdio
  init [--service-account key]   Sign in with Google and create profiles
  doctor                         Check every API, account and permission
  accounts                       List profiles
  accounts add                   Add profiles for more reachable accounts
  accounts set <alias> <field> <value>
  accounts default <alias>
  call <tool> <args.json>        Run one tool with JSON arguments`;

type Registered = { shape: z.ZodRawShape; handler: (a: unknown) => Promise<{ content: { text: string }[] }> };

export async function call(name: string | undefined, argsFile: string | undefined, store = new AccountStore()): Promise<number> {
  if (!name || !argsFile) {
    console.error("Usage: google-marketing-agent call <tool> <args.json>");
    return 1;
  }
  const tools: Record<string, Registered> = {};
  // Write tools are registered even for read-only profiles, so a refused write explains itself (the runner still refuses).
  registerAll({ tool: (n: string, _d: string, shape: z.ZodRawShape, handler: Registered["handler"]) => (tools[n] = { shape, handler }) }, store, { writes: true });
  const t = tools[name];
  if (!t) {
    console.error(`Unknown tool "${name}". See docs/tools.md`);
    return 1;
  }
  try {
    const args = z.object(t.shape).parse(JSON.parse(readFileSync(argsFile, "utf8")));
    const out = (await t.handler(args)).content[0].text;
    console.log(out);
    return out.startsWith("ERROR:") ? 1 : 0;
  } catch (err) {
    console.error(formatError(err));
    return 1;
  }
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "serve":
      await serve();
      return -1; // keep running
    case "call":
      return call(rest[0], rest[1]);
    case "init": {
      const i = rest.indexOf("--service-account");
      if (i >= 0 && !rest[i + 1]) throw new Error("--service-account needs a path to the key file");
      const { initCommand } = await import("./cli/init.js");
      return initCommand({ serviceAccount: i >= 0 ? rest[i + 1] : undefined });
    }
    case "accounts": {
      const { accountsCommand } = await import("./cli/accounts.js");
      return accountsCommand(rest);
    }
    case "doctor": {
      const { runDoctor, liveProbes, renderDoctor } = await import("./core/doctor.js");
      const lines = await runDoctor(liveProbes(new AccountStore()));
      console.log(renderDoctor(lines));
      return lines.every((l) => l.ok) ? 0 : 1;
    }
    case "help":
    case "--help":
      console.log(HELP);
      return 0;
    default:
      console.error(HELP);
      return 1;
  }
}

const isEntry = (() => {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isEntry) {
  main(process.argv.slice(2))
    .then((code) => code >= 0 && process.exit(code))
    .catch((err) => {
      console.error(formatError(err));
      process.exit(1);
    });
}
