import { describe, it, expect } from "vitest";
import { z } from "zod";
import { AccountStore } from "../src/core/context.js";
import { defineTool, text } from "../src/core/tool.js";
import { fakeCustomer, fakeServer } from "./fakes.js";

const config = {
  default: "acme",
  accounts: {
    acme: { customerId: "111", currency: "USD", timezone: "UTC" },
    globex: { customerId: "222", currency: "EUR", timezone: "UTC", writes: true },
  },
};
const credentials = { clientId: "id", clientSecret: "s", refreshToken: "r" };
const store = () => new AccountStore({ config, credentials, makeCustomer: () => fakeCustomer() });

describe("AccountStore", () => {
  it("resolves the default, an alias, and a session switch", () => {
    const s = store();
    expect(s.context().alias).toBe("acme");
    expect(s.context("globex").profile.currency).toBe("EUR");
    s.use("globex");
    expect(s.context().alias).toBe("globex");
  });

  it("reports whether any profile is writable", () => {
    expect(store().anyWritable()).toBe(true);
  });

  it("names known aliases for an unknown one", () => {
    expect(() => store().context("acm")).toThrow(/Unknown account "acm".*acme, globex/);
  });

  it("points to init when no profiles exist", () => {
    const s = new AccountStore({ config: { accounts: {} }, credentials, makeCustomer: () => fakeCustomer() });
    expect(() => s.context()).toThrow(/npx google-marketing-agent init/);
  });

  it("treats an empty alias as unset and rejects inherited keys", () => {
    expect(store().context("").alias).toBe("acme");
    expect(() => store().context("constructor")).toThrow(/Unknown account "constructor".*acme, globex/);
  });
});

describe("defineTool", () => {
  it("adds an account param and passes the resolved ctx", async () => {
    const server = fakeServer();
    defineTool(server as any, store())("echo", "d", { n: z.number() }, async (a, ctx) => text(`${a.n}:${ctx.alias}`));
    expect(Object.keys(server.tools.echo.shape)).toEqual(["n", "account"]);
    const r = await server.tools.echo.handler({ n: 1, account: "globex" });
    expect(r.content[0].text).toBe("1:globex");
  });

  it("returns readable text instead of throwing", async () => {
    const server = fakeServer();
    defineTool(server as any, store())("bad", "d", {}, async () => text("never"));
    const r = await server.tools.bad.handler({ account: "nope" });
    expect(r.content[0].text).toMatch(/Unknown account "nope"/);
  });

  it("noAccount tools run with zero profiles; normal tools get the init message", async () => {
    const empty = new AccountStore({ config: { accounts: {} }, credentials, makeCustomer: () => fakeCustomer() });
    const server = fakeServer();
    const tool = defineTool(server as any, empty);
    tool("free", "d", {}, async () => text("ok"), { noAccount: true });
    tool("needs", "d", {}, async () => text("never"));
    expect(Object.keys(server.tools.free.shape)).toEqual([]);
    expect((await server.tools.free.handler({})).content[0].text).toBe("ok");
    expect((await server.tools.needs.handler({})).content[0].text).toMatch(/No accounts configured.*npx google-marketing-agent init/);
  });

  it("formats non-Error throws as readable text", async () => {
    const server = fakeServer();
    defineTool(server as any, store())("odd", "d", {}, async () => { throw { weird: true }; });
    expect((await server.tools.odd.handler({})).content[0].text).not.toMatch(/object Object/);
  });
});
