# Permission catalog

Every scope an app can declare, with the contexts in which it is valid. The table is
the catalog at version `2026-08-31`. The same data, in a form scripts read, is
in `permission-catalog.json` next to this file, and `scripts/preflight.mjs` checks the
manifest against it.

The marketplace checks each permission against its own copy of the catalog when a
version is uploaded and refuses a scope that is unknown, or used with a context or
execution context the row does not list. A workspace applies the same catalog when an
admin approves an app, so a mismatch also blocks a Relay install. If this table and
the workspace ever disagree, the workspace wins: say so in the report and ask the admin.

## How to read a row

- **Contexts**: the `context` of the permission in `privos-app.json`. `room` means the
  scope works only inside the room the app is opened in; `workspace` means it is granted
  across the workspace. A scope with both can use either.
- **Execution contexts**: the `executionContext` values the scope allows: `user`,
  `background` or `both`. The UI calls the host as the signed-in user, so a scope the UI
  uses needs `user` or `both`. A scope whose row lists only `background` (for example
  `bot:message:send`) cannot be used from the UI.
- One scope appears once per manifest, and every permission has its own `feature` id.
  See [manifest-and-scopes.md](manifest-and-scopes.md) for the permission fields.

## Scopes

| Scope | Label | Contexts | Execution contexts |
|---|---|---|---|
| `basic:information` | Basic information | workspace, room | user, background, both |
| `bot:identity:read` | Read this room's agent bot identity | room | user |
| `bot:message:send` | Send bot messages | room | background |
| `bot:room:join` | Add the agent bot to this room | room | user |
| `custom-permissions:read` | Read room custom permissions | room | user, background, both |
| `custom-permissions:write` | Set item access grants | room | user, background, both |
| `db:read` | Read app data | workspace, room | user, background, both |
| `db:schema:read` | Read app schemas | workspace, room | user, background, both |
| `db:schema:write` | Manage app schemas | workspace, room | user, background, both |
| `db:write` | Manage app data | workspace, room | user, background, both |
| `files:read` | Read files | workspace, room | user, background, both |
| `files:write` | Manage files | workspace, room | user, background, both |
| `firm-knowledge:admin` | Administer firm knowledge | room | user |
| `firm-knowledge:answer:run` | Run cited knowledge answers | room | user |
| `firm-knowledge:draft:write` | Propose knowledge drafts | room | user |
| `firm-knowledge:evidence:read` | Read firm knowledge evidence | room | user |
| `firm-knowledge:grants:write` | Manage firm knowledge content grants | room | user |
| `firm-knowledge:quality:report` | Report knowledge issues | room | user |
| `firm-knowledge:sop-approval:request` | Request SOP approvals | room | user |
| `firm-knowledge:sop-run:cancel` | Cancel SOP runs | room | user |
| `firm-knowledge:sop-run:read` | Read authorized SOP run state | room | user |
| `firm-knowledge:sop-run:start` | Start SOP runs | room | user |
| `firm-knowledge:sop-step:submit` | Submit SOP step output | room | user |
| `firm-knowledge:sop:read` | Read SOP versions | room | user |
| `firm-knowledge:workspace:answer:run` | Run workspace knowledge answers | workspace, room | user |
| `firm-knowledge:workspace:audience` | Manage content audiences | workspace, room | user |
| `firm-knowledge:workspace:connections` | Administer source connections | workspace, room | user |
| `firm-knowledge:workspace:curate` | Curate the knowledge library | workspace, room | user |
| `firm-knowledge:workspace:governance` | Administer product governance | workspace, room | user |
| `firm-knowledge:workspace:quality` | Manage quality and freshness | workspace, room | user |
| `firm-knowledge:workspace:read` | Use workspace knowledge search | workspace, room | user |
| `firm-knowledge:workspace:records` | Administer records decisions | workspace, room | user |
| `firm-knowledge:workspace:review` | Review and publish knowledge | workspace, room | user |
| `firm-knowledge:workspace:sop` | Administer and run SOPs | workspace, room | user |
| `lists:query` | Query list items | workspace, room | user, background, both |
| `lists:read` | Read lists | workspace, room | user, background, both |
| `lists:write` | Manage lists | workspace, room | user, background, both |
| `messages:read` | Read messages | room | user |
| `messages:send` | Send messages | room | user, background, both |
| `notifications:write` | Send notifications | room | user, background, both |
| `rooms:read` | Read rooms | workspace, room | user |
| `rooms:roles:read` | Read the caller's own room and workspace roles | room | user |
| `rooms:write` | Manage rooms | workspace, room | user |
| `sandbox:agent-sets:upload` | Upload agent sets | workspace | user |
| `sandbox:ai-chat` | Read AI chat | room | user |
| `sandbox:ai-chat:write` | Use AI chat | room | user |
| `sandbox:botkey:push` | Provision sandbox bot key | room | user |
| `sandbox:generate` | Run sandbox agent | room | user |
| `sandbox:skills:use` | Manage room skills | room | user |
| `sandbox:wake` | Wake sandbox | room | user |
| `users:read` | Read users | workspace, room | user |

## Choosing scopes

- Declare only what a tool or the UI calls. A smaller grant is easier for an admin to
  approve.
- Reads are separate from writes (`lists:read`, `lists:write`), and filtered queries
  have their own scope (`lists:query`), because a query is a POST.
- Make a scope `optional` when the app is still useful without it, and write the
  degraded behavior the UI and tools really have.
- The host tool behind each UI hook, and the scope it needs, is in
  [ui.md](ui.md#hooks-and-the-scopes-they-need) and in `host-tools.json`.

Source: the PrivOS permission catalog. Public description of the scopes:
[API overview](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/apis/README.md).
