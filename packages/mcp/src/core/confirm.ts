// The Preview → Confirmation gate (docs/adr/0001). A Preview gets a single-use ID bound to a hash of its content,
// so any state it read (current budget, entity fingerprint, live version) voids it when that state changes.
// A Confirmation must name a matching Preview; where the client supports elicitation the human is asked too.

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { ToolResult } from "./tool.js";

export const PREVIEW_TTL_MS = 15 * 60_000;

export const Confirm = z
  .string()
  .regex(/^pv_[0-9a-f]{8}$/, "a Preview ID like pv_1a2b3c4d")
  .optional()
  .describe("Omit to get a Preview (nothing changes). To apply, pass the Preview ID it returned, with the same arguments");

export type ConfirmationKind = "human-approved" | "preview-matched";
export type HumanAnswer = "accept" | "decline" | "cancel";

/** How the server reaches the human: absent or unsupported means preview-matched Confirmations only */
export type Human = { supported(): boolean; ask(message: string): Promise<HumanAnswer> };

type Pending = { alias: string; tool: string; digest: string; expires: number };
type Who = { alias: string; profile: { requireHumanApproval?: boolean } };

// keys sorted so the same content always hashes the same, whatever order it was built in
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object" && !(v instanceof Uint8Array)) {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  }
  return v;
}
const digestOf = (content: unknown) => createHash("sha256").update(JSON.stringify(stable(content)) ?? "").digest("hex");

export class Gate {
  private pending = new Map<string, Pending>();

  constructor(private human?: Human, private now: () => number = Date.now) {}

  setHuman(human: Human) {
    this.human = human;
  }

  private canAsk() {
    return this.human?.supported() === true;
  }

  /**
   * Issue a Preview: `body` is what the human reads, `content` is everything the Change depends on.
   * `rollback` says whether and how the Change can be rolled back (docs/adr/0003).
   */
  preview(who: Who, tool: string, content: unknown, body: string, rollback: string): ToolResult {
    for (const [id, p] of this.pending) if (p.expires <= this.now()) this.pending.delete(id);
    const id = `pv_${randomBytes(4).toString("hex")}`;
    this.pending.set(id, { alias: who.alias, tool, digest: digestOf(content), expires: this.now() + PREVIEW_TTL_MS });
    const strict = who.profile.requireHumanApproval && !this.canAsk()
      ? `\nProfile "${who.alias}" requires human approval and this app can't ask for it: the Confirmation will be refused.`
      : "";
    return { content: [{ type: "text", text: `${body}\n\nRollback: ${rollback}\n\nPreview ID: ${id} (valid 15 minutes, once). To apply, show this preview to the user, then call ${tool} again with the same arguments and confirm: "${id}".${strict}` }] };
  }

  /**
   * Check a Confirmation before anything changes. The Preview is used up whatever the outcome.
   * `message` is the recomputed Preview, shown to the human when the client can ask.
   */
  async confirm(who: Who, tool: string, content: unknown, previewId: string, message: string): Promise<{ kind: ConfirmationKind } | { refused: string }> {
    const p = this.pending.get(previewId);
    this.pending.delete(previewId);
    const again = `Call ${tool} without confirm to get a new preview.`;
    if (!p || p.expires <= this.now()) return { refused: `REFUSED (nothing changed): no valid preview "${previewId}". Previews last 15 minutes, work once and are lost when the server restarts. ${again}` };
    if (p.alias !== who.alias || p.tool !== tool) return { refused: `REFUSED (nothing changed): preview "${previewId}" was issued for ${p.tool} on profile "${p.alias}", not ${tool} on "${who.alias}". ${again}` };
    if (p.digest !== digestOf(content)) return { refused: `REFUSED (nothing changed): this change no longer matches preview "${previewId}" (different arguments, or the account changed since). ${again}` };
    if (!this.canAsk()) {
      if (who.profile.requireHumanApproval) return { refused: `REFUSED (nothing changed): profile "${who.alias}" requires human approval, and this app can't ask for it. Use an app that supports MCP elicitation (Claude Code), or set "requireHumanApproval": false for this profile.` };
      return { kind: "preview-matched" };
    }
    let answer: HumanAnswer;
    try {
      answer = await this.human!.ask(`Apply this change to profile "${who.alias}"?\n\n${message}`);
    } catch (err) {
      // no answer (timeout, closed app) is not a yes
      return { refused: `NOT APPLIED (nothing changed): the user didn't answer the approval prompt (${err instanceof Error ? err.message : String(err)}). Ask in the conversation before trying again.` };
    }
    if (answer === "accept") return { kind: "human-approved" };
    return { refused: `DECLINED by the user (nothing changed). Don't retry unless the user asks for this change again.` };
  }
}

type Gated = {
  tool: string;
  /** The Preview ID from the tool's `confirm` argument; absent = Preview */
  confirm?: string;
  headline: string;
  detail?: object;
  /** State the Preview read but doesn't show (e.g. an entity fingerprint): a change to it voids the Preview */
  state?: unknown;
  rollback: string;
};

/**
 * One call for tools that apply their own Change: returns the Preview or refusal to send back,
 * or the ConfirmationKind once it is safe to apply.
 */
export async function gated(ctx: Who & { gate: Gate }, w: Gated): Promise<ToolResult | ConfirmationKind> {
  const body = w.detail ? `${w.headline}\n\n${JSON.stringify(w.detail, null, 2)}` : w.headline;
  const content = { headline: w.headline, detail: w.detail, state: w.state };
  if (!w.confirm) return ctx.gate.preview(ctx, w.tool, content, body, w.rollback);
  const ok = await ctx.gate.confirm(ctx, w.tool, content, w.confirm, body);
  return "refused" in ok ? { content: [{ type: "text", text: ok.refused }] } : ok.kind;
}
