// Lint for the shipped skills: frontmatter, real tool names, real guide topics, read-only by default.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AccountStore } from "../src/core/context.js";
import { registerAll } from "../src/server.js";
import { listTopics } from "../src/core/guide.js";
import { fakeServer } from "./fakes.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../skills");
const EXPECTED = ["ads-audit", "campaign-architect", "demand-gen-launch", "monthly-report", "performance-insights", "pre-launch-check", "search-launch", "setup", "tracking-audit", "weekly-check"];
const TOOL_LIKE = /^(get|ads|ga4|gsc|gtm|run|setup|accounts|account|use|changes)_[a-z0-9_]+$|^guide$/;

const s = fakeServer();
registerAll(s, new AccountStore({ config: { accounts: {} }, credentials: { clientId: "i", clientSecret: "s", refreshToken: "r" } }), { writes: true });
const tools = new Set(Object.keys(s.tools));
const topics = new Set(listTopics());

describe("monthly-report template", () => {
  it("is self-contained and every placeholder is explained in SKILL.md", () => {
    const html = readFileSync(join(DIR, "monthly-report", "template.html"), "utf8");
    const md = readFileSync(join(DIR, "monthly-report", "SKILL.md"), "utf8");
    expect(html).not.toMatch(/(src|href)=["']https?:/);
    expect(html).toMatch(/@media print/);
    for (const [, ph] of html.matchAll(/\{\{([A-Z_]+)\}\}/g)) {
      const covered = md.includes(ph) || (/_DIR$/.test(ph) && md.includes("*_DIR")) || (/_DELTA$/.test(ph) && md.includes("*_DELTA"));
      expect(covered, `placeholder ${ph} not described`).toBe(true);
    }
  });
});

describe("skills", () => {
  it("ships every skill", () => {
    expect(existsSync(DIR)).toBe(true);
    expect(readdirSync(DIR).filter((d) => existsSync(join(DIR, d, "SKILL.md"))).sort()).toEqual(EXPECTED);
  });

  for (const name of EXPECTED) {
    describe(name, () => {
      const file = join(DIR, name, "SKILL.md");
      const md = existsSync(file) ? readFileSync(file, "utf8") : "";
      it("has frontmatter with matching name and a trigger-rich description", () => {
        const fm = md.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
        expect(fm.match(/^name:\s*(.+)$/m)?.[1]?.trim()).toBe(name);
        expect((fm.match(/^description:\s*(.+)$/m)?.[1] ?? "").length).toBeGreaterThan(80);
      });
      it("names only registered tools and real guide topics", () => {
        const named = [...md.matchAll(/`([a-z0-9_]+)(?:\(|`)/g)].map((m) => m[1]).filter((t) => TOOL_LIKE.test(t));
        expect(named.length).toBeGreaterThan(0);
        for (const t of named) expect(tools.has(t), `${name}: unknown tool ${t}`).toBe(true);
        for (const m of md.matchAll(/guide\("([a-z-]+)"\)/g)) expect(topics.has(m[1]), `${name}: unknown topic ${m[1]}`).toBe(true);
      });
      it("never applies writes on its own", () => {
        expect(md).not.toMatch(/confirm:\s*true/);
        expect(md).toMatch(/## Never/);
        if (name === "monthly-report") expect(md).toMatch(/not connected/); // missing GA4/GSC: skip with a note
      });
    });
  }
});
