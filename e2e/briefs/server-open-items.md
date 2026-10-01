Build a PrivOS MCP app that tells a room how much work is still open.

- One tool returns the number of open items in the caller's room: items of the room's PrivOS
  Lists whose stage is not "Done". It answers only for the room it is called from.
- A room tab shows that number and refreshes it on demand.
- Reading the room's lists is optional: without that access the tool and the tab say that the
  count is unavailable instead of failing.
- No paid tier. Use the app id `com.acme.open-items` and the directory name `open-items`.
- You start inside an existing project repository.
- Nobody can answer questions during this task, and nobody can pair the app with a workspace
  now. Work locally, and finish with the report the skill asks for.
