# Skills

The tools let an agent read and change your accounts. The skills tell it **what to do with them**: what to check, in
which order, what good looks like, and when to stop and ask you. They're written from running a real account, not
from the API docs.

Skills install with the Claude Code plugin. They use the portable Agent Skills format (`skills/<name>/SKILL.md`), so
other agents that support skills can load them too. They all need the MCP server.

You don't call skills by name. Ask in plain language and the matching skill loads.

## v1 (included)

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

## v2 (planned)

| Skill | What it will do |
|---|---|
| `campaign-architect` | Account structure: naming convention, one goal per campaign, budget split, shared negative lists |
| `search-launch` | RSA copy with length checks and policy-safe wording → build PAUSED → pre-launch check → launch |
| `demand-gen-launch` | Asset specs, audience, goal, channels → build PAUSED → pre-launch check → launch |
| `search-terms-mining` | New negatives and keywords from search terms |
| `optimize` | Bids, budgets and negatives within guardrails, logged and reversible |
| `tracking-audit` | Tag Manager tags → GA4 key events → Ads conversion actions, end to end |
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
