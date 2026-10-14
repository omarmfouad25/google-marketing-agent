import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AccountStore } from "./core/context.js";
import { createRequire } from "node:module";
import { registerAll } from "./server.js";

export async function serve() {
  const server = new McpServer({ name: "google-marketing-agent", version: createRequire(import.meta.url)("../package.json").version });
  registerAll(server, new AccountStore()); // lenient on a broken config: setup_doctor reports it
  await server.connect(new StdioServerTransport());
  console.error("google-marketing-agent MCP server running on stdio");
}
