# google-marketing-agent

[![npm](https://img.shields.io/npm/v/google-marketing-agent)](https://www.npmjs.com/package/google-marketing-agent)
[![CI](https://github.com/omarmfouad25/google-marketing-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/omarmfouad25/google-marketing-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Let Claude (or any AI app that supports MCP) work on your Google Ads, GA4, Search Console and Tag Manager, safely.**

Ask in plain language. The agent audits accounts, explains what changed, writes client-ready reports and makes
campaign changes, and every change is previewed first, applied only after your yes, logged, and reversible.

```text
You:    Audit my Google Ads account for the last 30 days.
Agent:  Score 68/100. Biggest leak: 31% of spend is from people outside your target countries
        ("presence or interest" targeting on 2 campaigns). Fix list below, highest impact first…

You:    Fix the location targeting on both.
Agent:  Preview (nothing changed yet): 2 campaigns → people IN the location only. Apply?
You:    Yes.
Agent:  Applied (change 3f9c2a1b). You can undo it any time.
```

## What you can ask

| Ask | You get |
|---|---|
| "Audit my Google Ads account" | A scored audit (measurement, location leaks, wasted search terms, structure, budgets, ad quality) with a prioritised fix list |
| "Why did cost per lead go up last week?" | What changed, which campaigns and segments caused it, checked against GA4 leads, and 2–3 actions |
| "Weekly check for acme" | A one-page control note: spend vs budget, new search terms to block, disapproved ads, anomalies |
| "Is this campaign ready to launch?" | A pass/fix table for one paused campaign, then a launch preview if everything passes |
| "Make the September report for acme" | A branded, self-contained HTML report you print to PDF |
| "Pause the brand campaign" · "Add these negatives" | A preview → your yes → applied, logged, reversible |
| "Which queries is our blog ranking for?" · "Is the lead form tag firing?" | Search Console and Tag Manager answers from the same login |

More examples: **[docs/usage.md](docs/usage.md)**.

## How it keeps your account safe

- **Read-only until you say otherwise**, per account. Agencies can allow changes on one client and keep another read-only.
- **Preview first.** Google validates every change without applying it; nothing happens until you confirm.
- **Undo.** Every applied change is logged with its previous state; `ads_rollback` puts it back.
- **Guardrails.** New campaigns and ads start **paused**. Budget jumps above 50% (configurable) need an explicit override.
  Location targeting is always "people in the location", never Google's default that also includes people merely
  interested in it.
- **Your credentials stay on your computer**, in a file only you can read. The agent never sees them.

Details: **[docs/safety.md](docs/safety.md)**.

## Get started

You need **Node.js 20+** and a Google account that can open your Google Ads account. Allow about 15 minutes the first
time; the full walkthrough with checks is in **[docs/setup.md](docs/setup.md)**.

**1. Create your Google Cloud login (once, about 10 minutes).** A Cloud project with the Google Ads API enabled,
Explorer access, and a *Desktop app* OAuth client. No developer token needed.
→ [Setup, part 1](docs/setup.md#part-1-google-cloud-once)

**2. Sign in and pick your accounts.**

```bash
npx google-marketing-agent init      # opens Google sign-in, lists every account you can reach
npx google-marketing-agent doctor    # every line should be ✓
```

**3. Add it to your AI app.**

| App | How |
|---|---|
| **Claude Code** (tools + skills) | `/plugin install google-marketing-agent --marketplace omarmfouad25/google-marketing-agent` |
| Claude Code (tools only) | `claude mcp add google-marketing -- npx -y google-marketing-agent` |
| Claude Desktop, Cursor, others | Add the server below to the app's MCP settings |

```json
{
  "mcpServers": {
    "google-marketing": { "command": "npx", "args": ["-y", "google-marketing-agent"] }
  }
}
```

On Claude Code older than 2.1.275, run `/plugin marketplace add omarmfouad25/google-marketing-agent` first, then
`/plugin install google-marketing-agent`. More apps: [setup, part 3](docs/setup.md#part-3-connect-your-ai-app).

**4. Ask.** Start with *"Run the setup doctor"*, then *"Audit my Google Ads account for the last 30 days."*

## What's inside

| Part | What it is |
|---|---|
| **6 skills** | Workflows that tell the agent what to check and what good looks like: `setup`, `ads-audit`, `performance-insights`, `pre-launch-check`, `weekly-check`, `monthly-report`. [docs/skills.md](docs/skills.md) |
| **56 tools** | Google Ads reporting and changes (28), GA4 (10), Search Console (6), Tag Manager (6), accounts and help (6). 33 are read-only; the 23 that change things load only when an account allows changes. [docs/tools.md](docs/tools.md) |
| **Knowledge guide** | The `guide` tool serves hard-won notes: API traps, ad policy patterns, access levels, Demand Gen, measurement, benchmarks |
| **CLI** | `init`, `doctor`, `accounts`, `call`: setup and scripting from your terminal |

Skills install with the Claude Code plugin. Other agents that support Agent Skills can load the [`skills/`](skills)
folder directly.

## Documentation

| Read this | When you want to |
|---|---|
| [Setup](docs/setup.md) | Go from nothing to a working connection, step by step |
| [Usage](docs/usage.md) | See what to ask for audits, reports, weekly checks and safe changes |
| [Profiles](docs/profiles.md) | Manage several accounts, defaults, report branding and guardrails |
| [Safety](docs/safety.md) | Understand previews, guardrails, the change log and undo before allowing changes |
| [Skills](docs/skills.md) | Know exactly what each skill checks and produces |
| [Tools](docs/tools.md) | Look up every tool and its parameters |
| [How it works](docs/how-it-works.md) | See how the parts fit together and where your data lives |
| [FAQ](docs/faq.md) | Cost, privacy, developer tokens, which apps work |
| [Troubleshooting](docs/troubleshooting.md) | Fix an error `doctor` couldn't fix for you |

## FAQ in short

- **Does it cost anything?** The package is free (MIT). The Google APIs it uses are free; you only pay for your ads.
- **Do I need a Google Ads developer token?** No. Access now comes from your Google Cloud project.
- **Can it change my campaigns without asking?** No. Accounts are read-only by default, and every change needs your
  confirmation after a preview.
- **Where does my data go?** From Google straight to the AI app on your computer. Nothing is sent anywhere else.

More: [docs/faq.md](docs/faq.md).

## Contributing

Issues and pull requests are welcome. Never paste tokens, customer IDs or client data into an issue. See
[CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Licence

MIT © Omar Fouad. Not affiliated with or endorsed by Google. Google Ads, Google Analytics, Search Console and Tag
Manager are trademarks of Google LLC.
