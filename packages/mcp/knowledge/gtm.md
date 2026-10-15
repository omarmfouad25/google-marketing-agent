# Google Tag Manager

Building, publishing and verifying tracking in a GTM web container safely.

- **Model:** workspace (draft) → version (snapshot) → publish (live). Nothing in the workspace reaches visitors until `gtm_publish`. Rollback = re-publish the previous version (`gtm_versions` lists them, `gtm_publish` with that `versionId`). Every write previews first; apply after a yes.
- **Which tool:** `gtm_build` for the 5 recipes below; `gtm_upsert` for anything else (custom HTML, community templates, other variable types). Before an upsert, copy the exact parameter keys from a similar existing entity with `gtm_get`: Google doesn't validate a create until it happens.
- **Update vs create:** `gtm_build` without `id` creates, with `id` updates (same recipe type only). Pre-flight blocks duplicate names, missing variables and missing trigger IDs, and nothing changes when it blocks.

## Recipes (`gtm_build` `recipe.kind`)
- **datalayer_variable** `{ name, key, defaultValue? }`: reads one data-layer key. One per parameter you want to send.
- **custom_event_trigger** `{ name, event, conditions? }`: fires on a data-layer event, optionally narrowed by conditions.
- **link_click_trigger** `{ name, match, conditions? }`: `match` is `"whatsapp"` (wa.me, api.whatsapp.com, whatsapp://), `"tel"`, `"mailto"`, `{ contains }` or `{ regex }`, tested on Click URL.
- **ga4_event_tag** `{ name, eventName, measurementId, params?, triggerIds, consent? }`: `params` maps GA4 parameter to value, e.g. `{ form_name: "{{DLV - form_name}}" }`; `measurementId` like `G-TEST123`.
- **ads_conversion_tag** `{ name, conversionId, conversionLabel, value?, currency?, triggerIds, consent? }`: `conversionId` is the digits after `AW-`. Get ID and label from `ads_create_conversion_action`.
- **conditions** entry: `{ "variable": "Page Path", "op": "matchRegex", "value": "^/business/", "negate": false }`. `op` is equals, contains, startsWith, endsWith or matchRegex; all entries must match (AND); `negate: true` = does NOT match.
- **consent**: `{ "required": ["ad_storage", "analytics_storage"] }` (also `ad_user_data`, `ad_personalization`). Omit for no consent requirement.

## Rules
- **Triggers:** fire on a data-layer event pushed on real success, never on visible text or toast messages (breaks silently when copy or language changes). Audience split = two triggers with the same path regex (`/business/`, `/consumer/`), one with `negate: true`.
- **Link triggers:** list every link variant per audience (e.g. `wa.me`, `api.whatsapp.com`, a footer link with another number such as `+15550100`). One substring misses the alternates.
- **Built-ins:** `{{Page Path}}`, `{{Click URL}}` etc. must be enabled (`gtm_builtin_variables`). The `gtm_build` pre-flight names the type to enable.
- **Pairs:** a GA4 event tag and its Ads conversion tag use the same `triggerIds`, or GA4 and Ads disagree.
- **GA4 parameters:** GA4 event tags don't forward data-layer fields. Map each one in `params`, and register it with `ga4_custom_dimensions` (`action: "create"`, `parameterName`, `displayName`) to report on it. Not retroactive: register before launch.
- **Cleanup:** pause junk (conversions on page views, events sent to the wrong hostname, duplicates) with `gtm_upsert` `paused: true` rather than delete. `gtm_delete` refuses anything still referenced.
- **Naming:** `DLV - <key>`, `CE - <event> - <audience>`, `Link - <channel> - <audience>`, `GA4 Event - <event>`, `Ads - <Audience> Lead - <channel>`.

## Publish checklist
1. `gtm_versions` with `versionId: "workspace"`: review added / removed / changed entities against the live version. Anything you didn't intend, fix first.
2. Note the live version ID (`gtm_overview` or `gtm_versions`) as the rollback target.
3. `gtm_publish` with a dated name, e.g. `2026-10-15 lead tracking`, after a yes.
4. `gtm_live_check` (checks conversion labels, GA4 event names and measurement IDs are in the served `gtm.js`). The CDN can lag a few minutes: re-run before calling it broken.
5. Prove firing in the browser (see the `measurement` topic).

## Limits
- No API for Preview/debug mode: use Tag Assistant in the browser.
- Server-side containers are not covered.
