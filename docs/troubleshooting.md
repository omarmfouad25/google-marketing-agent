# Troubleshooting

Start with `npx google-marketing-agent doctor` (or ask the agent to run `setup_doctor`). It names the failing part
and the fix. This page covers what it can't fix for you.

## Sign-in and tokens

| Symptom | Cause | Fix |
|---|---|---|
| `invalid_grant` after about a week | OAuth app is External and in **Testing**, so refresh tokens expire after 7 days | Set the app to **In production** (the only option for personal Gmail accounts), or use an Internal app if you are in a Google Workspace organisation ([setup 1.4](setup.md#14-configure-the-oauth-consent-screen)), then run `init` again |
| `invalid_grant` right away | Token revoked, or password changed | Run `init` again |
| Sign-in asks you to create a passkey and you can't | Google requires extra verification for Tag Manager / GA4 Admin scopes on some accounts | Use the [service account route](setup.md#alternative-service-account-for-tag-manager-and-ga4-admin) for those products |
| `redirect_uri_mismatch` | OAuth client isn't a **Desktop app** | Create a Desktop app client and run `init` again |

## Google Ads

| Symptom | Cause | Fix |
|---|---|---|
| `USER_PERMISSION_DENIED` | Login can't reach the account, or `loginCustomerId` is missing for an MCC child | Add the manager ID as `loginCustomerId` in the profile, or get access to the account |
| Only test accounts visible, or production calls refused | Cloud project is at **Test** level, or the OAuth client is in a different project from the one granted access | Apply for Explorer on the Google Ads API Overview page of the project that owns the OAuth client ([setup 1.3](setup.md#13-get-google-ads-api-access-explorer)) |
| Keyword Planner returns a permission error at Explorer level | Keyword Planner needs **Basic** access (planning services aren't in Explorer) | Apply for Basic (needs brand verification), or use search terms and keyword status as the demand signal |
| `CUSTOMER_NOT_ENABLED` | Account is cancelled or not set up | Check the account in Google Ads |
| Writes refused: "profile is read-only" | `writes` is false | [safety.md](safety.md), then `accounts set <alias> writes true` and restart the client |
| Budget change refused | Change is above `maxBudgetChangePct` | Smaller steps, or `allowLargeChange: true` if it's intended |
| `MUTATE_NOT_ALLOWED` on a conversion action | Actions created with the Ads UI "codeless" flow can't be edited through the API | Edit it in the Ads UI. Custom goals can still include it by ID |
| GAQL error about `LAST_90_DAYS` | GAQL has no such range | `segments.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'` |
| Cost looks a million times too high in raw GAQL | Money fields are in micros, including ones without `_micros` in the name (`average_cpc`, `cost_per_conversion`) | Divide by 1,000,000. The `get_*` tools do it for you |

## Campaign behaviour

| Symptom | Cause | Fix |
|---|---|---|
| Spend from countries you don't target | Location type is "presence or interest", the API default | `ads_update_networks` with `presenceOnly: true`. Campaigns created by this package already use presence |
| Campaign gets no conversions although the action is primary | The campaign bids on its own goal set, which overrides the account default | `ads_assign_custom_goal` or `ads_set_campaign_goals`; `ads-audit` detects this |
| Demand Gen location targeting fails | Demand Gen sets locations and languages per **ad group**, not per campaign | `ads_create_demand_gen_ad` sets them on the ad group |
| Ad "eligible (limited)" for misleading design | Images with painted buttons or fake UI | Remove the button from the image; the platform shows its own call to action |
| Ad limited for clickbait | Questions or sensational phrasing in headlines | `guide("policy")` lists the patterns and rewrites |
| "0 conversions" but the client says leads arrived | Conversion tracking or goal setup broken; leads visible in GA4 | `performance-insights` reconciles against GA4 lead events |

## GA4, Search Console, Tag Manager

| Symptom | Cause | Fix |
|---|---|---|
| GA4 `PERMISSION_DENIED` | Login isn't a user on the property | Add it as Viewer (Editor for key events) |
| GA4 property not found | Used the `G-` measurement ID | Use the numeric property ID from Admin → Property details |
| Search Console returns nothing | Wrong property format | Match Search Console exactly: `sc-domain:example.com` or `https://www.example.com/` |
| GTM changes don't show on the site | Workspace not published | `gtm_publish` |
| GA4 event tag sends no parameters | GA4 event tags don't forward dataLayer fields on their own | Add each parameter to the tag's event settings, bound to a Data Layer Variable |

## Still stuck

Open an issue with the `doctor` output and the failing tool's error text. **Remove customer IDs, emails and tokens
first.**
