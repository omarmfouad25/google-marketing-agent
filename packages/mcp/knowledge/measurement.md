# Measurement

Making sure the numbers bidding and reporting rely on are real.

- **"0 conversions" ≠ "no leads".** When conversion setup is broken, GA4 lead events by page and channel tell the real story. Always reconcile Ads conversions with GA4 before judging a campaign.
- **Check what each campaign bids on**: custom goal or category goals at campaign level, not just the account's primary actions.
- **Counting**: leads should count ONE_PER_CLICK; purchases MANY_PER_CLICK.
- **Primary vs secondary**: only actions that represent the business outcome should be primary; micro-conversions (scrolls, clicks) as secondary.
- **GA4 key events** must exist for each lead event you report on; link GA4 to Ads to import them.
- **GTM GA4 event tags don't forward dataLayer fields**: each parameter needs an event-settings row bound to a Data Layer Variable.
- **Live tag tests**: headless browser hits are filtered as bots by GA4 and can fail reCAPTCHA; network capture still proves tags fire. For an end-to-end proof, submit from a real browser profile and watch GA4 Realtime.
