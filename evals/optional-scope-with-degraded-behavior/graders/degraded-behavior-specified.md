---
type: llm
weight: 1
---

Check each claim; the response passes only if all three hold.

1. The permission entry in the manifest is marked optional with `"requirement": "optional"` (not `"required"`).
2. The same entry carries a `degradedBehavior` string that describes what the app still does, and what it cannot do, while the scope is not granted.
3. The entry has a `reason` that is at least 10 characters long, and the response does not suggest a `degradedBehavior` on a required permission.
