#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { AccountStore } from "./core/context.js";
import { registerAll } from "./server.js";
import { serve } from "./index.js";
import { formatError } from "./core/errors.js";
import type { Human } from "./core/confirm.js";

const HELP = `google-marketing-agent <command>

  (no command) | serve           Run the MCP server on stdio
  init [--service-account key]   Sign in with Google and create profiles
  doctor                         Check every API, account and permission
  accounts                       List profiles
  accounts add                   Add profiles for more reachable accounts
  accounts set <alias> <field> <value>
  accounts default <alias>
  call <tool> <args.json> [--apply]
                                 Run one tool with JSON arguments. Changes are previews;
                                 --apply previews, asks you (in a terminal) and applies`;

type Registered = { shape: z.ZodRawShape; handler: (a: unknown) => Promise<{ content: { text: string }[] }> };

/** The terminal user, when there is one to ask: a script or cron job has no TTY */
export function terminalHuman(): Human {
  return {
    supported: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: async (message) => {
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return /^y(es)?$/i.test((await rl.question(`${message}\n\nApply? [y/N] `)).trim()) ? "accept" : "decline";
      } finally {
        rl.close();
      }
    },
  };
}

type CallOpts = { apply?: boolean; human?: Human };

// Previews live in this process's memory, so --apply previews and confirms in the same run.
export async function call(name: string | undefined, argsFile: string | undefined, store = new AccountStore(), { apply = false, human = terminalHuman() }: CallOpts = {}): Promise<number> {
  if (!name || !argsFile) {
    console.error("Usage: google-marketing-agent call <tool> <args.json> [--apply]");
    return 1;
  }
  store.gate.setHuman(human);
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
    let out = (await t.handler(args)).content[0].text;
    const previewId = apply ? /Preview ID: (pv_[0-9a-f]{8})/.exec(out)?.[1] : undefined;
    // asked in a terminal, the prompt shows the Preview; a script gets it printed before the change applies
    if (previewId && !human.supported()) console.log(out);
    if (previewId) out = (await t.handler({ ...args, confirm: previewId })).content[0].text;
    console.log(out);
    return /^(ERROR|REFUSED|DECLINED|NOT APPLIED|FAILED)/.test(out) ? 1 : 0;
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
    case "call": {
      const [name, argsFile] = rest.filter((a) => a !== "--apply");
      return call(name, argsFile, undefined, { apply: rest.includes("--apply") });
    }
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
