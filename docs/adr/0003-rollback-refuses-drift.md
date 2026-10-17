---
status: accepted
---

# A Rollback refuses to overwrite Drift unless the Confirmation accepts it

Up to 0.3, `ads_rollback` restored the logged prior values and silently overwrote anything changed since, and the GTM path of re-publishing an older version also discarded any newer live version. Silently undoing a colleague's work is the worst failure this tool can have, because nobody is watching for it. From 0.4 the single `rollback` tool compares the current state with the state the Change left behind, in every product, and shows any Drift in the Preview. A Rollback over Drift is refused unless its Confirmation explicitly accepts overwriting it. A resource the Change created counts as drifted when it is no longer as the Change left it, for example a campaign created paused and since enabled by hand.

## Considered Options

- **Overwrite** (the 0.3 behaviour): rejected for the reason above.
- **Show the Drift, then overwrite anyway**: rejected because a warning in a Preview is easy to confirm past; the refusal makes overwriting someone's work a deliberate act.
