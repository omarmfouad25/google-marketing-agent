---
status: accepted
---

# Writes are bounded by Profile scope; reads stay Login-wide

`"writes": true` on a Profile used to unlock writes on anything the Login could reach while that Profile was selected, so the `container` parameter of the GTM write tools could edit another client's container. That quietly broke the promise that an agency can allow changes on one client and keep another read-only. From 0.4 a write is allowed only on a resource listed in the Profile scope: its Google Ads accounts, GA4 properties, Search Console sites and GTM containers. A Profile scope may list several of each, so one client with a web and a server container stays one Profile with one Change log. Reads stay Login-wide, because setup and audits need to discover resources across the Login, and a wrong-client read costs a correction while a wrong-client write costs money.

## Consequences

- Breaking for anyone who wrote to a container outside the selected Profile. They get a refusal naming the Profile to add it to, and the CHANGELOG for 0.4 explains the migration.
- The singular profile fields (`gtmContainerId`, `ga4PropertyId`, ...) keep working as shorthand for a one-item list.
