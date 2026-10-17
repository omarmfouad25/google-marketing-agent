# Tools reference

63 tools across Google Ads, GA4, Search Console and Tag Manager (37 while every profile has writes off; the write tools, including `rollback`, register only when a profile has `writes: true`). `gtm_builtin_variables` and `ga4_custom_dimensions` are always available: they list on any profile, and their enable/create/archive actions need writes. Every tool except setup_doctor, guide, accounts_list and use_profile takes an optional `profile` (profile
alias; see [profiles.md](profiles.md)). Date-range tools default to the last 30 days. Money is in the account
currency (micros conversion is done for you).

`setup_doctor`, `guide`, `accounts_list` and `use_profile` work with zero profiles and take no `profile` param; `changes_list` and `get_profile` are always available.

**Legend:** 📖 read · ✏️ write: without `confirm` it returns a Preview and a Preview ID; call again with the same arguments and `confirm: "<Preview ID>"` to apply (valid 15 minutes, once). Needs a profile with `writes: true`, and only changes what the profile lists
(see [safety.md](safety.md)) · 📖✏️ reads on any profile, writes like ✏️

For the tracking workflow these tools serve, see [tracking.md](tracking.md).

## Setup and accounts

| Tool | | What it does |
|---|---|---|
| `setup_doctor` | 📖 | Tests OAuth, each API, the Ads access level and every profile; returns the exact fix for each failure |
| `accounts_list` | 📖 | Every Google Ads account your login can reach (including MCC children), marking those with profiles |
| `use_profile` | 📖 | Switch the default profile for this session |
| `guide` | 📖 | Expert knowledge by topic: `gotchas`, `policy`, `access`, `demand-gen`, `measurement`, `gtm`, `benchmarks` |
| `changes_list` | 📖 | Recent applied changes for a profile, from the change log, with how each was confirmed |
| `get_profile` | 📖 | The resolved profile: currency, timezone, geos, writes, human-approval setting, guardrails, brand, linked GA4/GSC/GTM |
| `rollback` | ✏️ | Roll back one change-log entry in any product: Ads prior values and created resources, Tag Manager publishes, GA4 key events. Refuses Drift unless `acceptDrift: true` |

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
| `ads_create_conversion_action` | ✏️ | New website conversion action (lead form, contact click…); prints the conversion ID and label for `gtm_build` |
| `ads_set_conversion_primary` | ✏️ | Make conversion actions primary (bidding) or secondary (reporting only) |
| `ads_update_conversion_action` | ✏️ | Rename, re-categorise, change counting (one / many per click) or the primary flag |
| `ads_create_custom_goal` | ✏️ | Custom goal from specific conversion actions |
| `ads_assign_custom_goal` | ✏️ | Make a campaign bid on a custom goal |
| `ads_set_campaign_goals` | ✏️ | Choose which conversion categories a campaign bids on |

> Campaign-level goals override account defaults. A campaign can bid on an empty category even when the right
> conversion action is "primary". `ads-audit` checks this.

#### `ads_create_conversion_action`

Creates an enabled website (`WEBPAGE`) conversion action. Refused if an action with the same name exists. Once
applied, it prints the `conversionId` and `conversionLabel` for the `ads_conversion_tag` recipe. `rollback`
removes it. A primary action (the default) starts counting in bidding for every campaign that bids on its goal
category; pass `primary: false` to stage it as secondary until the tag is verified.

| Param | Required | Notes |
|---|---|---|
| `name` | yes | Up to 100 characters, no quotes, backslashes, newlines or control characters |
| `category` | yes | `SUBMIT_LEAD_FORM`, `CONTACT`, `PHONE_CALL_LEAD`, `BOOK_APPOINTMENT`, `REQUEST_QUOTE`, `SIGNUP`, `OUTBOUND_CLICK`, `PURCHASE`, `PAGE_VIEW`, `DEFAULT` |
| `countingType` | | `ONE_PER_CLICK` (default, right for leads) or `MANY_PER_CLICK` (purchases) |
| `value` | | Default value per conversion, used when the tag sends none |
| `currency` | | Three letters; defaults to the profile currency |
| `primary` | | Default `true`: counts in bidding for campaigns using its goal category. `false` stages it as secondary |
| `clickThroughWindowDays` | | 1–90, default 30 |

```json
{ "name": "Ads - Business Lead - Form", "category": "SUBMIT_LEAD_FORM" }
```

```text
APPLIED (changeId: 7d1e40aa)
…
For gtm_build ads_conversion_tag: conversionId "123456789", conversionLabel "AbC-dEf_1"
```

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
| `ga4_custom_dimensions` | 📖✏️ | List custom dimensions and metrics; register an event parameter as a custom dimension; archive one |

### `ga4_custom_dimensions`

Event parameters (`form_name`, `lead_type`) only show in GA4 reports once registered. Registration isn't
retroactive: do it before launch. Archiving is permanent.

| Param | Required | Notes |
|---|---|---|
| `action` | yes | `list`, `create` or `archive` |
| `parameterName` | for create | The event parameter (or user property) name, e.g. `form_name` |
| `displayName` | for create | Shown in GA4 reports, e.g. `Form name` |
| `scope` | | `EVENT` (default) or `USER` |
| `description` | | Up to 150 characters |
| `name` | for archive | `properties/123456789/customDimensions/4`, from `list` |

```json
{ "action": "create", "parameterName": "form_name", "displayName": "Form name" }
```

Preview: `CREATE EVENT custom dimension "Form name" (form_name) (nothing changed)`. A parameter already registered in
that scope is refused.

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

Changes go into a workspace and are not live until `gtm_publish`. Tag Manager tools take an optional
`container` (`GTM-XXXX`, default: the profile's `gtmContainerId`) and `workspaceId` (default: the first workspace) where they apply.

| Tool | | What it does |
|---|---|---|
| `gtm_list_containers` | 📖 | Accounts and containers your login can see |
| `gtm_overview` | 📖 | Live version, workspaces, unpublished changes |
| `gtm_list` | 📖 | Tags, triggers or variables (compact) |
| `gtm_get` | 📖 | Full JSON of one tag, trigger or variable |
| `gtm_versions` | 📖 | List versions, or diff two of them (or the workspace against live) by name |
| `gtm_live_check` | 📖 | Check the live `gtm.js` visitors receive contains the expected labels and event names |
| `gtm_builtin_variables` | 📖✏️ | List enabled built-in variables; enable or disable some |
| `gtm_build` | ✏️ | Create or update a variable, trigger or tag from a typed recipe, with pre-flight checks |
| `gtm_upsert` | ✏️ | Create or update (shallow merge) a tag, trigger or variable |
| `gtm_delete` | ✏️ | Delete one tag, trigger or variable; refused while anything references it |
| `gtm_publish` | ✏️ | Publish the workspace, or re-publish an older version. `rollback` with a publish's change ID re-publishes the version before it |

### `gtm_build`

Builds from a recipe instead of hand-written API JSON. Recipes: `datalayer_variable`, `custom_event_trigger`,
`link_click_trigger`, `ga4_event_tag`, `ads_conversion_tag` (fields and the exact resources they create:
[tracking.md](tracking.md#recipe-reference)). Before anything changes, a pre-flight checks that the name is new,
every `{{variable}}` exists or is an enabled built-in, and every trigger ID exists. Any problem returns
`NOT BUILT (nothing changed)` with the fix per line. Anything outside the recipes goes through `gtm_upsert`.

| Param | Required | Notes |
|---|---|---|
| `recipe` | yes | `{ kind, name, … }` |
| `id` | | Update this existing entity instead of creating; it must be the type the recipe builds. An update replaces the entity's parameters, triggers and consent with the recipe's: settings the recipe doesn't model are removed (the preview lists them as `removedSettings`). For partial edits, such as consent only, use `gtm_upsert` |
| `confirm` | | The Preview ID to apply; omitted = Preview |

```json
{ "recipe": { "kind": "link_click_trigger", "name": "Link - WhatsApp - Business", "match": "whatsapp",
  "conditions": [{ "variable": "Page Path", "op": "matchRegex", "value": "^/business/" }] } }
```

### `gtm_versions`

| Param | Required | Notes |
|---|---|---|
| `versionId` | | Omitted: list versions (newest first, live marked). A number: diff it against the previous version. `"workspace"`: diff unpublished changes against live (against nothing if the container was never published) |
| `compareTo` | | Older version to compare against instead |

```json
{ "versionId": "workspace" }
```

Returns `added`, `removed` and `changed` (with before/after per field) for tags, triggers and variables.

### `gtm_live_check`

Downloads `https://www.googletagmanager.com/gtm.js?id=<container>` and reports which expected strings are `found` and
`missing`. By default it expects every conversion label, GA4 event name and measurement ID of the live version's
active tags (paused tags and `{{variable}}` values are skipped). Run it right after `gtm_publish`; the CDN can lag a few
minutes.

| Param | Required | Notes |
|---|---|---|
| `expect` | | Strings to look for instead of the default |

```json
{ "expect": ["AbC-dEf_1", "generate_lead"] }
```

### `gtm_builtin_variables`

Recipes that reference `{{Page Path}}` or `{{Click URL}}` need those built-ins enabled.

| Param | Required | Notes |
|---|---|---|
| `action` | yes | `list` (enabled built-ins plus the display name → type map), `enable` or `disable` |
| `types` | for enable/disable | Built-in types, e.g. `["pagePath", "clickUrl"]` |
| `confirm` | | The Preview ID to apply; omitted = Preview |

```json
{ "action": "enable", "types": ["pagePath", "clickUrl"] }
```

### `gtm_delete`

Deletes from the workspace (not live until `gtm_publish`). Refused while a tag fires on the trigger, or any tag,
trigger or variable uses the variable. To keep a tag for later, pause it instead (`gtm_upsert` with
`resource: { paused: true }`).

| Param | Required | Notes |
|---|---|---|
| `entity` | yes | `tags`, `triggers` or `variables` |
| `id` | yes | From `gtm_list` |
| `confirm` | | The Preview ID to apply; omitted = Preview |

```json
{ "entity": "tags", "id": "12" }
```

## Calling a tool outside an agent

Any tool can be run from the command line with a JSON file of arguments. This is useful for scripts and for testing
before an MCP restart:

```bash
npx google-marketing-agent call get_campaign_performance args.json
npx google-marketing-agent call ads_set_status pause.json
```
