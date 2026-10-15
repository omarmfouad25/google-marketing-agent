# Safety model

> **In short:** accounts are read-only until you allow changes; every change is a preview until you confirm it;
> new campaigns start paused; every applied change is logged and can be undone.

An AI agent with write access to an ad account can spend real money. This package is built so that it can only
change what you approve, and so that anything it changed can be undone.

## The four layers

### 1. Writes are off per account

Every profile starts with `"writes": false`. Write tools load only when at least one profile has `"writes": true`.
A write against a read-only profile is refused before anything reaches Google:

```
REFUSED: profile "globex" is read-only. Set "writes": true for it in accounts.json to allow changes (see docs/safety.md).
```

To allow changes on an account, run this and restart your AI app:

```bash
npx google-marketing-agent accounts set acme writes true
```

Agencies can enable writes for the clients they manage day to day and keep the rest read-only.

### 2. Preview first, apply on confirm

Every write tool runs twice:

1. **Without `confirm`:** the change is sent to Google with `validate_only`. Google checks it in full (permissions,
   policy, field rules), and nothing changes. You get a preview:

   ```
   DRY RUN OK (nothing changed)
   Set 1 campaign(s) → ENABLED: 12345678901
   Google validated 1 operation(s). Call again with confirm: true to apply.
   ```

2. **With `confirm: true`:** the same change is applied.

The skills always show you the preview and wait for your yes before calling with `confirm: true`. If you use the
tools directly from another agent, keep the same habit.

### 3. Guardrails

| Guardrail | Behaviour |
|---|---|
| New campaigns and ads | Always created **PAUSED**. Going live is a separate, explicit `ads_set_status` |
| Budget changes | Refused above `guardrails.maxBudgetChangePct` (default 50%) unless `allowLargeChange: true` |
| Location targeting | Always **presence**: people in or regularly in the location. Google's API default also targets people merely *interested in* it, which in practice can send a large share of spend to other countries |
| Money | Entered and shown in the account currency; micros conversion happens inside the tool |

### 4. Change log and rollback

Every applied write is appended to:

```
~/.config/google-marketing-agent/changes/<account>.jsonl
```

Each entry records the time, tool, summary, the operations sent, the resources created or changed, and **the prior
state** of what was changed.

- `changes_list` shows recent entries for an account.
- `ads_rollback` reverts one entry by restoring its prior state (status, budget, bid, network settings). It uses the
  same preview → confirm flow.
- Things that were **created** are removed (Google keeps their history). Image assets and Demand Gen custom segments are listed as not reverted: assets are unused once their ad is removed, and segments can be removed in the UI or reused.
- Rollback restores the logged values, so it overwrites any edits made after that change. It refuses Tag Manager and GA4 entries, entries whose prior-state snapshot failed, entries already rolled back, and rollbacks of a rollback.
- Writes fail closed: if the prior-state snapshot can't be taken, or the current budget is unknown for the budget guardrail, the change is refused rather than applied unlogged.
- The `container` parameter of `gtm_upsert`, `gtm_build`, `gtm_delete`, `gtm_builtin_variables` and `gtm_publish` can target any Tag Manager container the login can see, not only the one in the profile.

## Tag Manager and GA4 writes

The same rules apply (writes on per account, preview first, logged), with these differences:

| | Behaviour |
|---|---|
| Workspace vs live | `gtm_build`, `gtm_upsert`, `gtm_delete` and `gtm_builtin_variables` change the **workspace** only. Visitors see nothing until `gtm_publish` |
| Publish | `gtm_publish` previews the pending changes and the live version first. The skills show the full workspace diff (`gtm_versions` with `versionId: "workspace"`) and wait for your yes |
| Pre-flight | `gtm_build` refuses duplicate names, missing variables, disabled built-ins, unknown trigger IDs and an `id` of another type: `NOT BUILT (nothing changed)` |
| Refused deletes | `gtm_delete` refuses anything a tag, trigger or variable still references. The skills pause tags rather than delete them |
| Verify | `gtm_live_check` reads what visitors actually receive, after publishing |
| GA4 custom dimensions | Created dimensions apply only to data from then on. Archiving is permanent |

Undo:

- **Before publishing:** Tag Manager → Workspace Changes → Revert, or `gtm_delete` what was just created.
- **After publishing:** re-publish the previous version with `gtm_publish` and `versionId` (the publish result names
  it; `gtm_versions` lists all versions).
- **GA4:** `ga4_set_key_event` with `action: "remove"`; archived custom dimensions can't be restored.
- **Google Ads conversion actions** created with `ads_create_conversion_action` are removed by `ads_rollback`.

Details: [tracking.md](tracking.md#undo).

## What the agent can never do

- Change anything on a read-only profile.
- Apply a change without `confirm: true`.
- Create a campaign or ad that serves immediately.
- Read or print your OAuth credentials. They live in `credentials.json` (mode `0600`) and never pass through tool
  output.

## Your responsibilities

- Review previews before confirming. The preview shows what will change; it can't judge whether the change is a good
  idea.
- Keep `credentials.json` private. Anyone with it can act as you on every account you can reach.
- Google's own rules still apply: ad policy, budgets, billing. A change Google accepts can still cost money.

## Reporting a security issue

See [SECURITY.md](../SECURITY.md). Don't open a public issue for vulnerabilities.
