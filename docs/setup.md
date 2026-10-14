# Setup guide

From nothing to a green `doctor` in about 15 minutes. You do steps 1–4 once per Google Cloud project. Steps 5–7 run
once per machine.

**You need:**

- Node.js 20 or newer
- A Google account that has access to your Google Ads account. For agencies, use the account that has access to the
  manager account (MCC).
- Optional: access to the GA4 property, the Search Console property and the Tag Manager container you want to use

> **Shortcut:** in Claude Code, say *"set up google-marketing-agent"*. The `setup` skill walks you through this page
> and runs `doctor` after each step.

---

## 1. Create a Google Cloud project

1. Open [console.cloud.google.com](https://console.cloud.google.com/) → project picker → **New project**.
2. Name it, for example `marketing-agent`. Any name works; you only see it here.

Agencies: one project serves all your clients. The project is yours, not the client's. This project also holds
your Google Ads API access level (step 4), so create the OAuth client in this same project.

## 2. Enable the APIs

**APIs & Services → Library**, then enable the ones you need:

| API | Needed for |
|---|---|
| **Google Ads API** | All Google Ads tools (required) |
| Google Analytics Data API | GA4 reports |
| Google Analytics Admin API | GA4 key events (`ga4_list_key_events`, `ga4_set_key_event`) |
| Google Search Console API | Search Console tools |
| Tag Manager API | Tag Manager tools |

Skip any product you don't use. `doctor` reports which ones are reachable.

## 3. Configure the OAuth consent screen

**APIs & Services → OAuth consent screen** (in newer consoles: **Google Auth Platform → Branding / Audience**).

1. **User type:**
   - **Internal** if your Google account is in a Google Workspace organisation and only your team will sign in.
     This is the best option: tokens don't expire after 7 days.
   - **External** otherwise (including personal Gmail accounts, which can't use Internal). Add your own email under **Test users**.
2. App name and support email: anything; only you see the consent screen.
3. **Scopes:** you don't need to add them here; `init` requests them at sign-in.

> **External + "Testing" status = refresh tokens expire after 7 days.** You'll have to run `init` again every
> week. To avoid that, either use an Internal app (Google Workspace organisations only), or move the app to **In production** (the option for personal Gmail accounts). For a personal-use app,
> production status works without Google verification, but users see an "unverified app" warning on sign-in.

## 4. Create the OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID**

- Application type: **Desktop app**
- Name: anything

Copy the **Client ID** and **Client secret**. `init` asks for them in step 5.

### Google Ads API access level

**You don't need a developer token.** Google sunset developer tokens on 9 September 2026. API access now belongs to
the **Google Cloud project that owns your OAuth client** (the one you just created). Don't apply for a token in the
API Center of a Google Ads manager account. If you still have an old token, it's ignored.
([Google: developer tokens](https://developers.google.com/google-ads/api/docs/first-call/dev-token))

A new project starts at **Test** level, which can't see real accounts. Request a higher level:

1. Cloud Console → **APIs & Services → Google Ads API** → the API's **Overview** page.
2. Expand **Upgrade access level**, check the next level, click **Apply for access**.
3. Explorer is usually approved automatically within minutes.

| Level | Real accounts | Operations per day | How you get it |
|---|---|---|---|
| Test | No, test accounts only | 15,000 (test accounts) | Enabling the API |
| **Explorer** | Yes | 2,880 on real accounts | Apply on the Overview page |
| Basic | Yes | 15,000 | Apply; needs **brand verification** first |
| Standard | Yes | Unlimited | Manual audit (about 10 business days) |

An "operation" is one change or one report request. 2,880 a day is plenty for one person or a small agency running
audits, reports and day-to-day changes.

**Explorer is enough for everything in this package except Keyword Planner.** Explorer can't use planning services
(Keyword Planner, Reach Planner), account creation, user management or billing. Those need Basic.
([Google: access levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels))

You never need a developer token: API v23 still requires the header, so the package sends a placeholder value.

> **Common trap:** if your OAuth client is in a *different* Cloud project from the one that was granted access, you
> get Test level and can't see real accounts. Keep the OAuth client and the access level in the same project.

## 5. Run `init`

```bash
npx google-marketing-agent init
```

It will:

1. Ask for the Client ID and Client secret. The secret is visible while you type it, so don't run `init` on a shared screen.
2. Open your browser for Google sign-in (a local loopback flow protected by `state` and PKCE; it times out after
   5 minutes). Sign in with the account from "You need" above and allow all requested scopes.
3. List every Google Ads account that login can reach, including accounts under a manager account.
4. Let you pick accounts and give each an alias (`acme`, `globex`), then ask for each one's optional GA4 property,
   Search Console site and Tag Manager container.

If you re-run `init` (or `accounts add`) and pick an alias that already exists, only `customerId`, `loginCustomerId`,
`currency` and `timezone` are refreshed; `writes`, `geos`, `guardrails`, `brand` and your other settings are kept.

It writes two files, both readable only by you (mode `0600`):

```
~/.config/google-marketing-agent/credentials.json   # OAuth client + refresh token
~/.config/google-marketing-agent/accounts.json      # profiles (see profiles.md)
```

Neither file is ever stored in your project or MCP client config.

### Where to find the IDs

| ID | Where |
|---|---|
| Google Ads customer ID | Top-right of Google Ads, `123-456-7890` (enter it with or without dashes) |
| Manager (login) customer ID | Same place, while you are in the manager account. Only needed when you reach the account through an MCC |
| GA4 property ID | GA4 → Admin → Property details → Property ID (numbers only, not the `G-` measurement ID) |
| Search Console site | `sc-domain:example.com` for a Domain property, or `https://www.example.com/` for a URL-prefix property, exactly as Search Console lists it |
| Tag Manager container | `GTM-XXXXXXX` at the top of Tag Manager |

## 6. Give the login access to each product

The Google account you signed in with needs:

| Product | Role |
|---|---|
| Google Ads | Read only for reports. **Standard** or **Admin** for writes |
| GA4 | **Viewer** for reports. **Editor** for key events |
| Search Console | **Full** or **Restricted** user on the property |
| Tag Manager | **Read** for viewing. **Edit** for changes. **Publish** to publish |

## 7. Run `doctor`

```bash
npx google-marketing-agent doctor
```

Every line is a pass or a fail with its exact fix, for example:

```
✓ OAuth token valid (scopes: adwords, analytics, webmasters, tagmanager)
✓ Google Ads API reachable — real accounts visible (Explorer or higher)
✓ acme: customer 1234567890 readable
✗ acme: GA4 property 123456789 — PERMISSION_DENIED
    → In GA4 → Admin → Property access management, add you@example.com as Viewer
✗ Search Console API disabled
    → Enable it: https://console.cloud.google.com/apis/library/searchconsole.googleapis.com
```

Fix the red lines and run it again until everything you need is green. In an agent, the same check is the
`setup_doctor` tool.

## 8. Connect your agent

**Claude Code:**

```
/plugin install google-marketing-agent --marketplace omarmfouad25/google-marketing-agent
```

On Claude Code older than 2.1.275, run `/plugin marketplace add omarmfouad25/google-marketing-agent` first, then
`/plugin install google-marketing-agent`.

This installs the MCP server and the skills. Restart Claude Code, then ask *"run the setup doctor"*.

**Claude Desktop, Cursor, Codex and other MCP clients:** add a stdio server:

```json
{
  "mcpServers": {
    "google-marketing": { "command": "npx", "args": ["-y", "google-marketing-agent"] }
  }
}
```

## 9. Turn on writes (optional)

Profiles start **read-only**. Read [safety.md](safety.md), then set `"writes": true` on the profiles you want to
change from the agent:

```bash
npx google-marketing-agent accounts set acme writes true
```

Restart your MCP client so the write tools load.

---

## Alternative: service account for Tag Manager and GA4 Admin

Granting the Tag Manager and GA4 Admin scopes can make Google ask the signing-in user to enrol a passkey. If that
blocks you, use a service account for those two products. Google Ads still uses OAuth.

1. **IAM & Admin → Service accounts → Create**, then **Keys → Add key → JSON**. Store the file outside any repo.
2. Add the service account's email as a user in Tag Manager (Publish) and GA4 (Editor).
3. `npx google-marketing-agent init --service-account /path/key.json`

   Only the absolute path to the key file is stored; the key's contents are never copied into the config.

`doctor` shows which identity each product uses.

## Next

- [Profiles](profiles.md): multiple accounts, defaults, brand for reports
- [Safety](safety.md): how writes work
- [Troubleshooting](troubleshooting.md): when `doctor` stays red
