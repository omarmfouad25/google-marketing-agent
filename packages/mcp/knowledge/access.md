# Access and authentication

What each Google API needs, and the traps in setting it up.

- **No developer token needed** since 2026-09-09. API access is set on the Google Cloud project that owns the OAuth client. Don't apply for a token in the Ads API Center. (API v23 still requires the header; this package sends a placeholder.)
- **Access levels**, set on that Cloud project: Test (test accounts only, 15,000 ops/day), Explorer (real accounts, 2,880 ops/day on production), Basic (15,000 ops/day, brand verification required), Standard (unlimited, manual audit). Apply on the Google Ads API Overview page in the Cloud Console. Explorer excludes planning services (Keyword Planner, Reach Planner), account creation, user management and billing.
- **OAuth client in a different project from the one granted access** → Test level, no real accounts visible.
- **External OAuth app in "Testing" status** → refresh tokens expire after 7 days. Internal apps exist only for Google Workspace orgs; personal Gmail users must move the app to "In production".
- **Sensitive scopes** (Tag Manager publish, Analytics edit) can force passkey enrolment at consent. Workaround: a service account added as a user in Tag Manager and GA4 (`init --service-account`). Service accounts don't work for Google Ads in this package.
- **Roles needed**: Ads Standard/Admin for writes; GA4 Viewer (Editor for key events); Search Console full or restricted user; Tag Manager Edit/Publish.
- **Manager accounts**: set `loginCustomerId` to the MCC you reach the client through.
