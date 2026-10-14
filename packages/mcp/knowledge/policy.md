# Ad policy patterns

Disapprovals and "eligible (limited)" causes seen in practice, with the rewrite that fixed them.

- **Painted buttons or fake UI in images** → MISLEADING_AD_DESIGN, limited serving. Remove the CTA pill or button from the image; the placement adds its own call to action.
- **Clickbait wording** → limited serving. Typical triggers: headlines as questions, curiosity gaps, "near you" phrasing, "ask about prices", direct imperatives aimed at the reader's body or looks. Rewrite as plain statements of what is offered.
- **Non-English copy** (Arabic, for example) gets the same clickbait checks. Imperatives addressed to the reader ("try…", "ask about…", "near you") were the usual trigger; descriptive noun phrases passed.
- **Health and aesthetic treatments**: avoid before/after promises, guaranteed results and unapproved medical claims; make claims only if the product page states them.
- **"Exclusive", "No. 1", "official"**: only with proof on the landing page.
- **Fixing a limited RSA**: you can't edit it. Create a corrected ad PAUSED, enable it, then pause the old one.
- After any rewrite, check `ad_group_ad.policy_summary.approval_status` and `policy_topic_entries` a few hours later.
