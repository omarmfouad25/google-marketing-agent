# Usage

What to ask, what you get back, and how changes work. Everything here is plain language: you don't call tools or
skills by name.

- [Everyday workflows](#everyday-workflows)
- [Planning and building campaigns](#planning-and-building-campaigns)
- [Tracking](#tracking)
- [Making changes safely](#making-changes-safely)
- [Working with several accounts](#working-with-several-accounts)
- [Reports](#reports)
- [Asking good questions](#asking-good-questions)
- [Using the tools directly](#using-the-tools-directly)

## Everyday workflows

| When | Ask | Skill | You get |
|---|---|---|---|
| Planning a quarter or a restructure | "Plan our Q4 campaigns with a budget of 12,000 a month" | `campaign-architect` | A plan from your own data: campaigns, types, names, budget split, bidding stages, goals, negative lists |
| Building a Search campaign | "Build the Search campaign for <product> from the plan" | `search-launch` | Keywords and ad copy to approve, then a paused build, pre-launch check and launch preview |
| Building Demand Gen | "Launch Demand Gen for <product> with the images in ./creative" | `demand-gen-launch` | Image check, one ad group per language, audience, paused build, pre-launch check |
| Leads don't add up | "Ads shows 0 conversions but we got leads" | `tracking-audit` | Tag Manager → GA4 → Ads checked and fixed, so every lead counts once |
| New site or new lead types | "Plan lead tracking for acme.com" | `tracking-plan` | Event matrix, data-layer code for developers, custom dimensions, Ads actions, consent, build order |
| Plan approved | "Build the tracking plan" | `gtm-build` | Variables, triggers and tags previewed one by one, published on your yes, checked live |
| Taking over or reviewing an account | "Audit my Google Ads account for the last 30 days" | `ads-audit` | Score out of 100 across six areas, findings with the money at stake, a fix list naming the tool that applies each fix |
| Something moved | "Why did cost per lead go up last week?" | `performance-insights` | Week vs previous week, the campaigns and segments behind it, a GA4 cross-check, 2–3 actions |
| Every Monday | "Weekly check for acme" | `weekly-check` | One-page note: spend vs budget, new search terms to block, disapproved ads, campaigns in learning, anomalies, and proposed changes as previews |
| Before turning a campaign on | "Is the new Demand Gen campaign ready to launch?" | `pre-launch-check` | Pass/fix table (goal, bidding, channels, locations, audience, assets, approvals); a launch preview if everything passes |
| End of month | "Monthly report for acme, September" | `monthly-report` | A branded HTML file in `reports/` to print to PDF |
| Something isn't connected | "The doctor is red" · "Add GA4 for acme" | `setup` | Step-by-step fix, re-checked after each step |

Plain questions work too, without a skill:

- "Top 20 search terms by cost this month, and which ones have no conversions"
- "Which landing pages had the most GA4 key events last week?"
- "Which queries bring clicks to /pricing in Search Console?"
- "Is the lead form tag in Tag Manager published?"
- "Run this GAQL: SELECT campaign.name, metrics.cost_micros FROM campaign WHERE segments.date DURING LAST_7_DAYS"

## Planning and building campaigns

The build skills follow one order, and each step ends with something for you to approve:

1. **Measure first.** *"Are my conversions right?"* (`tracking-audit`). Campaigns that bid on broken conversions
   learn the wrong thing, so this comes before any build.
2. **Plan.** *"Plan our campaigns for next quarter."* (`campaign-architect`). It reads the last 30 and 90 days, asks
   for your tracks, focus products, markets, languages and monthly budget, and returns a plan you approve.
3. **Copy.** *"Build the Search campaign for <product>."* (`search-launch`) or *"…Demand Gen…"*
   (`demand-gen-launch`). You approve every headline, description and image before anything is created.
4. **Build, paused.** Each step is previewed; nothing serves yet.
5. **Check and launch.** `pre-launch-check` runs on every new campaign; you confirm the launch.
6. **Review on a rhythm:**
   - launch day: approvals;
   - week 1: search terms, locations, cost per lead in Ads and GA4;
   - week 3: switch bidding from clicks to conversions where there are about 15+ conversions in 30 days;
   - then `weekly-check` every Monday.

Budget rules the planner applies:
- every daily budget covers at least one target cost per lead, ideally 2–3;
- brand campaigns stay small;
- countries share a campaign until their cost per lead differs by more than about 50%;
- budget moves stay within the 50% guardrail.

## Tracking

Plan → build → publish → verify. Each Tag Manager change is a workspace edit until you approve the publish.

| Ask | What happens |
|---|---|
| "Plan lead tracking for acme.com: forms and WhatsApp, business and consumer" | `tracking-plan` interviews you once and writes the plan, including the `dataLayer.push` code for your developers |
| "Build the tracking plan" | `gtm-build` previews each variable, trigger and tag, then shows the workspace diff before publishing |
| "Add tel: click tracking on the /consumer/ pages as an Ads lead" | One trigger, a GA4 tag and an Ads tag on the same trigger, plus the conversion action if it's missing |
| "Check the container is live" | `gtm_live_check`: every label and event name found in the `gtm.js` visitors get |
| "What changed in Tag Manager since version 12?" | `gtm_versions`: tags, triggers and variables added, removed and changed |
| "Are we double counting?" · "Check consent mode" | `event-audit` · `consent-audit`: findings with evidence and a fix list |

Full walkthrough, recipe reference, test matrix and undo: [tracking.md](tracking.md).

## Making changes safely

Changes need an account that allows them (`npx google-marketing-agent accounts set <alias> writes true`, then restart
your AI app). Every change then goes through the same three steps.

**1. Preview.** The agent sends the change to Google in check-only mode. Google validates it in full; nothing changes.

```text
You:    Add "free", "jobs" and "diy" as negatives on the Brand campaign.
Agent:  DRY RUN OK (nothing changed)
        Add 3 negative keyword(s) to campaign 12345678901:
        - [PHRASE] free
        - [PHRASE] jobs
        - [PHRASE] diy
        Google validated 3 operation(s). Apply?
```

**2. Apply on your yes.**

```text
You:    Yes.
Agent:  APPLIED (changeId: 3f9c2a1b)
        Revert with ads_rollback { changeId: "3f9c2a1b" }.
```

**3. Undo if needed.**

```text
You:    Undo that last change.
Agent:  DRY RUN OK (nothing changed)
        Rollback of 3f9c2a1b (ads_add_negative_keywords: …): 3 operation(s). Apply?
You:    Yes.
```

Ask *"What changed on acme this week?"* to see the change log (`changes_list`).

What to expect:

- New campaigns and ads are always created **paused**. Going live is a separate change you confirm.
- A budget change larger than 50% (or your profile's limit) is refused unless you explicitly ask to override it.
- On a read-only account the agent tells you how to allow changes; it never works around it.
- Undo restores the values from the time of the change, overwriting anything edited since. Tag Manager and GA4 changes
  aren't undone automatically: re-publish an earlier Tag Manager version instead ([tracking.md](tracking.md#undo)).

Full details: [safety.md](safety.md).

## Working with several accounts

Each account you added in `init` is a profile with a short name (alias).

- Name the account in your question: *"Weekly check for globex"*, *"Audit acme and globex"*.
- Switch the default for the conversation: *"Switch to globex"*.
- See everything your login can reach: *"Which accounts can you see?"*
- See one account's settings (currency, linked properties, whether changes are allowed): *"Show acme's profile"*.

Agencies typically allow changes only on the clients they manage day to day and keep the rest read-only.
More: [profiles.md](profiles.md).

## Reports

*"Monthly report for acme"* builds last month's report; name a month for another one. The file is saved as
`reports/<alias>-<YYYY-MM>.html` in the folder your AI app is working in.

- **Branding** comes from the profile's `brand` (name, logo file, two colours); without it the report uses a neutral
  theme. See [profiles.md](profiles.md#fields).
- **Sections** for GA4 and Search Console appear only when the profile has them; otherwise the report says
  "not connected" instead of guessing.
- **PDF:** open the file in a browser → Print → Save as PDF. The layout is set up for A4.
- Add your own commentary: *"…and add this summary: …"* or *"…with next month's plan: …"*.

## Asking good questions

- **Name the period.** "last 30 days", "September", "1–14 October vs the two weeks before".
- **Name the account** when you have more than one.
- **Say what matters**: "we care about form leads, not calls", "target cost per lead is 40".
- **Ask for evidence** when something sounds off: "show me the search terms behind that".
- **One change at a time** while you build trust: review the preview, then confirm.

## Using the tools directly

Every tool also runs from your terminal, which is handy for scripts and scheduled checks:

```bash
echo '{ "dateRange": "LAST_7_DAYS" }' > args.json
npx google-marketing-agent call get_campaign_performance args.json
```

Tool names and parameters: [tools.md](tools.md). Changes run from the terminal follow the same rules: they are
previews unless the arguments include `"confirm": true`.
