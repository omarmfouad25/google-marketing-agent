// Registers every tool group on an MCP server (or anything with the same .tool() signature).

import { AccountStore } from "./core/context.js";
import { defineTool } from "./core/tool.js";
import { registerAdsReadTools } from "./ads/read.js";
import { registerAdsWriteTools } from "./ads/write/index.js";
import { registerGa4ReadTools } from "./ga4/read.js";
import { registerGa4AdminTools } from "./ga4/admin.js";
import { registerGscReadTools } from "./gsc/read.js";
import { registerGtmTools } from "./gtm/tools.js";
import { registerAccountTools } from "./accounts/tools.js";
import { registerGuide } from "./accounts/guide-tool.js";
import { registerChangesList } from "./accounts/changes.js";
import { registerProfileTool } from "./accounts/profile-tool.js";
import { registerRollback } from "./accounts/rollback.js";

export function registerAll(server: { tool: (...a: any[]) => void }, store: AccountStore, opts: { writes?: boolean } = {}) {
  const writes = opts.writes ?? store.anyWritable();
  const tool = defineTool(server as any, store);
  registerAccountTools(tool, store);
  registerGuide(tool);
  registerChangesList(tool); // read tools: always available
  registerProfileTool(tool);
  registerAdsReadTools(tool);
  registerGa4ReadTools(tool);
  registerGa4AdminTools(tool, { writes });
  registerGscReadTools(tool);
  registerGtmTools(tool, { writes });
  if (!writes) return;
  registerAdsWriteTools(tool);
  registerRollback(tool); // every product's Changes
}
