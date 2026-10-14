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
2. Tag Manager, published only after you see the changes;
3. GA4 key events;
4. Ads actions;
5. one custom goal per audience.

**You get:** the current-vs-target matrix, the applied changes and a verification checklist.

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
| `measurement` | Conversion goals, key events, reconciling Ads with GA4 |
| `benchmarks` | How to read CPC, CTR and CPL by campaign type |
