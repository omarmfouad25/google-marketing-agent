# Changelog

## 0.4.0 · 2026-10-17

The safety model, enforced by the server instead of asked of the agent. Design records:
[ADR 0001](docs/adr/0001-confirmations-bound-to-previews.md), [0002](docs/adr/0002-writes-bounded-by-profile-scope.md),
[0003](docs/adr/0003-rollback-refuses-drift.md); terms in [CONTEXT.md](CONTEXT.md).

### Breaking

- **`confirm` takes a Preview ID, not `true`.** A write without `confirm` returns a Preview and a Preview ID; call it
  again with the same arguments and `confirm: "<Preview ID>"` to apply. The ID works once, expires after 15 minutes
  and is void if anything the Preview depended on changed (arguments, current budget, entity fingerprint, live version,
  workspace diff). `confirm: true` now fails validation instead of applying.
- **Tag Manager writes stay inside the profile.** `container` on `gtm_upsert`, `gtm_build`, `gtm_delete`,
  `gtm_builtin_variables` and `gtm_publish` is refused for containers the profile doesn't list. Add others to the new
  `gtmContainerIds`. Reads still reach every container the login can see.
- **`rollback` replaces `ads_rollback`** and works across products (see Added).
- **Renamed for the glossary:** the `account` parameter is now `profile`, `use_account` is `use_profile` and
  `account_profile` is `get_profile`. Passing `account` is refused rather than ignored, so a 0.3 caller never lands on
  the default profile by accident. Error messages say "profile" where they meant one.
- **`call` only previews**; add `--apply` to change something (see Added). It now exits 1 when a change is refused,
  declined or failed.

### Added

- **Human approval.** Where the client supports MCP elicitation (Claude Code), the server asks the user directly before
  applying, showing the Preview. Decline, cancel or no answer applies nothing. Elsewhere the Confirmation is
  preview-matched. `"requireHumanApproval": true` on a profile refuses changes the user didn't approve directly.
- Every change log entry records its confirmation: `human-approved` or `preview-matched` (`changes_list` shows it;
  older entries show "confirmed before 0.4").
- **`rollback`** for Google Ads changes, Tag Manager publishes (re-publishes the version before) and GA4 key events and
  custom dimensions. **Drift** since the change (a later edit, a newer live version, a created campaign enabled by
  hand) is listed and refused unless `acceptDrift: true`.
- Every Preview says whether and how its change can be rolled back.
- `call <tool> <args.json> --apply`: previews and confirms in one run, asking `Apply? [y/N]` in a terminal.
- Profile fields `gtmContainerIds` and `requireHumanApproval`.
- `CONTEXT.md` (domain glossary), `docs/adr/` and `docs/agents/`.

### Fixed

- `ads_demand_gen_audience` creates its custom segment only after the Confirmation, so a refused change creates nothing.
- `gtm_builtin_variables` refuses enable/disable on a read-only profile before any Tag Manager call.
- `workspaceId` must be digits: other values could point the API path at a container outside the profile.

### Migration

1. Update anything that calls the tools directly: drop `confirm: true`, preview first, then pass the Preview ID.
   Rename `account` to `profile`.
2. A client with several Tag Manager containers: list the extra ones in its profile's `gtmContainerIds`.
3. Scripts that changed things with `call`: add `--apply`.
4. Existing change logs keep working. Their GTM publishes have no container recorded, so `rollback` refuses them
   with the version to re-publish by hand.

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
