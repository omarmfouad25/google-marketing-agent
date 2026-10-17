// Every tool goes through here: adds the optional `account` param, resolves it, and never throws.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AccountStore, Ctx } from "./context.js";
import { formatError } from "./errors.js";
import type { Human } from "./confirm.js";

export type ToolResult = { content: { type: "text"; text: string }[] };
export const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

const ProfileAlias = z.string().optional().describe("Profile alias from accounts.json. Defaults to the session or default profile");

const ASK_TIMEOUT_MS = 10 * 60_000;

/** The human, through MCP elicitation, when the connected client supports it */
function humanVia(server: McpServer): Human | undefined {
  const s = (server as Partial<McpServer>).server;
  if (!s) return undefined;
  return {
    supported: () => Boolean(s.getClientCapabilities()?.elicitation),
    ask: async (message) =>
      (await s.elicitInput({ message, requestedSchema: { type: "object", properties: {} } }, { timeout: ASK_TIMEOUT_MS })).action,
  };
}

export function defineTool(server: McpServer, store: AccountStore) {
  const human = humanVia(server);
  if (human) store.gate.setHuman(human);
  // noAccount: for guide / doctor / account tools that must work with zero profiles. No `profile` param, no ctx.
  function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>, opts: { noAccount: true }): void;
  function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>, ctx: Ctx) => Promise<ToolResult>): void;
  function tool(name: string, description: string, shape: z.ZodRawShape, handler: (args: any, ctx: Ctx) => Promise<ToolResult>, opts?: { noAccount: true }) {
    const full = opts?.noAccount ? shape : { ...shape, profile: ProfileAlias };
    server.tool(name, description, full, async (args: any) => {
      try {
        return await handler(args, opts?.noAccount ? (undefined as never) : store.context(args.profile));
      } catch (err) {
        return text(`ERROR: ${formatError(err)}`);
      }
    });
  }
  return tool;
}

export type Tool = ReturnType<typeof defineTool>;
