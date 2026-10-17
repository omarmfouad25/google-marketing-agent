# google-marketing-agent

An MCP server that lets an AI agent read and change a client's Google Ads, GA4, Search Console and Tag Manager setup, where every change is previewed, confirmed, logged and can be rolled back.

## Language

### Who and where

**Login**:
The one Google sign-in whose credentials every Profile acts through.
_Avoid_: account, user, credentials

**Profile**:
One configured client entry, named by an alias, listing the client's product resources, whether writes are allowed, and its guardrails.
_Avoid_: account, client config

**Profile scope**:
The product resources a Profile lists: its Google Ads account, GA4 property and Search Console site, and one or more GTM containers. Writes are only ever allowed inside it; reads may reach anything the Login can see.
_Avoid_: permissions, access

**Google Ads account** / **GA4 property** / **Search Console site** / **GTM container**:
A resource in one Google product. "Account" is only used with its product named in front.
_Avoid_: bare "account", customer

### Changing things

**Change**:
One confirmed write to one Profile, applied as a unit and recorded with the state it replaced. Changes are never bundled: each one has its own Preview, Confirmation and Rollback.
_Avoid_: edit, mutation, operation

**Preview**:
A statement of exactly what a Change will do, produced while nothing changes, based on the state it read at that moment. It is used up by one Confirmation or one refusal, expires after a short time, and is void once that state changes. Whether Google validated it is stated in the Preview, not implied by a different word.
_Avoid_: dry run, validate-only, GTM Preview mode (that is Tag Assistant)

**Confirmation**:
Approval to apply one specific Preview. The server guarantees a matching Preview came first; where the client supports it, the server also gets the human's approval directly. Every Confirmation is recorded as either human-approved or preview-matched.
_Avoid_: confirm flag, yes, approval

**Human-approved** / **Preview-matched**:
The two kinds of Confirmation: the human answered the server directly, or only the agent confirmed a matching Preview.
_Avoid_: verified, trusted, manual

**Change log**:
The per-Profile history of every applied Change, in every product.
_Avoid_: changelog, audit log, history

**Rollback**:
Restoring the state from before one logged Change, in any product. How it is done differs by product; whether a Change can be rolled back is a property of that Change.
_Avoid_: undo, revert

**Drift**:
Any difference between the current state and the state a Change left behind, such as a teammate's later edit or a newer live version. A Rollback over Drift needs a Confirmation that explicitly accepts overwriting it.
_Avoid_: conflict, stale state
