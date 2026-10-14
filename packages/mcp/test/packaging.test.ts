import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const json = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

describe("packaging", () => {
  it("plugin, marketplace, MCP config and npm package agree on the name", () => {
    expect(json(".claude-plugin/plugin.json").name).toBe("google-marketing-agent");
    expect(json(".claude-plugin/marketplace.json").plugins[0].name).toBe("google-marketing-agent");
    expect(json(".mcp.json").mcpServers["google-marketing"].args).toEqual(["-y", "google-marketing-agent"]);
    expect(json("packages/mcp/package.json").bin["google-marketing-agent"]).toBe("dist/cli.js");
  });

  it("example profile is read-only by default and uses placeholder IDs", () => {
    const ex = json("examples/accounts.example.json");
    for (const p of Object.values<any>(ex.accounts)) expect(p.writes ?? false).toBe(false);
    expect(ex.accounts.acme.customerId).toBe("1234567890");
    expect(ex.accounts.acme.gtmContainerId).toBe("GTM-XXXXXXX");
  });

  it("demand gen example is a dry-run campaign call", () => {
    const ex = json("examples/demand-gen.example.json");
    expect(ex.confirm).toBe(false);
    expect(ex.bidding).toBe("MAXIMIZE_CONVERSIONS");
    expect(ex.dailyBudget).toBeGreaterThan(0);
  });
});
