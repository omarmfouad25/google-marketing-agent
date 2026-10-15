# Changelog

## 0.3.0 — 2026-10-15

Measurement: plan, build, publish and verify tracking in Tag Manager, GA4 and Google Ads. Guide:
[docs/tracking.md](docs/tracking.md).

### Added

- 7 tools (63 in total, 37 with writes off):
  - `gtm_build`: tags, triggers and variables from typed recipes (data-layer variable, custom event trigger, link
    click trigger, GA4 event tag, Ads conversion tag, with conditions, negation and consent), with a pre-flight that
    blocks duplicate names, missing variables, disabled built-ins and unknown triggers.
  - `gtm_versions`: list container versions; diff two versions, or the workspace against live.
  - `gtm_live_check`: check the live `gtm.js` serves every expected conversion label, event name and measurement ID.
  - `gtm_builtin_variables`: list, enable or disable built-in variables.
  - `gtm_delete`: delete from the workspace, refused while anything references it.
  - `ga4_custom_dimensions`: list, register or archive custom dimensions.
  - `ads_create_conversion_action`: new website conversion action; prints the ID and label for the tag.
- 4 skills: `tracking-plan`, `gtm-build` (with a Conversion Linker check; conversion value sent only when the site
  knows a real one), `event-audit`, `consent-audit`.
- `guide("gtm")`: recipes, naming, Conversion Linker, publish checklist, rollback.
- [docs/tracking.md](docs/tracking.md): walkthrough, recipe reference, test matrix, undo, troubleshooting.

### Changed

- `tracking-audit` hands Tag Manager fixes to `gtm-build` and full plans to `tracking-plan`.
- `guide("measurement")` covers success signals, dedup, consent and live testing.
- Tag Manager helpers moved to a shared module.

## 0.2.0

- Four new skills for planning and building, following a method proven on a live lead-gen account: `campaign-architect`
  (structure, budget split, bidding stages, goals, negative lists), `search-launch`, `demand-gen-launch` and
  `tracking-audit`.
- README and docs organised by what you can do: plan and budget, build campaigns, analyse and optimise, report.
- Ads rows show user list types and conversion counting types as names.

## 0.1.2

- Windows: `init` opens the full Google sign-in link (it was cut at the first `&`).

## 0.1.1

- Documentation rewritten: a shorter README with a 4-step start, a guided setup with a check after each part, and new
  [usage](docs/usage.md), [how it works](docs/how-it-works.md) and [FAQ](docs/faq.md) pages.

## 0.1.0

- Skills v1 ship with the plugin: `setup`, `ads-audit`, `performance-insights`, `pre-launch-check`, `weekly-check`, `monthly-report` (branded HTML report template).
- Ads rows show enum names (`PAUSED`, `SEARCH`, `BROAD`) instead of numbers.
- New `account_profile` tool (56 tools, 33 with writes off).

## 0.1.0-alpha.1

- `init` explains where the OAuth client comes from (Cloud project, Explorer access, consent screen, Desktop client) before asking for it.
- One-step Claude Code install: `/plugin install google-marketing-agent --marketplace omarmfouad25/google-marketing-agent`.
- Releases publish from GitHub Actions with npm trusted publishing (provenance attached, no tokens).

## 0.1.0-alpha.0

- MCP server with 55 tools (32 with writes off) across Google Ads, GA4, Search Console and Tag Manager.
- Profiles for many accounts (`init`, `accounts`), writes off per profile by default.
- Preview-first writes, per-account change log with prior state, `ads_rollback` (restores prior values, removes what an entry created).
- `setup_doctor` / `doctor` with exact fixes; `guide` knowledge topics.
- Skills are not in this alpha: `skills/` is empty and the plugin installs the MCP server only. Skills v1 is next.
- Loopback OAuth sign-in with state + PKCE; no developer token needed.
