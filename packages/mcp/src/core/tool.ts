// Every tool goes through here: adds the optional `account` param, resolves it, and never throws.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AccountStore, Ctx } from "./context.js";
import { formatError } from "./errors.js";

export type ToolResult = { content: { type: "text"; text: string }[] };
export const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

const Account = z.string().optional().describe("Profile alias from accounts.json. Defaults to the session or default account");

export function defineTool(server: McpServer, store: AccountStore) {
  // noAccount: for guide / doctor / account tools that must work with zero profiles. No `account` param, no ctx.
  function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>, opts: { noAccount: true }): void;
  function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>, ctx: Ctx) => Promise<ToolResult>): void;
  function tool(name: string, description: string, shape: z.ZodRawShape, handler: (args: any, ctx: Ctx) => Promise<ToolResult>, opts?: { noAccount: true }) {
    const full = opts?.noAccount ? shape : { ...shape, account: Account };
    server.tool(name, description, full, async (args: any) => {
      try {
        return await handler(args, opts?.noAccount ? (undefined as never) : store.context(args.account));
      } catch (err) {
        return text(`ERROR: ${formatError(err)}`);
      }
    });
  }
  return tool;
}

export type Tool = ReturnType<typeof defineTool>;
