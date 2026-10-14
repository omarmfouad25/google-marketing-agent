import type { Tool } from "../../core/tool.js";
import { registerStatusBudgetBids } from "./status-budget-bids.js";
import { registerGoals } from "./goals.js";
import { registerKeywords } from "./keywords.js";
import { registerSearch } from "./search.js";
import { registerDemandGen } from "./demand-gen.js";
import { registerRollback } from "./rollback.js";

export function registerAdsWriteTools(tool: Tool) {
  registerStatusBudgetBids(tool);
  registerGoals(tool);
  registerKeywords(tool);
  registerSearch(tool);
  registerDemandGen(tool);
  registerRollback(tool);
}
