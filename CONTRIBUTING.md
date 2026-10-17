# Contributing

Thanks for helping. Issues, fixes, new tools and new skills are all welcome.

## Ground rules

- **Safety model first** ([ADRs](docs/adr/)). New write tools go through the Preview → Confirmation gate
  (`runAdsWrite` for Google Ads, `gated` for the rest), respect `writes` and the profile's scope, say in the Preview
  whether the change can be rolled back, log to the change log with the prior state, and create anything new as PAUSED.
- **Use the glossary.** Terms in [CONTEXT.md](CONTEXT.md) (Profile, Preview, Confirmation, Rollback, Drift) are the
  words for code, docs and tool output.
- **Nothing account-specific.** No IDs, currencies, locations or brands in code; they come from the profile.
- **Knowledge goes in `packages/mcp/knowledge/`**, not copied into skills. Skills call `guide(<topic>)`.
- **No secrets** in code, tests, fixtures, issues or PRs.

## Development

```bash
npm install
npm run build
npm test            # unit tests: operations built by each tool
npm run test:live   # optional: every write tool as validate_only against your own account (changes nothing)
```

## Adding a write tool

1. Write a pure `build<Thing>Ops(args, profile)` that returns the mutate operations.
2. Register the tool with the shared runner: it previews without `confirm` and applies only with a matching Preview ID.
3. Add unit tests for the operations (status, money in micros, guardrails).
4. Add it to `docs/tools.md`.

## Adding a skill

1. `skills/<name>/SKILL.md` with a `description` that lists the phrases people actually say.
2. Steps as tool calls, an explicit output format, and what the skill must never do.
3. Add it to `docs/skills.md`.

## Pull requests

Small and focused. Describe what changed, how you tested it, and whether it touches the safety model.
