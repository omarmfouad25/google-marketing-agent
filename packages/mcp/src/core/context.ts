// Resolves an account alias to its profile and Google clients. One login (credentials) serves every profile.

import { Customer, GoogleAdsApi } from "google-ads-api";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { Config, ConfigError, Credentials, Profile, loadConfig, loadCredentials } from "./config.js";
import { Gate } from "./confirm.js";

// Developer tokens were sunset on 2026-09-09; the value is ignored, but API v23 still rejects a missing header.
export const DEVELOPER_TOKEN_PLACEHOLDER = "unused";

const TRACKING_SCOPES = [
  "https://www.googleapis.com/auth/tagmanager.readonly",
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
  "https://www.googleapis.com/auth/tagmanager.publish",
  "https://www.googleapis.com/auth/analytics.edit",
];

export type Ctx = {
  alias: string;
  profile: Profile;
  customer(): Customer;
  oauth(): OAuth2Client;
  ga4Data(): BetaAnalyticsDataClient;
  trackingAuth(): OAuth2Client | InstanceType<typeof google.auth.GoogleAuth>;
  gate: Gate;
};

type Deps = { config?: Config; credentials?: Credentials; makeCustomer?: (p: Profile) => Customer };

export class AccountStore {
  private config: Config;
  private creds?: Credentials;
  private makeCustomer: (p: Profile) => Customer;
  private session?: string;
  private problems: ConfigError[] = [];
  // one per server: Previews are issued and confirmed across tool calls
  readonly gate = new Gate();

  // Lenient: a malformed accounts.json / credentials.json must not stop the server or the doctor.
  // The error is kept and rethrown by context() / credentials(); setup_doctor reports it.
  constructor(deps: Deps = {}) {
    this.config = deps.config ?? this.lenient(loadConfig, { accounts: {} });
    this.creds = deps.credentials ?? this.lenient(loadCredentials, undefined);
    this.makeCustomer = deps.makeCustomer ?? ((p) => this.adsCustomer(p));
  }

  private lenient<T>(load: () => T, fallback: T): T {
    try {
      return load();
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      this.problems.push(err);
      return fallback;
    }
  }

  loadProblems(): string[] {
    return this.problems.map((e) => e.message);
  }

  aliases() {
    return Object.keys(this.config.accounts);
  }

  anyWritable() {
    return Object.values(this.config.accounts).some((p) => p.writes === true);
  }

  configSnapshot(): Config {
    return structuredClone(this.config);
  }

  credentials(): Credentials {
    if (this.problems[0]) throw this.problems[0];
    if (!this.creds) throw new ConfigError("Not signed in. Run: npx google-marketing-agent init");
    return this.creds;
  }

  use(alias: string) {
    this.profile(alias);
    this.session = alias;
  }

  context(alias?: string): Ctx {
    const name: string = alias || this.session || this.config.default || this.aliases()[0] || "";
    const profile = this.profile(name);
    return {
      alias: name,
      profile,
      customer: () => this.makeCustomer(profile),
      oauth: () => this.oauth(),
      ga4Data: () => this.ga4Data(),
      trackingAuth: () => this.trackingAuth(),
      gate: this.gate,
    };
  }

  private profile(alias?: string): Profile {
    if (this.problems[0]) throw this.problems[0];
    if (!this.aliases().length) throw new ConfigError("No profiles configured. Run: npx google-marketing-agent init");
    const p = alias && Object.hasOwn(this.config.accounts, alias) ? this.config.accounts[alias] : undefined;
    if (!p) throw new ConfigError(`Unknown profile "${alias ?? ""}". Known: ${this.aliases().join(", ")}. Add one with: npx google-marketing-agent init`);
    return p;
  }

  private oauth(): OAuth2Client {
    const c = this.credentials();
    const auth = new google.auth.OAuth2(c.clientId, c.clientSecret);
    auth.setCredentials({ refresh_token: c.refreshToken });
    return auth;
  }

  // Built from the stored credentials: passing the googleapis OAuth2Client as authClient breaks against gax'
  // newer google-auth-library ("headers.forEach is not a function").
  private ga4Data() {
    const c = this.credentials();
    return new BetaAnalyticsDataClient({ credentials: { type: "authorized_user", client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken } as any });
  }

  private trackingAuth() {
    const key = this.credentials().serviceAccountKey;
    return key ? new google.auth.GoogleAuth({ keyFile: key, scopes: TRACKING_SCOPES }) : this.oauth();
  }

  private adsCustomer(p: Profile): Customer {
    const c = this.credentials();
    return new GoogleAdsApi({ client_id: c.clientId, client_secret: c.clientSecret, developer_token: DEVELOPER_TOKEN_PLACEHOLDER }).Customer({
      customer_id: p.customerId,
      refresh_token: c.refreshToken,
      login_customer_id: p.loginCustomerId,
    });
  }
}

export function requireField(ctx: Ctx, key: "ga4PropertyId" | "gscSiteUrl" | "gtmContainerId"): string {
  const v = ctx.profile[key];
  if (!v) throw new ConfigError(`Profile "${ctx.alias}" has no ${key}. Add it to accounts.json (see docs/profiles.md)`);
  return v;
}
