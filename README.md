# dsh-session-pin

Pin DeepSeek Harness sessions into a dedicated group at the top of the sidebar, the way Codex does it: the group sits **below the "New session" button and above the workspace list**, and leaves the native workspace lists untouched.

[中文说明](README.zh.md)

## Interactions

| Action | Entry point |
| --- | --- |
| Pin a session | **Right-click** any native session row → "Pin session" |
| Unpin | The **✕** on a pinned row, or right-click the pinned row → "Unpin session" |
| Open a session | Click a pinned row (routes through `uiWorkspace.openSession`, the same navigation entry the native rows use) |
| Collapse / expand the group | Click the group header; the state is stored in `localStorage` |

Labels follow the document language: Chinese when the UI language is Chinese, English otherwise.

### Status dots

Each pinned row carries the same primary status indicator as a native row, so a pinned session never hides that it is busy:

| Indicator | Meaning |
| --- | --- |
| Spinning ring | The agent is working on a turn |
| Amber dot | The session waits for you — approval, plan review, or a question |
| Green dot | Finished while you were not looking |
| *(nothing)* | Idle |

Precedence matches the native rows: a pending interaction outranks activity. The group repaints on both stores — the session list (the `running` bit) and the pending-interaction store — so the indicator appears and clears on its own.

The spinner reproduces the shell's own status dot (same `data-state` contract, same track/arc geometry, same 1.5 s rotation, and it stops under `prefers-reduced-motion`); the primitive package is not a runtime-resolvable dependency for third-party plugins, so the shape is rebuilt locally rather than imported.

The pinned set is persisted in `<DSH_HOME>/dsh-session-pin.json` (default `~/.dsh/dsh-session-pin.json`), so it survives restarts and profile reloads.

## How it works

The DSH sidebar shell declares six slots — `sidebar.brand.mark`, `sidebar.brand.name`, `sidebar.panellist`, `sidebar.workspaces`, `sidebar.settings`, `sidebar.footer.action` — and **none of them is the position this plugin needs**. `sidebar.workspaces` is a single-occupant slot already owned by `ui-workspace`, so claiming it would mean reimplementing the whole workspace browser (search, drag, management).

Instead the plugin uses the approach established by other sidebar-family plugins: a plain DOM node inserted immediately before the workspace region inside the sidebar root, healed by a `MutationObserver` when React re-renders. It never participates in the React tree.

- **Host half** (`lib/index.js`) — single source of truth for the pinned set, plus the `/dsh-session-pin/{state,pin,unpin,reorder}` JSON routes. Writes go through a temp file + rename.
- **Client half** (`client/client.js`) — renders the group and owns its interactions. Row titles and timestamps are read from the live `sessions.list` snapshot (titles are never cached), and opening a session goes through `uiWorkspace.openSession`.

Ids of deleted sessions stay in the file and are skipped at render time, so deleting a session never corrupts the pinned set.

## Install

The package declares both `dsh.bundle.patch` and `dsh.client`, so the official **bundle dependency** path is enough: install it as a profile dependency and its own patch is mounted as a bundle layer. **Do not also hand-write an `insert` row in the profile's `cordis.patch.yml`** — two inserts sharing the `dsh-session-pin` id fail the boot with `duplicate loader entry id`.

```bash
dsh plugin --profile <name> add link:/path/to/dsh-session-pin
```

Or edit the profile manifest by hand:

```json
{
  "dependencies": { "dsh-session-pin": "link:/path/to/dsh-session-pin" },
  "dsh": { "profile": { "bundles": ["…", "dsh-session-pin"] } }
}
```

then:

```bash
cd ~/.dsh/profiles/<name> && pnpm install --ignore-scripts
```

Both entries matter: `dependencies` makes the package resolvable, `dsh.profile.bundles` makes its patch layer load. (`dsh plugin add` writes both for you.)

The plugin depends only on the `webServer` and `uiWorkspace` services, so any profile that boots the web UI works.

After installing, restart the app (or the host). The route `/dsh-session-pin/state` returns 200 and the pinned group appears once the sidebar renders.

> The `desktop` profile is managed exclusively by the Electron app (`dsh --profile desktop` refuses with `managed exclusively by the Electron application`). Install there through the in-app Plugins page, or edit the two files above directly. A page refresh is not enough — the running host does not re-read `dsh.profile.bundles` or `node_modules`.

## Known limitations

- A session id can only be read off a native row through the React fiber (`memoizedProps.node.id`), which is an undocumented interface. If upstream changes the row structure, the context-menu entry goes inert (silently, without throwing); pinned rows keep working.
- The group is hidden while the sidebar is in its collapsed rail.
- Drag-to-reorder is not implemented. The `/reorder` route exists but no UI calls it.

## License

[MIT](LICENSE)
