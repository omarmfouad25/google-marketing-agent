# Measurement

Making sure the numbers bidding and reporting rely on are real.

- **"0 conversions" ≠ "no leads".** When conversion setup is broken, GA4 lead events by page and channel tell the real story. Always reconcile Ads conversions with GA4 before judging a campaign.
- **Check what each campaign bids on**: custom goal or category goals at campaign level, not just the account's primary actions.
- **Counting**: leads should count ONE_PER_CLICK; purchases MANY_PER_CLICK.
- **Primary vs secondary**: only actions that represent the business outcome should be primary; micro-conversions (scrolls, clicks) as secondary.
- **GA4 key events** must exist for each lead event you report on; link GA4 to Ads to import them.
- **GTM GA4 event tags don't forward dataLayer fields**: each parameter needs an event-settings row bound to a Data Layer Variable.
- **Live tag tests**: headless browser hits are filtered as bots by GA4 and can fail reCAPTCHA; network capture still proves tags fire. For an end-to-end proof, submit from a real browser profile and watch GA4 Realtime.
- **Success signal**: push the lead event only after the server confirms a real lead. `response.ok` alone isn't proof (spam honeypots return 200 on purpose): gate on an explicit marker in the success response, and fire on success, not on submit.
- **Dedup**: generate `event_id` once in the browser and send the same value to any server-side copy of the event.
- **Custom dimensions aren't retroactive**: register every reported parameter (`ga4_custom_dimensions`) before launch.
- **Codeless Ads actions** (created automatically from page rules) can't be edited through the API. Group them through a custom goal instead of fighting them. Reuse and rename existing actions (`ads_update_conversion_action`) to keep their history.
- **New Ads actions**: `ads_create_conversion_action` prints the conversion ID and label to paste into the GTM `ads_conversion_tag`.
- **Freshness**: GA4's last 2 days are incomplete. Before calling a drop, compare raw event counts, and only flag drops that persist beyond 48 hours.
- **Live-test method**: browser network capture of `/g/collect` (GA4) and the conversion label (Ads) proves a tag fired. A real-browser submission plus GA4 Realtime proves end to end. Mocking the form's success response tests the data-layer push without creating a lead; delete test leads after. Ad blockers drop hits, so one missing manual test isn't proof of breakage.
- **Consent**: default denied before any tag. Region logic fails closed: grant only on an explicitly allowed region, never "not the restricted one", and never persist a guessed region. `<noscript>` pixels can't be consent-gated; vendor pixels belong in GTM so they inherit consent.
- **Framework sites (single-page apps)**: fire page views on route change. If GA4 loads through GTM, the site pushes to `dataLayer` and never calls `gtag()` helpers.
