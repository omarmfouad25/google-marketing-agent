# google-marketing-agent

[![npm](https://img.shields.io/npm/v/google-marketing-agent)](https://www.npmjs.com/package/google-marketing-agent)
[![CI](https://github.com/omarmfouad25/google-marketing-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/omarmfouad25/google-marketing-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Let Claude (or any AI app that supports MCP) work on your Google Ads, GA4, Search Console and Tag Manager, safely.**

Ask in plain language. The agent plans campaigns and budgets, builds Search and Demand Gen campaigns, audits accounts,
explains what changed and writes client-ready reports. Every change is previewed first, applied only after your yes,
logged, and reversible.

```text
You:    Audit my Google Ads account for the last 30 days.
Agent:  Score 68/100. Biggest leak: 31% of spend is from people outside your target countries
        ("presence or interest" targeting on 2 campaigns). Fix list below, highest impact first…

You:    Fix the location targeting on both.
Agent:  Preview (nothing changed yet): 2 campaigns → people IN the location only. Apply?
You:    Yes.
Agent:  Applied (change 3f9c2a1b). You can undo it any time.
```

## What you can do

### Plan and budget

| Ask | You get |
|---|---|
| "Plan our Q4 campaigns" · "How should I split the budget?" | A campaign plan built from the account's own data: which campaigns and types, naming, budget per campaign with a minimum-budget check, bidding stage, goals and negative lists |
| "Restructure this account" | A diagnosis of what wastes money today, then the new structure and a transition plan |

### Build campaigns

| Ask | You get |
|---|---|
| "Build the Search campaign for <product>" | Themed keywords, ad copy for your approval (character counts, policy-safe wording, second language), then the campaign, ad groups, ads, sitelinks, callouts, goal and negatives, all created **paused** |
| "Launch Demand Gen with these images" | An image check, one ad group per language, an audience from your customer list, lookalikes and custom segments, created **paused**, then a first-week read |
| "Is this campaign ready to launch?" | A pass/fix table (goal, bidding, channels, locations, audience, assets, approvals), then a launch preview |

### Set up and fix tracking

Plan what to track, build it in Tag Manager from typed recipes, publish after you see the diff, then check what
visitors actually get. Every tag, trigger and variable is previewed first; the previous live version is the rollback.

```text
You:    Track form leads and WhatsApp clicks on acme.com, split business and consumer.
Agent:  Plan: generate_lead and contact_click, split by /business/ vs /consumer/, 4 Ads actions, 2 goals,
        plus the dataLayer code for your developers. Build it?
You:    Yes.
Agent:  Preview 1 of 14: CREATE variables "DLV - form_name" (nothing changed). Create it? …
Agent:  Workspace vs live version 12: 4 variables, 4 triggers, 6 tags added. Publish as "2026-10-15 lead tracking"?
You:    Yes.
Agent:  Version 13 is live (rollback: version 12). Live check ✓ every label and event found in gtm.js.
        Next: the test matrix, one real lead per row.
```

| Ask | Skill | You get |
|---|---|---|
| "Plan lead tracking for acme.com" | `tracking-plan` | Event matrix, data-layer code for developers, custom dimensions, Ads actions and goals, consent, build order |
| "Build the tracking plan" · "Add WhatsApp click tracking" | `gtm-build` | Variables, triggers and tags built and previewed one by one, published on your yes, checked live |
| "Ads shows 0 conversions but we got leads" | `tracking-audit` | Tag Manager → GA4 → Google Ads checked end to end, fixes handed to `gtm-build` |
| "Are we double counting?" · "Audit our events" | `event-audit` | Duplicates, dead tags, unregistered parameters and unused actions, with a fix list |
| "Check consent mode" | `consent-audit` | Consent settings on every tag, the Consent Mode v2 default, and a checklist for developers |

Step-by-step guide: **[docs/tracking.md](docs/tracking.md)**.

### Analyse and optimise

| Ask | You get |
|---|---|
| "Audit my Google Ads account" | A score out of 100 across measurement, location leaks, wasted search terms, structure, budgets and ad quality, with a prioritised fix list |
| "Why did cost per lead go up last week?" | What changed, which campaigns and segments caused it, checked against GA4 leads, and 2–3 actions |
| "Weekly check for acme" | Spend vs budget, new search terms to block, disapproved ads, anomalies, with proposed changes as previews |
| "Pause the brand campaign" · "Raise the budget to 150" · "Add these negatives" | A preview → your yes → applied, logged, reversible |

### Report

| Ask | You get |
|---|---|
| "Make the September report for acme" | A branded, self-contained HTML report (Ads, GA4, Search Console) you print to PDF |
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
| **14 skills** | Workflows that tell the agent what to check, in which order and what good looks like. Plan: `campaign-architect`. Build: `search-launch`, `demand-gen-launch`, `pre-launch-check`. Tracking: `tracking-plan`, `gtm-build`, `tracking-audit`, `event-audit`, `consent-audit`. Analyse: `ads-audit`, `performance-insights`, `weekly-check`. Report: `monthly-report`. Setup: `setup`. [docs/skills.md](docs/skills.md) |
| **63 tools** | Google Ads reporting and changes (29), GA4 (11), Search Console (6), Tag Manager (11), accounts and help (6). 37 are always available; the 26 that only change things load when an account allows changes. [docs/tools.md](docs/tools.md) |
| **Knowledge guide** | The `guide` tool serves hard-won notes: API traps, ad policy patterns, access levels, Demand Gen, measurement, Tag Manager, benchmarks |
| **CLI** | `init`, `doctor`, `accounts`, `call`: setup and scripting from your terminal |

Skills install with the Claude Code plugin. Other agents that support Agent Skills can load the [`skills/`](skills)
folder directly.

## Documentation

| Read this | When you want to |
|---|---|
| [Setup](docs/setup.md) | Go from nothing to a working connection, step by step |
| [Usage](docs/usage.md) | See what to ask for audits, reports, weekly checks and safe changes |
| [Tracking](docs/tracking.md) | Plan, build, publish and verify lead tracking in Tag Manager, GA4 and Google Ads |
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
