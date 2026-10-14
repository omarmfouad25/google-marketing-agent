// Which Google Ads accounts can this login reach? Accessible customers plus, for managers, all their children.

import { GoogleAdsApi, Customer } from "google-ads-api";
import { Credentials } from "./config.js";
import { formatError } from "./errors.js";
import { DEVELOPER_TOKEN_PLACEHOLDER } from "./context.js";

export type DiscoveredAccount = {
  id: string;
  name: string;
  manager: boolean;
  currency: string;
  timezone: string;
  /** Set when the account is reached through a manager: use as the profile's loginCustomerId. */
  loginCustomerId?: string;
};

export type DiscoverDeps = {
  listAccessible(): Promise<string[]>;
  customer(id: string): Pick<Customer, "query">;
};

const QUERY = `SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager,
  customer_client.currency_code, customer_client.time_zone
  FROM customer_client WHERE customer_client.status = 'ENABLED'`;

export function liveDiscoverDeps(c: Credentials): DiscoverDeps {
  const api = new GoogleAdsApi({ client_id: c.clientId, client_secret: c.clientSecret, developer_token: DEVELOPER_TOKEN_PLACEHOLDER });
  return {
    listAccessible: async () => ((await api.listAccessibleCustomers(c.refreshToken)).resource_names ?? []).map((r) => r.split("/")[1]!),
    // querying as the root's own login works for plain accounts and for managers (returns the whole tree)
    customer: (id) => api.Customer({ customer_id: id, login_customer_id: id, refresh_token: c.refreshToken }),
  };
}

export async function discoverAccounts(deps: DiscoverDeps): Promise<DiscoveredAccount[]> {
  const found = new Map<string, DiscoveredAccount>();
  for (const root of await deps.listAccessible()) {
    try {
      for (const row of await deps.customer(root).query(QUERY)) {
        const cc = row.customer_client ?? {};
        const id = String(cc.id ?? "");
        if (!id || (id !== root && found.has(id))) continue; // a directly accessible account wins over a manager child entry
        found.set(id, {
          id,
          name: cc.descriptive_name || "(unnamed)",
          manager: !!cc.manager,
          currency: cc.currency_code ?? "",
          timezone: cc.time_zone ?? "",
          ...(id !== root && { loginCustomerId: root }),
        });
      }
    } catch (err) {
      // e.g. a cancelled or disabled customer; still list it by id
      if (!found.has(root)) found.set(root, { id: root, name: `(not readable: ${formatError(err).split("\n")[0]})`, manager: false, currency: "", timezone: "" });
    }
  }
  return [...found.values()];
}
