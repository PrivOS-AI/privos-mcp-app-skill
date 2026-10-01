# End-to-end briefs

Each brief in `briefs/` asks an agent to build a complete app with this skill. A run is
judged by checks that do not trust the agent: the skill's own preflight script in a clean
environment, the app id, the template's `pair` and `dev` scripts, and that no pairing
identity file is tracked.

Run a brief safely:

- **In a container, never on your machine.** The agent writes and runs code. Use a container
  with no bind mounts and no docker socket, with memory, CPU and process limits, and remove it
  afterwards.
- **With a dedicated credential.** Create a token for the run (`claude setup-token`) and pass
  it to the container as `CLAUDE_CODE_OAUTH_TOKEN` through an env file with mode 600. Never
  copy your Claude login file into a container: it holds a refresh token shared by every
  session on your machine, and using it elsewhere can log them all out. Revoke the token when
  you are done.
- **With a budget.** Start the agent with `claude -p --plugin-dir <this repository>` and set
  `--max-turns` and `--max-budget-usd`.
- **Verify outside the agent.** Copy the work directory out, install it in a fresh container
  without the token, and run `node skills/privos-mcp-app/scripts/preflight.mjs <app>`.

`server-open-items.md` starts inside an existing git repository on purpose: the skill must
create the app as its own repository instead of nesting it.
