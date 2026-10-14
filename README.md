# google-marketing-agent

**Google Ads MCP server + Claude Code skills for Google Ads, GA4, Search Console and Tag Manager.**
Audit an account, explain performance, produce client-ready reports, and build or optimise campaigns, with every
change previewed first, logged, and reversible.

> **Status: 0.1.** The engine was extracted from a setup running on a live account. Issues and ideas welcome on [GitHub](https://github.com/omarmfouad25/google-marketing-agent/issues).

---

## Why this exists

Most Google Ads MCP servers are read-only, or they let the model write straight into your account. This one is built
for **doing the work safely**:

- **Preview first.** Every write is validated by Google (`validate_only`) and shown to you. Nothing changes until you
  confirm.
- **Logged and reversible.** Each applied change is stored with its prior state. `ads_rollback` reverts it.
- **Guardrails.** New campaigns and ads are created PAUSED. Budget jumps above a limit need an explicit override.
  Location targeting is always "people in the location", never the API default that also serves people merely
  *interested in* it.
- **Writes off by default**, per account. Agencies can enable one client and keep another read-only.
- **One login, four products:** Google Ads, GA4, Search Console, Tag Manager.
- **Skills, not just tools.** Audits, insights and reports encode what to check and what good looks like, learned on
  a real account.

## What you can do

| Ask your agent | What happens |
|---|---|
| "Audit my Google Ads account" | Scored audit: goals, location leaks, wasted search terms, negatives, Quality Score, budgets, assets, policy issues, prioritised fixes |
| "Why did cost per lead go up last week?" | Period-over-period insight, with Ads conversions cross-checked against GA4 leads |
| "Is this campaign ready to launch?" | Pre-launch check of goal, channels, audience, geo, assets and approvals |
| "Make the monthly report for Acme" | Client-ready HTML report in the client's brand colours |
| "Pause the brand campaign" / "Raise the budget to 150" | Preview → your confirm → applied, logged, reversible |
| "Which queries is our blog ranking for?" | Search Console queries, pages, cannibalisation |
| "Is the lead form tag firing?" | GTM tags, triggers and GA4 key events |

## Quick start

You need Node.js 20+, a Google account with access to the Google Ads account (and GA4 / Search Console / Tag Manager
if you use them), and a Google Cloud project. The **[setup guide](docs/setup.md)** walks through every step.

```bash
# 1. Create your profile (opens the Google sign-in, lists your accounts)
npx google-marketing-agent init

# 2. Check everything is connected
npx google-marketing-agent doctor
```

**Claude Code (plugin: installs the MCP server and the skills):**

```
/plugin install google-marketing-agent --marketplace omarmfouad25/google-marketing-agent
```

On Claude Code older than 2.1.275, run `/plugin marketplace add omarmfouad25/google-marketing-agent` first, then
`/plugin install google-marketing-agent`.

**Any other MCP client** (Claude Desktop, Cursor, Codex…):

```json
{
  "mcpServers": {
    "google-marketing": { "command": "npx", "args": ["-y", "google-marketing-agent"] }
  }
}
```

Then ask: *"Run the setup doctor"*, then *"Audit my Google Ads account for the last 30 days."*

## Skills

Skills install with the Claude Code plugin. You don't call them by name: ask in plain language and the matching skill
loads.

| Skill | Use it for |
|---|---|
| `setup` | First-time setup, guided until `doctor` is green |
| `ads-audit` | Full account audit with a prioritised fix list |
| `performance-insights` | What changed, why, and what to do about it |
| `pre-launch-check` | One campaign, before it goes live |
| `weekly-check` | The weekly control routine |
| `monthly-report` | Branded, client-ready report |

Planned next: `campaign-architect`, `search-launch`, `demand-gen-launch`, `search-terms-mining`, `optimize`,
`tracking-audit`, `search-console-audit`. See [docs/skills.md](docs/skills.md).

## Tools

56 tools (33 with writes off) across four products: Google Ads reporting and GAQL, Google Ads writes (status, budgets, bids,
keywords, negatives and shared lists, Search and Demand Gen campaigns, RSAs, Demand Gen image ads and audiences,
extensions, conversion goals), GA4 reporting and key events, Search Console analytics and URL inspection, Tag Manager
tags/triggers/variables and publishing. Full reference: **[docs/tools.md](docs/tools.md)**.

## Multiple accounts (agencies)

One login can serve many accounts through profiles:

```json
{
  "default": "acme",
  "accounts": {
    "acme":   { "customerId": "1234567890", "currency": "USD", "writes": true },
    "globex": { "customerId": "2345678901", "currency": "EUR", "writes": false }
  }
}
```

Every tool accepts `account: "globex"`. See [docs/profiles.md](docs/profiles.md).

## Safety

Read **[docs/safety.md](docs/safety.md)** before enabling writes. Short version: writes are off until you turn them
on per account, every write is a preview until you confirm, and every applied change is logged and reversible.

## Docs

- [Setup](docs/setup.md): Google Cloud project, APIs, OAuth, Ads API access, permissions
- [Profiles](docs/profiles.md): accounts, defaults, brand, guardrails
- [Safety](docs/safety.md): preview, guardrails, change log, rollback
- [Tools](docs/tools.md): every tool and its parameters
- [Skills](docs/skills.md): what each skill does and how to trigger it
- [Troubleshooting](docs/troubleshooting.md): common errors and their fixes

## Contributing

Issues and PRs welcome. Never paste tokens, customer IDs or client data into issues. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT. Not affiliated with or endorsed by Google. Google Ads, Google Analytics, Search Console and Tag Manager are
trademarks of Google LLC.
