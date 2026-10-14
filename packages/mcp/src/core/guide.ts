// Shared expertise shipped with the package (packages/mcp/knowledge/*.md), served to any MCP client.
import { readdirSync, readFileSync } from "node:fs";

const DIR = new URL("../../knowledge/", import.meta.url); // same depth from src/core and dist/core

export const listTopics = () => readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();

export function getTopic(name: string): string {
  if (!listTopics().includes(name)) throw new Error(`Unknown topic "${name}". Topics: ${listTopics().join(", ")}`);
  return readFileSync(new URL(`${name}.md`, DIR), "utf8");
}
