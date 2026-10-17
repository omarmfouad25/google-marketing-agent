---
status: accepted
---

# Confirmations are bound to a Preview, and human-approved where the client allows

Up to 0.3, "preview first, apply on your yes" was a habit the skills taught the agent: any write tool called with `confirm: true` applied immediately, whether or not a Preview had been shown, and the server never saw a human's yes. From 0.4 the server enforces it. A Confirmation must carry a Preview that the server issued for exactly that request. The Preview is used up by one Confirmation or one refusal, expires after 15 minutes, lives only in memory, and is void if the state it read (current budget, GTM workspace fingerprint, live version) has changed since. When the client supports MCP elicitation, the server also asks the human directly, once per Change, before applying. We design and test against Claude Code first because elicitation is confirmed to work there.

## Considered Options

- **Agent discipline only** (the 0.3 behaviour): rejected because the README's central promise was then only as strong as the agent's prompt-following.
- **Refuse writes unless the human can be asked**: rejected as the default because Claude Desktop, scripts and other clients without elicitation would lose writes entirely. It is kept as an opt-in per Profile (`requireHumanApproval`).
- **Elicit only for risky Changes**: rejected because any risk list becomes a permanent argument; one prompt per Change is the simpler rule.

## Consequences

- Every Change log entry records how it was confirmed: human-approved or preview-matched.
- A declined or cancelled prompt uses up the Preview and returns `DECLINED by the user (nothing changed)`; tools tell the agent not to retry unless the user asks again.
- Each tool call is its own Change with its own prompt, so a weekly check that proposes three kinds of change asks three times. A bundled "Change set" was deliberately left out until real use asks for it.
- A server restart drops pending Previews; the agent previews again.
