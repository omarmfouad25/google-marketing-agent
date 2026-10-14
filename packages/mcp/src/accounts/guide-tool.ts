import { z } from "zod";
import { Tool, text } from "../core/tool.js";
import { getTopic, listTopics } from "../core/guide.js";

export function registerGuide(tool: Tool) {
  tool(
    "guide",
    "Expert knowledge for Google marketing work. Call with no topic for the list, then read the topic you need " +
      "(gotchas, policy, access, demand-gen, measurement, benchmarks) before auditing, building or changing campaigns",
    { topic: z.string().optional() },
    async ({ topic }) =>
      text(topic ? getTopic(topic) : listTopics().map((t) => `- ${t}: ${getTopic(t).split("\n")[2] ?? ""}`).join("\n")),
    { noAccount: true }
  );
}
