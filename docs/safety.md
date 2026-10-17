# Safety model

> **In short:** profiles are read-only until you allow changes, and only for the resources they list; every change is
> a preview, and the server applies only a change that matches a preview it issued; where your AI app supports it, the
> server asks you directly; new campaigns start paused; every applied change is logged and can be rolled back.

An AI agent with write access to an ad account can spend real money. This package is built so that it can only
change what you approve, and so that anything it changed can be rolled back.

## The four layers

### 1. Writes are off per profile, and bounded by it

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

A profile with writes on can only change **what it lists**: its Google Ads account, GA4 property, and the Tag Manager
containers in `gtmContainerId` and `gtmContainerIds`. A Tag Manager write to any other container is refused, even
though your login can see it. Reads still reach everything your login can see
([ADR 0002](adr/0002-writes-bounded-by-profile-scope.md)).

### 2. Preview first, apply only what was previewed

Every write tool runs twice:

1. **Without `confirm`** you get a **Preview**: exactly what will change, and nothing changes. For Google Ads the
   change is sent with `validate_only`, so Google checks it in full (permissions, policy, field rules). Every Preview
   also says whether the change can be rolled back, and gets a **Preview ID**:

   ```
   PREVIEW (nothing changed). Google validated 1 operation(s).

   Set 1 campaign(s) → ENABLED: 12345678901

   Rollback: possible with rollback.

   Preview ID: pv_3f9c2a1b (valid 15 minutes, once). To apply, show this preview to the user, then call
   ads_set_status again with the same arguments and confirm: "pv_3f9c2a1b".
   ```

2. **With `confirm: "<Preview ID>"`** the server rebuilds the Preview and applies the change only if it matches the
   one it issued. It refuses (nothing changed) when:
   - there was no Preview, or it expired (15 minutes), was already used, or was lost when the server restarted;
   - the Preview was for another tool or profile;
   - anything the Preview depended on changed: different arguments, or the account moved on meanwhile. For example a
     budget raise previewed as +40% is refused if someone lowered the budget in the UI, because it would now be +75%.
     A Tag Manager publish is refused if a colleague added a change to the workspace after the Preview.

   The Preview ID is used up by one Confirmation or one refusal. This makes "preview first" a rule the server
   enforces, not a habit the agent is asked to keep ([ADR 0001](adr/0001-confirmations-bound-to-previews.md)).

### 2b. You approve, not just the agent

When your AI app supports MCP elicitation (Claude Code does), the server asks **you** directly before applying, showing
the Preview again. The agent can't answer that prompt for you. Decline or close it and nothing changes; the agent is
told not to retry unless you ask again.

Apps without elicitation (and scripts) get the Preview check alone. The change log records which kind each change got:

| Recorded as | Means |
|---|---|
| `human-approved` | You answered the server's prompt |
| `preview-matched` | The agent confirmed a matching Preview; nobody answered the server directly |

To require the first kind for a client, set `"requireHumanApproval": true` on its profile. Apps that can't ask then
can't change that client at all, and the Preview says so up front.

From the terminal, `npx google-marketing-agent call <tool> <args.json> --apply` previews and confirms in one run: it
shows the Preview and asks you `Apply? [y/N]` (human-approved), or, without a terminal (a script or cron job), prints
the Preview and applies it (preview-matched). Without `--apply`, `call` only previews.

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
~/.config/google-marketing-agent/changes/<profile>.jsonl
```

Each entry records the time, tool, summary, how it was confirmed, the operations sent, the resources created or
changed, and **the prior state** of what was changed.

- `changes_list` shows recent entries for a profile.
- `rollback` rolls one entry back, in any product, with the same Preview → Confirmation flow:
  - **Google Ads:** restores the prior state (status, budget, bid, network settings) and removes what the change
    created (Google keeps their history). Image assets and Demand Gen custom segments stay: assets are unused once their
    ad is removed, and segments can be removed in the UI or reused.
  - **Tag Manager publishes:** re-publishes the version that was live before.
  - **GA4:** unmarks or re-marks a key event; a created custom dimension is archived (permanent).
- **Drift is refused.** If the account moved on since the change (a teammate edited the same budget, a newer Tag
  Manager version went live, a campaign the change created paused was enabled by hand), `rollback` lists the
  differences and refuses. Pass `acceptDrift: true` to overwrite them deliberately
  ([ADR 0003](adr/0003-rollback-refuses-drift.md)).
- It refuses Tag Manager workspace edits (see below), entries whose prior-state snapshot failed, entries already rolled
  back, and rollbacks of a rollback.
- Writes fail closed: if the prior-state snapshot can't be taken, or the current budget is unknown for the budget
  guardrail, the change is refused rather than applied unlogged.

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

Rollback:

- **Before publishing:** workspace edits are invisible to visitors, so `rollback` leaves them to Tag Manager →
  Workspace Changes → Revert, or `gtm_delete` what was just created.
- **After publishing:** `rollback` with the publish's change ID re-publishes the previous version.
- **GA4:** `rollback` unmarks or re-marks a key event. Archived custom dimensions can't be restored.
- **Google Ads conversion actions** created with `ads_create_conversion_action` are removed by `rollback`.

Details: [tracking.md](tracking.md#rollback).

## What the agent can never do

- Change anything on a read-only profile, or outside the resources a profile lists.
- Apply a change that doesn't match a Preview the server issued in the last 15 minutes.
- Answer the approval prompt for you, where your app shows one.
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
