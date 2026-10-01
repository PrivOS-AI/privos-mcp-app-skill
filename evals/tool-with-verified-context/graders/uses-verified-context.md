---
type: llm
weight: 1
---

The response explains that tools should get the caller from `context.actor` and the room from `context.roomId`, not from arguments. The response describes that the tool should refuse when there is no actor (fail closed). The response mentions tests for wrong-room scenarios (where arguments name another room) and missing-actor scenarios (where context.actor is undefined), checking that the tool properly validates the verified context.
