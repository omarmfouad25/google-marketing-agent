# FAQ

## Getting started

**Do I need a Google Ads developer token?**
No. Google retired developer tokens on 9 September 2026. API access now belongs to the Google Cloud project that owns
your OAuth client. Apply for Explorer access there ([setup 1.3](setup.md#13-get-google-ads-api-access-explorer)).

**Why do I need my own Google Cloud project?**
So the connection is yours: your data goes straight from Google to your computer, under your own access level and
limits. Nobody else's app or server sits in between.

**Which AI apps work?**
Any app that supports MCP servers: Claude Code (with the skills, via the plugin), Claude Desktop, Cursor and others.
See [setup, part 3](setup.md#part-3-connect-your-ai-app).

**Do the skills work outside Claude Code?**
The Claude Code plugin installs them automatically. Other apps that support Agent Skills can load the
[`skills/`](../skills) folder. Without skills, every tool still works; you just guide the agent yourself.

**Does it work with a manager account (MCC)?**
Yes. `init` lists every account under the managers your login can reach and sets the manager ID on each profile.

## Cost and limits

**What does it cost?**
The package is free and open source (MIT). The Google APIs it uses are free. You pay only for your ads, and for your
AI app if it's a paid one.

**Are there limits?**
At Explorer access, 2,880 Google Ads operations a day on real accounts (one report or one change each). That's
plenty for one person or a small agency; Basic access allows 15,000. GA4, Search Console and Tag Manager have their
own generous quotas.

**Can I use Keyword Planner?**
Not at Explorer level: Google reserves planning services for Basic access and above.

## Safety and privacy

**Can the agent change my campaigns without asking?**
No. Every profile starts read-only. When you allow changes, each one is still a preview first, and the server applies
only a change that matches a preview it issued. In apps that support it (Claude Code), the server also asks you
directly before applying. See [safety.md](safety.md).

**Can I undo a change?**
Yes: ask *"undo that change"* or use `rollback` with the change ID. For Google Ads it restores the previous values and
removes what the change created; for Tag Manager it re-publishes the version before a publish; for GA4 it unmarks or
re-marks a key event. If someone edited the same thing since, it shows you and asks before overwriting.

**Where does my data go?**
From Google to the program on your computer, then to your AI app when you ask a question. The package sends nothing
anywhere else and has no telemetry. What your AI app does with the answers is governed by that app's own policy.

**Who can see my credentials?**
Only your computer user account. They're stored in `~/.config/google-marketing-agent/credentials.json` with
owner-only permissions and never appear in tool output. Never paste them into a chat.

**Is it safe to give it to a team?**
Each person runs `init` with their own Google login, so each person can only do what their Google account can do.
Keep accounts read-only for anyone who should only report.

## Accounts and reports

**How do I add another account later?**
`npx google-marketing-agent accounts add`. Existing profiles keep their settings.

**How do I brand the monthly report?**
Add `brand` (name, logo file, colours) to the profile ([profiles.md](profiles.md#fields)). Without it the report uses
a neutral theme.

**My external app's sign-in stops working every week.**
Your OAuth consent screen is External and in "Testing". Set it to "In production" and run `init` again
([setup 1.4](setup.md#14-configure-the-oauth-consent-screen)).

**Something else is wrong.**
Run `npx google-marketing-agent doctor` (or ask *"run the setup doctor"*), then see
[troubleshooting.md](troubleshooting.md).
