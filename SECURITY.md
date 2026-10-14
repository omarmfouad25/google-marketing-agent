# Security

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private vulnerability reporting (Security tab → Report a
vulnerability). You'll get a reply within a week.

## What counts

- Anything that lets a write reach Google without `confirm: true`, or on a profile with `writes: false`
- Credentials or tokens appearing in tool output, logs or the change log
- Config or credential files written with permissions wider than owner-only

## Keeping your setup safe

- Never commit `credentials.json`, `accounts.json`, service-account keys or `.env` files.
- Never paste tokens, customer IDs or client data into issues or PRs.
- Treat `credentials.json` like a password: anyone holding it can act as you on every account you can reach.
