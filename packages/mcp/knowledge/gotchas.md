# Google Ads API gotchas

Traps that silently waste money or fail with unclear errors. Check these before building or auditing.

- **Money fields without `_micros` are still micros**: `average_cpc`, `average_cpm`, `cost_per_conversion`. Every Ads tool, including `run_gaql_query`, already converts them (and drops the `_micros` suffix), so never divide again; only raw API output outside these tools is in micros.
- **Campaign-level conversion goals override account goals.** "Primary" on a conversion action is not enough. Check `campaign_conversion_goal.biddable`, or assign a custom goal (`conversion_goal_campaign_config`). A campaign can bid for weeks on an empty category.
- **API-created campaigns default to PRESENCE_OR_INTEREST** location targeting, which serves people merely interested in the location. Always set PRESENCE. Audit with `user_location_view` where `targeting_location = false`.
- **Demand Gen locations and languages go on the ad group**, not the campaign (campaign-level criteria fail with request_error UNKNOWN in API v23).
- **Demand Gen custom segments** (`custom_audience`) are not part of `GoogleAdsService.Mutate`; create them with the CustomAudienceService first, then the audience and ad group criteria in one batch.
- **Lookalike user lists** take `lookalike_user_list.seed_user_list_ids` (numeric IDs). Resource names in `seed_user_lists` fail with `TOO_FEW`.
- **GAQL has no LAST_90_DAYS.** Use `segments.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'`.
- **Conversion actions created with the UI "codeless" flow** (type WEBPAGE_CODELESS) can't be edited through the API (`MUTATE_NOT_ALLOWED`). Custom goals can still include them by ID.
- **RSA text can't be edited.** Create the new ad PAUSED, enable it, pause the old one. Learning resets.
- **DSA ad groups leak across audiences**: a DSA inside a B2B campaign can pull consumer traffic onto the B2B budget and goal. Audit DSA ad groups first.
- **Developer-token header**: tokens were sunset on 2026-09-09 and the value is ignored, but API v23 still rejects requests without the header. This package sends a placeholder, so you never need a token.
- **Explorer access can't use Keyword Planner** (it returns a permission error at Explorer level). Use search terms and keyword serving status as the demand signal.
