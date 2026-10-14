# Profiles

A profile is one Google Ads account plus its linked GA4 property, Search Console site and Tag Manager container,
under a short alias. One login can serve any number of profiles, which is how agencies run many clients from one
setup.

Profiles live in `~/.config/google-marketing-agent/accounts.json`. `init` creates the file; you can also edit it by
hand. Set `GOOGLE_MARKETING_AGENT_CONFIG` to point at a different file, and put that file inside a dedicated directory:
the directory holds `credentials.json` and `changes/` too, and it is set to `0700` on every save.

## Example

```json
{
  "default": "acme",
  "accounts": {
    "acme": {
      "customerId": "1234567890",
      "loginCustomerId": "9876543210",
      "currency": "USD",
      "timezone": "America/New_York",
      "geos": ["2840"],
      "languages": ["en"],
      "ga4PropertyId": "123456789",
      "gscSiteUrl": "sc-domain:acme.com",
      "gtmContainerId": "GTM-XXXXXXX",
      "writes": true,
      "guardrails": { "maxBudgetChangePct": 50 },
      "brand": { "name": "Acme", "logo": "/Users/me/brands/acme.png", "colors": ["#0B1F3A", "#F2A900"] }
    },
    "globex": {
      "customerId": "2345678901",
      "loginCustomerId": "9876543210",
      "currency": "EUR",
      "timezone": "Europe/Berlin",
      "geos": ["2276", "2040"],
      "languages": ["de", "en"],
      "writes": false
    }
  }
}
```

## Fields

| Field | Required | Meaning |
|---|---|---|
| `customerId` | yes | Google Ads customer ID, digits only |
| `loginCustomerId` | if via MCC | The manager account you reach this account through |
| `currency` | yes | Account currency, used in tool descriptions and reports. Must match the account |
| `timezone` | yes | Account timezone, informational: date ranges are computed in UTC |
| `geos` | no | Default location targets for new campaigns ([geo target IDs](https://developers.google.com/google-ads/api/data/geotargets)). There is no built-in fallback: tools that create campaigns or ad groups error when neither the call nor the profile gives locations. Lookalike audiences always need explicit `countryCodes` |
| `languages` | no | Default languages for new campaigns: `en`, `ar`, `de`… |
| `ga4PropertyId` | for GA4 | Numeric property ID |
| `gscSiteUrl` | for GSC | `sc-domain:example.com` or `https://www.example.com/` |
| `gtmContainerId` | for GTM | `GTM-XXXXXXX` |
| `writes` | no | `false` (default) = read-only. See [safety.md](safety.md) |
| `guardrails.maxBudgetChangePct` | no | Largest budget change allowed without `allowLargeChange`. Default 50 |
| `brand` | no | Name, logo path and colours for `monthly-report`. Neutral theme if unset |

## Using profiles

- Every tool except setup_doctor, guide, accounts_list and use_account takes an optional `account` parameter: `get_campaign_performance({ account: "globex" })`.
- Without it, tools use `default`, or the account picked with `use_account` in the current session.
- `accounts_list` shows every account your login can reach, and which of them have profiles.
- In conversation: *"Switch to globex"*, *"Audit acme and globex"*.

## Commands

```bash
npx google-marketing-agent accounts                       # list profiles
npx google-marketing-agent accounts add                   # pick another reachable account
npx google-marketing-agent accounts set acme writes true  # change a field
npx google-marketing-agent accounts default globex        # change the default
```

Restart your MCP client after changing `writes`, so the write tools load or unload.
