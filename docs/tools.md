# Tools reference

56 tools across Google Ads, GA4, Search Console and Tag Manager (33 while every profile has writes off; the write tools, including `ads_rollback`, register only when a profile has `writes: true`). Every tool except setup_doctor, guide, accounts_list and use_account takes an optional `account` (profile
alias; see [profiles.md](profiles.md)). Date-range tools default to the last 30 days. Money is in the account
currency (micros conversion is done for you).

`setup_doctor`, `guide`, `accounts_list` and `use_account` work with zero profiles and take no `account` param; `changes_list` and `account_profile` are always available.

**Legend:** 📖 read · ✏️ write: preview unless `confirm: true`, needs a profile with `writes: true`
(see [safety.md](safety.md))

## Setup and accounts

| Tool | | What it does |
|---|---|---|
| `setup_doctor` | 📖 | Tests OAuth, each API, the Ads access level and every profile; returns the exact fix for each failure |
| `accounts_list` | 📖 | Every Google Ads account your login can reach (including MCC children), marking those with profiles |
| `use_account` | 📖 | Switch the default account for this session |
| `guide` | 📖 | Expert knowledge by topic: `gotchas`, `policy`, `access`, `demand-gen`, `measurement`, `benchmarks` |
| `changes_list` | 📖 | Recent applied changes for an account, from the change log |
| `account_profile` | 📖 | The resolved profile: currency, timezone, geos, writes, guardrails, brand, linked GA4/GSC/GTM |

## Google Ads: reporting

| Tool | | What it does |
|---|---|---|
| `get_account_summary` | 📖 | Account-level impressions, clicks, cost, conversions, ROAS |
| `get_campaign_performance` | 📖 | Every campaign (or by status): impressions, clicks, CTR, CPC, cost, conversions |
| `get_adgroup_performance` | 📖 | Ad groups, optionally by campaign or status |
| `get_keyword_performance` | 📖 | Keywords with Quality Score, match type and performance |
| `get_search_terms` | 📖 | The real searches that triggered your ads, with performance |
| `get_performance_by_date` | 📖 | Daily trend |
| `get_campaign_budgets` | 📖 | Budgets and spend for active campaigns |
| `run_gaql_query` | 📖 | Any [GAQL](https://developers.google.com/google-ads/api/docs/query/overview) query, as a table or JSON |

## Google Ads: changes

### Status, budgets, bids

| Tool | | What it does |
|---|---|---|
| `ads_set_status` | ✏️ | Pause or enable campaigns, ad groups, ads or keywords (ads/keywords as `adGroupId~id`) |
| `ads_update_budget` | ✏️ | Daily budget; refused above the profile's `maxBudgetChangePct` unless `allowLargeChange` |
| `ads_update_cpc_bid` | ✏️ | Max CPC on an ad group or keyword (manual CPC campaigns) |
| `ads_update_networks` | ✏️ | Search Partners / Display expansion on or off; location targeting to presence only |
| `ads_rollback` | ✏️ | Revert one change-log entry: restore prior values, remove what it created (`changes_list` shows IDs) |

### Keywords and negatives

| Tool | | What it does |
|---|---|---|
| `ads_add_keywords` | ✏️ | Keywords into an ad group (exact, phrase, broad) |
| `ads_add_negative_keywords` | ✏️ | Campaign-level negatives |
| `ads_negative_list` | ✏️ | Create or extend a shared negative keyword list and attach it to campaigns |

### Search campaigns

| Tool | | What it does |
|---|---|---|
| `ads_create_search_campaign` | ✏️ | Budget + campaign (always PAUSED) + presence-only geo + languages, Google Search only. Max conversions, Max clicks (optional CPC cap) or manual CPC |
| `ads_create_ad_group` | ✏️ | Search ad group with optional keywords |
| `ads_create_rsa` | ✏️ | Responsive search ad (always PAUSED): 3–15 headlines ≤30 chars, 2–4 descriptions ≤90 chars |
| `ads_add_extensions` | ✏️ | Sitelinks and callouts on a campaign |

### Demand Gen

| Tool | | What it does |
|---|---|---|
| `ads_create_demand_gen_campaign` | ✏️ | Demand Gen campaign (always PAUSED), own budget, presence-only |
| `ads_create_demand_gen_ad` | ✏️ | Ad group (locations + languages are set per ad group in Demand Gen) + multi-asset image ad (PAUSED) from local JPG/PNG files: landscape 1.91:1, square 1:1, portrait 4:5, logo 1:1 |
| `ads_demand_gen_audience` | ✏️ | Audience from user lists + a new lookalike + a new custom segment (search terms, URLs), attached to ad groups |

### Conversion goals

| Tool | | What it does |
|---|---|---|
| `ads_set_conversion_primary` | ✏️ | Make conversion actions primary (bidding) or secondary (reporting only) |
| `ads_update_conversion_action` | ✏️ | Rename, re-categorise, change counting (one / many per click) or the primary flag |
| `ads_create_custom_goal` | ✏️ | Custom goal from specific conversion actions |
| `ads_assign_custom_goal` | ✏️ | Make a campaign bid on a custom goal |
| `ads_set_campaign_goals` | ✏️ | Choose which conversion categories a campaign bids on |

> Campaign-level goals override account defaults. A campaign can bid on an empty category even when the right
> conversion action is "primary". `ads-audit` checks this.

## GA4

| Tool | | What it does |
|---|---|---|
| `ga4_traffic_overview` | 📖 | Daily sessions, users, pageviews, bounce and engagement rate, session duration |
| `ga4_top_pages` | 📖 | Top pages by views, with engagement |
| `ga4_traffic_sources` | 📖 | Source / medium with sessions, users, conversions |
| `ga4_user_demographics` | 📖 | By country, city, device or browser |
| `ga4_conversions` | 📖 | Conversion (key) events and counts |
| `ga4_landing_pages` | 📖 | Entry pages with bounce, engagement, conversions |
| `ga4_realtime` | 📖 | Active users and pages right now |
| `ga4_custom_report` | 📖 | Any dimensions and metrics |
| `ga4_list_key_events` | 📖 | Key events on the property, plus linked Google Ads accounts |
| `ga4_set_key_event` | ✏️ | Mark or unmark an event as a key event |

## Search Console

| Tool | | What it does |
|---|---|---|
| `gsc_search_analytics` | 📖 | Clicks, impressions, CTR, position by query, page, country, device, date or search appearance, with filters |
| `gsc_top_queries` | 📖 | Top queries by clicks |
| `gsc_top_pages` | 📖 | Top pages by organic clicks |
| `gsc_query_page_matrix` | 📖 | Which queries drive which pages (content gaps, cannibalisation) |
| `gsc_index_status` | 📖 | URL inspection: index status, crawl, mobile usability, rich results |
| `gsc_sitemaps` | 📖 | Submitted sitemaps with status, errors, warnings |

## Tag Manager

Changes go into a workspace and are not live until `gtm_publish`.

| Tool | | What it does |
|---|---|---|
| `gtm_list_containers` | 📖 | Accounts and containers your login can see |
| `gtm_overview` | 📖 | Live version, workspaces, unpublished changes |
| `gtm_list` | 📖 | Tags, triggers or variables (compact) |
| `gtm_get` | 📖 | Full JSON of one tag, trigger or variable |
| `gtm_upsert` | ✏️ | Create or update (shallow merge) a tag, trigger or variable |
| `gtm_publish` | ✏️ | Publish the workspace, or re-publish an older version (rollback) |

## Calling a tool outside an agent

Any tool can be run from the command line with a JSON file of arguments. This is useful for scripts and for testing
before an MCP restart:

```bash
npx google-marketing-agent call get_campaign_performance args.json
npx google-marketing-agent call ads_set_status pause.json
```
