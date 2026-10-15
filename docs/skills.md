# Skills

The tools let an agent read and change your accounts. The skills tell it **what to do with them**: what to check, in
which order, what good looks like, and when to stop and ask you. They're written from running a real account, not
from the API docs.

Skills install with the Claude Code plugin. They use the portable Agent Skills format (`skills/<name>/SKILL.md`), so
other agents that support skills can load them too. They all need the MCP server.

You don't call skills by name. Ask in plain language and the matching skill loads.

## Analyse, report and set up

### `setup`

**Say:** "Set up google-marketing-agent", "Connect my Google Ads", "The doctor is red"

Walks through [setup.md](setup.md) one step at a time: Cloud project, APIs, OAuth client, `init`, permissions. After
each step it runs `setup_doctor` and only moves on when that step is green.

**You get:** a working profile, or an exact list of what's still missing and who has to grant it.

### `ads-audit`

**Say:** "Audit my Google Ads account", "What's wrong with acme's account?", "Health check before we take over this
client"

Checks, in order of the money they usually waste:

1. **Measurement:** what each campaign actually bids on (campaign-level goals override account goals), conversion
   actions recording, Ads conversions compared with GA4 lead events.
2. **Location leaks:** presence vs "presence or interest", and spend by user location outside the targets.
3. **Search terms:** spend on irrelevant queries, missing negatives, shared negative lists.
4. **Structure:** DSA or broad ad groups leaking traffic across audiences, campaigns competing for the same terms.
5. **Budgets and bidding:** limited by budget, learning status, CPC caps.
6. **Quality:** Quality Score components, ad strength, asset coverage, policy-limited ads.

**You get:** a scored report with findings, the money at stake, and a prioritised fix list. Each fix names the tool
that would apply it. The audit never changes anything.

### `performance-insights`

**Say:** "Why did cost per lead go up?", "What changed last week?", "How is Demand Gen doing?"

Compares two periods, finds the campaigns and segments behind the change (device, network, location, search terms,
placements), and reconciles Ads conversions with GA4 so "0 conversions" isn't mistaken for "no leads".

**You get:** a short brief with what changed, why, and the two or three actions worth taking.

### `pre-launch-check`

**Say:** "Is this campaign ready to launch?", "Check the new Demand Gen before I enable it"

Checks one campaign: goal and conversion actions, bidding, channels and networks, location type, languages,
audience (Demand Gen), assets per format, final URLs, ad approval status.

**You get:** a pass/fix table. If everything passes, it offers to launch, with the preview first.

### `weekly-check`

**Say:** "Weekly check", "Monday review for acme"

The control routine: spend against budget, CPL against target, new search terms to negate, disapproved or limited
ads, campaigns stuck in learning, anomalies against the previous four weeks.

**You get:** a one-page weekly note, plus proposed changes as previews.

### `monthly-report`

**Say:** "Monthly report for acme", "Make the September client report"

Pulls Ads, GA4 and Search Console for the month. Covers spend, results, cost per result, top campaigns, search
terms, landing pages, organic search, and what's planned next month. The profile's `brand` sets the logo and
colours.

**You get:** one self-contained HTML file. Print it to PDF from the browser.

## Plan and build (0.2)

### `campaign-architect`

**Say:** "Plan our Q4 campaigns", "How should I split the budget?", "Restructure this account"

Starts from the account's own last 30 and 90 days, not a blank sheet:
- Diagnosis: network split, spend outside targets, what each campaign bids on, search demand, GA4 leads by page.
- If measurement is broken, it sends you to `tracking-audit` first.
- Then the plan: campaign type per objective; one campaign per budget, goal and audience; a naming convention.
- Budget split by priority and expected lead value, with a check that each daily budget covers at least one target
  cost per lead.
- A bidding stage per campaign (maximize clicks with a cap → maximize conversions → target CPA), plus goals,
  shared negative lists by audience, standard settings and a transition plan.

**You get:** a plan document. Creating the goals and negative lists is optional, each one previewed. Campaigns are
built by the launch skills.

### `search-launch`

**Say:** "Build the Search campaign for <product>", "Write RSAs for <product>", "Create the campaigns from the plan"

1. Keywords: themed ad groups, exact and phrase match, using search terms and Search Console as demand evidence.
2. A copy document for your approval: 15 headlines and 4 descriptions per ad group with character counts, sitelinks
   and callouts, policy-safe and natively written per language.
3. The build, **paused**, previewed step by step: campaign, ad groups with keywords, ads, extensions, custom goal,
   negatives.
4. Resumable if a step fails. Then `pre-launch-check`, then launch.

**You get:** the approved copy, a build log with IDs and change IDs, the pre-launch table.

### `demand-gen-launch`

**Say:** "Build Demand Gen for <product>", "Upload these images as a Demand Gen campaign", "Refresh the Demand Gen
creative", "How is the new Demand Gen doing?"

1. An image check per file: sizes and ratios, no painted buttons or fake UI, text in clean areas, real logos.
2. Copy per language. The campaign on its own custom goal, and one ad group per language.
3. An audience from your customer list, a lookalike, a custom segment of search terms and competitor sites, and
   matching visitor lists. Everything **paused** until `pre-launch-check` passes.
4. Later: a day 3 / week 1 read (channel split, engaged sessions, cost per lead) and creative refreshes.

**You get:** the image check, a build log, the pre-launch table, and the first-week read on request.

### `tracking-audit`

**Say:** "Are my conversions right?", "Ads shows 0 conversions but we got leads", "Set up lead tracking"

Checks Tag Manager tags and triggers, GA4 key events, Google Ads conversion actions and what each campaign bids on.
Reconciles them with GA4 lead events and proposes a matrix where every lead is counted once, by audience. Then it
fixes in a safe order, each step previewed:
1. data layer events on the site;
2. Tag Manager: hands the variables, triggers and tags to `gtm-build`, published only after you see the changes;
3. GA4 key events;
4. Ads actions (new ones with `ads_create_conversion_action`);
5. one custom goal per audience.

It's the diagnostic entry point. For a full plan it sends you to `tracking-plan`; for the build, to `gtm-build`.

**You get:** the current-vs-target matrix, the applied changes and a verification checklist.

## Measurement (0.3)

The flow is **`tracking-plan` → `gtm-build` → `event-audit`**, with `tracking-audit` as the way in when something is
already broken and `consent-audit` for consent. Walkthrough with examples: [tracking.md](tracking.md).

### `tracking-plan`

**Say:** "Set up tracking", "What should we track?", "Tracking plan for acme.com", "We're launching a new site"

1. One interview: what a lead is worth, lead types, how pages separate audiences (`/business/` vs `/consumer/`),
   contact channels (forms, messaging and `tel:` links, booking widgets), consent regions, who implements the site.
2. Reads what exists so nothing is duplicated: `gtm_overview`, `gtm_list`, `ga4_list_key_events`,
   `ga4_custom_dimensions`, Ads conversion actions and goals (`run_gaql_query`).
3. Writes the plan. Nothing is changed.

**You get:** one plan document: event matrix, a copy-ready data-layer contract for developers (pushed only when the
server confirms the lead; `value` and `currency` only when the site knows a real value), custom dimensions to
register, Ads actions and goals, consent per tag, naming, and the build order for `gtm-build`.

### `gtm-build`

**Say:** "Build the tracking", "Implement the tracking plan", "Create the triggers and tags", "Add WhatsApp click
tracking", "Track phone clicks"

1. Baseline: notes the live version as the rollback target, stops on unexplained unpublished changes, and checks for
   a Conversion Linker (proposes one with `gtm_upsert` when Ads conversion tags need it).
2. Prerequisites: built-ins (`gtm_builtin_variables`), custom dimensions (`ga4_custom_dimensions`), new Ads actions
   (`ads_create_conversion_action`, which prints the ID and label).
3. Builds with `gtm_build`, each previewed: data-layer variables → triggers (audience split with one regex, negated
   on the twin) → GA4 event tags (every parameter mapped) → Ads conversion tags on the same triggers → consent.
   Ads tags send `value`/`currency` only when the site pushes a real value; otherwise the action's default applies.
4. Pauses junk tags (`gtm_upsert`); deletes (`gtm_delete`) only when you ask.
5. Shows the full workspace diff (`gtm_versions`), publishes on your yes (`gtm_publish`), runs `gtm_live_check`, then
   marks key events (`ga4_set_key_event`) once events fire.

**You get:** a build log with every ID and change ID, the approved diff, the published and rollback versions, the
live check and a test matrix to run.

### `event-audit`

**Say:** "Audit our events", "Are we double counting?", "GA4 events are a mess", "Clean up our conversions"

Read-only. Checks:
- **Tag Manager:** tags with no trigger, duplicates on one trigger, conversions on page views, text triggers, GA4/Ads
  pairs with different triggers, missing variables, missing Conversion Linker, constant `0` values, consent not set.
- **GA4** (`ga4_custom_report`, 30 days ending 3 days ago): unused key events, events that never arrive, near-duplicate
  names, parameters not registered as custom dimensions.
- **Google Ads:** actions without conversions, primary page-view actions, actions nothing bids on.
- A like-for-like cross-check: GA4 leads from `google / cpc` against Ads conversions.

**You get:** a findings table (severity, evidence, fix tool) and a fix list for `gtm-build`.

### `consent-audit`

**Say:** "Check consent mode", "Are tags respecting consent?", "GDPR cookie banner check", "Consent Mode v2"

1. Classifies every tag (`gtm_list`, `gtm_get`): ads, analytics or vendor pixel, with its consent settings.
2. Looks for a Consent Mode v2 default on Consent Initialization covering `ad_storage`, `analytics_storage`,
   `ad_user_data` and `ad_personalization`, denied in opt-in regions.
3. Fixes, each previewed: `gtm_build` (recipe tags) or `gtm_upsert` (others), then the same review, publish and live
   check as `gtm-build`.

**You get:** the tag inventory, the default check, findings and fixes, and a checklist for your developers (default
before any tag, region logic that fails closed, no `<noscript>` pixels). A technical check, not legal advice.

## Planned

| Skill | What it will do |
|---|---|
| `search-terms-mining` | New negatives and keywords from search terms, by audience |
| `optimize` | Stage-based bidding switches, budget shifts within guardrails, country splits; logged and reversible |
| `search-console-audit` | Cannibalisation, CTR gaps, index coverage, sitemaps |

## Knowledge the skills share

Skills don't copy expertise into their own files. They call the `guide` tool, which serves topics from the MCP
package. That way the same knowledge is available in any MCP client, even without skills.

| Topic | Covers |
|---|---|
| `gotchas` | Google Ads API traps that silently waste money or fail with unclear errors |
| `policy` | Common disapprovals and how to rewrite around them |
| `access` | API access levels, OAuth token expiry, service accounts |
| `demand-gen` | Asset specs, audiences, channels, reading the first week |
| `measurement` | Conversion goals, key events, reconciling Ads with GA4, success signals, consent, live tests |
| `gtm` | Tag Manager recipes, naming, Conversion Linker, publish checklist, rollback |
| `benchmarks` | How to read CPC, CTR and CPL by campaign type |
