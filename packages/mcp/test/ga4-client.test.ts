import { describe, it, expect, vi } from "vitest";

const ctor = vi.hoisted(() => vi.fn());
vi.mock("@google-analytics/data", () => ({ BetaAnalyticsDataClient: ctor }));
const { AccountStore } = await import("../src/core/context.js");

describe("ga4Data client", () => {
  it("is built from the stored credentials, not an authClient", () => {
    const store = new AccountStore({
      config: { accounts: { a: { customerId: "1", currency: "USD", timezone: "UTC" } } },
      credentials: { clientId: "id", clientSecret: "sec", refreshToken: "rt" },
    });
    store.context("a").ga4Data();
    const opts = ctor.mock.calls[0][0];
    expect(opts.authClient).toBeUndefined();
    expect(opts.credentials).toEqual({ type: "authorized_user", client_id: "id", client_secret: "sec", refresh_token: "rt" });
  });
});
