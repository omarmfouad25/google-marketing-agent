# Setup

From nothing to your first audit in about 15 minutes. Four parts, each ending with a check, so you always know
whether it's safe to move on.

| Part | What you do | How often | Time |
|---|---|---|---|
| [1. Google Cloud](#part-1-google-cloud-once) | Create the login that lets the package talk to Google | Once (agencies: once for all clients) | ~10 min |
| [2. Sign in and pick accounts](#part-2-sign-in-and-pick-your-accounts) | Run `init`, choose accounts, run `doctor` | Once per computer | ~3 min |
| [3. Connect your AI app](#part-3-connect-your-ai-app) | Add the server (and skills) to Claude Code, Claude Desktop, Cursor… | Once per app | ~1 min |
| [4. First questions](#part-4-first-questions) | Check the connection and run a first audit | Once | ~1 min |

**Before you start, have:**

- [ ] Node.js 20 or newer (`node -v`)
- [ ] The Google account that can open your Google Ads account. Agencies: the account with access to the manager
      account (MCC).
- [ ] Optional: access to the GA4 property, Search Console site and Tag Manager container you want to use.

> **Using Claude Code?** After part 3 you can say *"set up google-marketing-agent"*: the `setup` skill walks you
> through whatever is still missing and checks each step.

---

## Part 1: Google Cloud (once)

The package signs in to Google with **your own** OAuth client. Your data goes only between your computer and Google,
and it's how Google grants API access today: developer tokens were retired on 9 September 2026.

### 1.1 Create a project

[console.cloud.google.com](https://console.cloud.google.com/) → project picker → **New project**. Name it, for example,
`marketing-agent`.

Agencies: one project serves every client. It belongs to you, not to a client.

### 1.2 Enable the APIs

**APIs & Services → Library**. Search for and enable:

| API | Needed for |
|---|---|
| **Google Ads API** | Everything in Google Ads (required) |
| Google Analytics Data API | GA4 reports |
| Google Analytics Admin API | GA4 key events and custom dimensions |
| Google Search Console API | Search Console |
| Tag Manager API | Tag Manager |

Skip the products you don't use.

### 1.3 Get Google Ads API access (Explorer)

A new project starts at **Test** level, which can only see test accounts.

1. **APIs & Services → Google Ads API → Overview**.
2. Expand **Upgrade access level**, choose **Explorer**, click **Apply for access**. Explorer is usually approved
   within minutes.

| Level | Real accounts | Operations per day | Notes |
|---|---|---|---|
| Test | No | 15,000 (test accounts only) | Where every project starts |
| **Explorer** | Yes | 2,880 | Enough for one person or a small agency. No Keyword Planner |
| Basic | Yes | 15,000 | Needs brand verification first |
| Standard | Yes | Unlimited | Manual review |

An operation is one report or one change.
([Google: access levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels))

> **Keep everything in this one project.** The access level belongs to the project that owns your OAuth client
> (step 1.5). A client in a different project gets Test level and sees no real accounts.

### 1.4 Configure the OAuth consent screen

**APIs & Services → OAuth consent screen** (newer consoles: **Google Auth Platform → Branding / Audience**).

- **User type:**
  - **Internal** if your Google account belongs to a Google Workspace organisation and only your team will sign in.
  - **External** otherwise (personal Gmail). Add your email under **Test users**, then set the app to
    **In production**.
- App name and support email: anything; only you see this screen.
- Scopes: leave them; `init` asks for them when you sign in.

> **Don't leave an External app in "Testing".** Google expires its sign-ins after 7 days and everything stops until
> you run `init` again. "In production" works for your own use without Google's review; the sign-in page shows an
> "unverified app" warning, which is expected.

### 1.5 Create the OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID**

- Application type: **Desktop app**
- Name: anything

Keep the **Client ID** and **Client secret** for part 2. Don't paste them into a chat with an AI.

**✅ Check:** you have a Client ID ending in `.apps.googleusercontent.com`, and the Google Ads API Overview page shows
Explorer (or a pending application).

---

## Part 2: Sign in and pick your accounts

```bash
npx google-marketing-agent init
```

`init` will:

1. Explain where the OAuth client comes from, then ask for the Client ID and Client secret from part 1.
2. Open your browser for Google sign-in. Sign in with the account from "Before you start" and allow every permission
   listed. The sign-in waits up to 5 minutes.
3. List every Google Ads account that login can reach, including accounts under a manager account.
4. Ask which accounts to add (`1,3` or `all`), a short name (alias) for each, such as `acme`, and optionally its GA4
   property, Search Console site and Tag Manager container.

It saves two files that only your user can read:

```text
~/.config/google-marketing-agent/credentials.json   # OAuth client + sign-in (secret: never share)
~/.config/google-marketing-agent/accounts.json      # your profiles (see profiles.md)
```

New profiles are **read-only**. To add accounts later run `npx google-marketing-agent accounts add` (or `init`
again); existing profiles keep your settings.

### Where to find the IDs

| ID | Where |
|---|---|
| GA4 property ID | GA4 → Admin → Property details → **Property ID** (numbers only, not the `G-…` measurement ID) |
| Search Console site | Exactly as Search Console lists it: `sc-domain:example.com` or `https://www.example.com/` |
| Tag Manager container | `GTM-XXXXXXX` at the top of Tag Manager |
| Google Ads customer ID | Found by `init`. Shown top right in Google Ads as `123-456-7890` |

### Give the login access to each product

| Product | Role the signed-in account needs |
|---|---|
| Google Ads | Read only for reports; **Standard** or **Admin** to make changes |
| GA4 | **Viewer** for reports; **Editor** for key events |
| Search Console | **Full** or **Restricted** user |
| Tag Manager | **Read** to view; **Edit** to change; **Publish** to publish |

### Run the doctor

```bash
npx google-marketing-agent doctor
```

Each line is ✓ or ✗; every ✗ comes with the exact fix:

```text
✓ OAuth token valid (2 Google Ads account(s) directly accessible)
✓ acme: Google Ads customer 1234567890 readable
✗ acme: GA4 property 123456789 readable: PERMISSION_DENIED
    → Add the login as Viewer (Editor for key events) in GA4 → Admin → Property access management.
✓ Google Ads API access: Explorer (Keyword Planner needs Basic)
✓ Writes enabled: none (read-only everywhere)
```

**✅ Check:** every product you plan to use shows ✓. Fix the ✗ lines and run `doctor` again; if one stays red, see
[troubleshooting](troubleshooting.md).

---

## Part 3: Connect your AI app

### Claude Code (recommended: tools + skills)

```text
/plugin install google-marketing-agent --marketplace omarmfouad25/google-marketing-agent
```

On Claude Code older than 2.1.275: `/plugin marketplace add omarmfouad25/google-marketing-agent`, then
`/plugin install google-marketing-agent`. Restart Claude Code.

Tools only, without the skills:

```bash
claude mcp add google-marketing -- npx -y google-marketing-agent
```

### Claude Desktop, Cursor and other MCP apps

Add this server to the app's MCP configuration and restart the app:

```json
{
  "mcpServers": {
    "google-marketing": { "command": "npx", "args": ["-y", "google-marketing-agent"] }
  }
}
```

| App | Where the configuration lives |
|---|---|
| Claude Desktop | Settings → Developer → Edit config (`claude_desktop_config.json`) |
| Cursor | Settings → MCP → Add new MCP server (`~/.cursor/mcp.json`) |
| Others | The app's MCP settings; the command is `npx -y google-marketing-agent` |

The skills are Agent Skills in the repo's [`skills/`](../skills) folder; apps that support Agent Skills can load them
from there.

**✅ Check:** the app lists the `google-marketing` server with 37 tools (63 once an account allows changes).

---

## Part 4: First questions

1. *"Run the setup doctor."* Same result as part 2, now through your AI app.
2. *"Which Google Ads accounts can you see?"*
3. *"Audit my Google Ads account for the last 30 days."*

**✅ Check:** you get a scored audit. You're set up. Next: [usage examples](usage.md).

---

## Allowing changes (optional)

Every profile starts read-only: the agent can report and suggest, but not change anything. Read
[safety.md](safety.md) first, then:

```bash
npx google-marketing-agent accounts set acme writes true
```

Restart your AI app so the 26 change tools load. Even then, every change is a preview first, applied only once it is
confirmed (and, in Claude Code, once you accept the server's prompt).

## Alternative: service account for Tag Manager and GA4 Admin

Granting the Tag Manager and GA4 Admin permissions can make Google ask the signing-in user to set up a passkey. If
that blocks you, use a service account for those two products (Google Ads still uses your OAuth sign-in):

1. **IAM & Admin → Service accounts → Create**, then **Keys → Add key → JSON**. Keep the file outside any repository.
2. Add the service account's email as a user in Tag Manager (Publish) and GA4 (Editor).
3. `npx google-marketing-agent init --service-account /path/to/key.json`. Only the file's location is saved; the key
   itself is never copied.

`doctor` shows which identity each product uses.
