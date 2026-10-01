---
type: llm
weight: 1
---

Check each claim; the response passes only if all three hold.

1. It recommends the default (server) template, not the INSTANT template, because the app needs server-side logic (the external API call or the calculations).
2. It says the app is developed over Relay in the user's own workspace, and that Relay (the same pairing) can also run the app in production. Stating that production runs on Relay and that development and production use the same path or the same pairing satisfies this claim.
3. It describes pairing with `npm run pair` and then running the app with `npm run dev`, in that order. A command with an environment prefix, such as `env -u PORT npm run dev`, counts as `npm run dev`.
