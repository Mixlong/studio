# DigiwiseStudio MCP integration

An opt-in local MCP server for LVGL project inspection and controlled editing.
The private authenticated socket is never exposed as a public MCP transport;
Codex, MCP Inspector and other clients connect through the official MCP
TypeScript SDK v2 Stdio entry.

## Enable in DigiwiseStudio

1. Open **Settings → Integrations → MCP Server**.
2. Turn on MCP Server. AI may read the current project and **request edits**.
   Each write requires explicit confirmation in DigiwiseStudio, either **Allow once**
   or **Allow for this session**. There is no second write-access switch.
3. Click **Add to Codex** to append a `digistudio` MCP entry to the
   Codex user-level `config.toml`. Existing settings and other MCP
   entries are preserved; a conflicting `digistudio` entry is not replaced.
4. Restart Codex, open an LVGL project, and use the supported MCP tools.
   One-click import can migrate the project's earlier development registration
   to the installed executable after backing up existing Codex configuration.

MCP requests also require an **active DigiwiseStudio/迪太云 IDE login**.
When signed out, disabled, or expired, Main rejects both reads and writes with
`AUTH_REQUIRED`, including Main-owned `create_project`; no project is written.
Signing out invalidates in-memory session grants, and signing in again requires
new consent even for the same user. A login change while the approval dialog is
open cancels that write rather than forwarding it.

Main and Renderer use a version-checked readiness handshake. Until the actual
MCP renderer agent registers, Main returns `IPC_UNAVAILABLE` promptly instead of
counting initialization as a dead renderer IPC timeout. The protocol registry
version changes for this handshake/auth ABI, even though tools remain 19 read
and 37 write.

The MCP server enabled switch persists between launches, but **write approval
and all session grants reset on every IDE restart**. Turning the server off
immediately revokes its grants and stops the bridge, without removing Codex.

Approval uses a **Main-owned, sandboxed, theme-aware DigiwiseStudio modal**, not
an Electron system MessageBox or a project-controlled renderer dialog. It displays
the full validated MCP tool name and escaped, formatted arguments in a scrollable
region without ellipses; the session-scope warning and all three buttons remain
visible. Close, Esc, parent destruction, crash or MCP shutdown means **Deny**.
Only the secure modal WebContents main frame may submit approval IPC; the
current project renderer cannot issue or forge a permission grant. Colors adapt
to the stored light/dark theme. See the safety tests
`test-approval-view.cjs` and `test-approval-dialog.cjs`.

Release gate: `npm run verify-mcp-product` runs strict TypeScript/Gulp build,
MCP protocol/authorization regressions, Windows packaging/ASAR integrity,
real isolated Electron approval-button tests and a fresh-profile full IDE
security smoke test. The isolated test creates **its own temporary Windows
userData**, checks that signed-out MCP reads/writes are denied, and terminates
only its own test process. It does **not** substitute for authenticated,
project-assigned user E2E. See `docs/mcp-product-acceptance-2026-11-12.md`.

Existing Codex configuration is
backed up before import; `CODEX_HOME` is respected.

Developer alternative (environment variable):

```powershell
$env:DIGISTUDIO_ENABLE_MCP = "1"
npm start
```

In another terminal:

```powershell
npx @modelcontextprotocol/inspector node build/mcp/stdio-cli.mjs
```

All registered read tools use an 8.5-second client timeout; write tools use a
195-second client timeout to accommodate the local 125-second approval dialog.
`test-bridge.cjs` asserts this classification for the full registry.

For actual (potentially destructive) standalone-project E2E acceptance, use
`node packages/mcp/test-live-e2e.mjs --execute` only after turning on MCP Server
and approving the write request in the local dialog. It never changes the previously active project;
run directories and JSON result reports are stored under
`artifacts/mcp-acceptance/`. After a normal IDE restart/reopen, run
`node packages/mcp/test-live-reopen.mjs <absolute-demo-project-path>` for
read-only persistence verification. These tests are intentionally NOT part of
`npm run verify-mcp` because they require explicit local user authorization.

Default mode does **not** start a listener. All socket requests use a
random endpoint and per-process 256-bit secret, stored at
`app.getPath("userData")/mcp-session.json` (owner-only permissions on
Unix). Only the active main-window renderer can respond. Requests time
out, and connections/sessions are closed with the application.

**Full IDE restart is required when MCP tools change:** A hot-reloaded renderer
can advertise new tools while the old Electron Main process still rejects them.
The Main writes a tool-registry version into its session metadata, and the
Stdio bridge checks it before every request. If versions differ, the client
fails with an explicit save-and-restart message rather than falsely advertising
new functionality. Update `MCP_TOOL_REGISTRY_VERSION` in `protocol.ts` and
`EXPECTED_REGISTRY_VERSION` in `bridge-client.mjs` together whenever the
registered MCP tool set changes.

For a packaged app, the CLI can use the bundled Electron Node runtime via
`ELECTRON_RUN_AS_NODE=1`, **provided the production build keeps the
runAsNode fuse enabled**. The script path must point to the actual
packaged resource (typically under `resources/app.asar/build/mcp/`).
Verify this on real installers before publishing a client config. Do not
configure an external `node` dependency for end users.

Tools:
- `get_mcp_capabilities`: machine-readable AI workflow, tool coverage and explicitly unsupported operations, even when no LVGL project is open (widget palette discovery needs an open LVGL project). Call first; do not assume every editor feature is available through MCP.
- `get_current_project`: path, project type, LVGL version, display size, tab state.
- `get_preview_status`: native WASM Runtime state (idle/starting/running/paused/stopped/error), selected page name/**selectedPageId**, preview-frame readiness and bounded error. Does not itself export runtime pixels.
- `get_preview_snapshot({ pageId })`: read-only actual **running local WASM framebuffer** PNG from the native runtime's bound, uniquely visible Canvas. Requires `selectedPageId` freshly returned by `get_preview_status`; limited to the selected LVGL page, cropped/scaled to 1024px and bounded base64 size. Never captures OS windows, user account UI, other project tabs or Docker simulator. A captured frame verifies the runtime rendered pixels, not that a particular Flow action succeeded.
- `get_canvas_snapshot({ pageId })`: returns the **actual current LVGL editor page pixels** as an MCP PNG image plus bounded metadata. Call `get_active_page` immediately beforehand and pass the matching `pageId`. Only a unique visible native LVGL canvas from the same project can be captured; no desktop/window/account/settings/other tab capture. Native device dimensions are cropped from expanded preview and large canvases scaled down to <=1024 pixels per edge (PNG base64 <=1,350,000 chars). Run Mode, stale page identities, hidden/ambiguous canvases and failed drawing return an explicit error. This is **not** an interactive simulator or proof of working Flow runtime.
- `list_pages`: page names, dimensions and component count.
- `list_widgets`: hierarchical LVGL widgets and a safe allowlist of scalar
  properties; the response is capped. It intentionally does not export every
  advanced widget property or executable event handler.


Additional read-only tools (current build):
- `list_styles`: hierarchical LVGL Styles, default styles, stable `stylePath` arrays.
- `get_style({ stylePath })`: selected Style definition; only bounded literal
  scalar values are returned. Expressions and complex internal objects are omitted.
- `list_assets`: font and bitmap metadata; no embedded images or font data.
- `get_widget_details({ pageName, widgetPath })`: one widget's geometry,
  named style, local literal style values and event bindings.
- `list_widget_events({ pageName })`: all event bindings on a named page,
  with safe action references (no scripts).
- `list_widgets` now includes `widgetPath` arrays for unambiguous lookup of
  duplicate and unnamed widgets; the original fields are preserved.

Preview control: `start_preview({ expectedProjectPath })` starts the editor's existing local WASM runtime only when the saved LVGL project has no unsaved changes. `stop_preview({ expectedProjectPath })` returns to edit mode. Both use the usual local approval dialog. While WASM is running, other MCP project edits are denied except for `stop_preview` and the dedicated `preview_tap({ expectedProjectPath, pageId, x, y })`. Tap requires local approval and exact current preview page ID. It queues one native press/release in page coordinates (within page bounds; >=300ms between taps), without driving the desktop cursor. After a tap/page transition, wait for the new page's framebuffer to settle and compare at least two snapshots; `get_preview_status.selectedPage` can change before the Canvas has finished drawing the new page. A changed PNG hash alone could reflect only the button's pressed styling. `frameVerified` means the framebuffer is readable, **not** that a navigation transition has settled. This does not support drag, multi-touch, keyboard input, Docker simulator, device flashing or Toolchain control.

For conditional Flow and Action-call acceptance, run `npm run verify-mcp-live-advanced` against a normally running DigiwiseStudio with MCP Server enabled. It creates a fresh isolated LVGL 8.4 demo and exercises IsTrue false/true branches, SetVariable, CallAction, two navigation destinations, real stable WASM PNG frames, Check and Build. **Requires local approval; never run unattended or against a pre-existing user project.** See `docs/mcp-p0-advanced-flow-status-2026-11-11.md` for exact acceptance status.

The `get_mcp_capabilities.widgetAuthoring` contract lists the 11 safe `add_widget` creation fields, and guides AI to use `get_widget_schema` followed by `set_widget_property` and `set_widget_local_style` for version-specific properties. Creation fields and subsequent schema-driven edits are different capabilities; not all palette widgets/properties are fully covered.

Run `npm run verify-mcp-live-flow` for a **new isolated** LVGL 8.4 Flow project under `artifacts/mcp-acceptance/`. It creates a button, page navigation Flow and event binding through authenticated, locally approved MCP writes, saves the project, verifies actual WASM click navigation and two stable visual frames (>=3% changed pixels in the controlled demo), then stops runtime, runs Check/Build and verifies native C/H outputs and unchanged project state. Do not include it in unattended CI because it requires an IDE and local approval.

After rebuilding, **restart DigiStudio** so its main and renderer processes
use the updated allowlist. Codex also needs to reconnect to discover the new
tools. To test against the running editor (no write operations):

```powershell
npm run verify-mcp-live
```

The original `npm run verify-mcp` is an automated mock/stdio test (including editor/preview PNG
transport and native pointer queue tests) and does not verify the already-running Electron process.
For safe real preview acceptance against a separately saved project under
`artifacts/mcp-acceptance/`, run `node packages/mcp/test-live-preview-interaction.mjs --execute`
only with local authorization; this saves pre/post PNG and a hash report but does
not assume a tap changed app state. `npm run verify-mcp-packaged` additionally
compares critical ASAR scripts byte-for-byte with compiled build files to catch
corrupted Windows packs.
After a safe IDE restart, open a real LVGL page and run `get_active_page` followed
by `get_canvas_snapshot` to verify the actual GUI pixel buffer and compare it
against widget bounds and styles. Repeating the snapshot after a permitted edit
can reveal visual regressions, but cannot by itself validate Preview/Download.

## Widget property coverage

Use `get_widget_schema({ pageName, widgetPath })` before editing. It exposes
safe editable scalar and Enum properties from the actual editor ClassInfo,
supported LVGL parts/states and allowed Bitmap references. Then call
`set_widget_property({ expectedProjectPath, widgetPath, widgetId, property, value, pageName? })`
or `set_widget_local_style({ expectedProjectPath, widgetPath, widgetId, part, state,
property, value, pageName? })`. If `pageName` is omitted, the active canvas
page is resolved when the request executes. Invalid or unavailable targets
fail closed instead of changing a different screen.

Switch appearance is controlled by MAIN/INDICATOR/KNOB Styles, not an
invented icon field. To display a picture/icon, use an `LVGLImageWidget`
referencing an existing named Bitmap (add as a child of a Button or
sibling overlay, not as a child of a Switch). Import new PNG/JPEG assets through
`import_bitmap` from the saved project directory. Arbitrary scripts and event
code are not exposed in this restricted safe property API.

## Safe reference and history rules

- `list_widgets` and `get_widget_details` return `widgetId` (the editor's `objID`);
  `list_styles` and `get_style` return `styleId`.
- Existing widget mutations require **both** the current `widgetPath` and
  matching `widgetId`; nested inserts additionally require `parentId`.
  Global Style writes require both `stylePath` and `styleId`.
  If a path has moved, the editor rejects the request instead of silently
  editing the wrong object. Re-read the page or Style and retry.
- Undo/redo through MCP operates on MCP-created history entries only.
  If a user manipulates history in the editor, MCP refuses to undo/redo
  until another MCP editing transaction establishes a new checkpoint.
- The public Style API uses the same validated LVGL property catalog,
  widget Part and State rules as local Style writes. Unknown properties and
  invalid states are rejected.
- `get_active_page` reads the open canvas page. `list_variables` and
  `list_actions` expose names and metadata only (no scripts or secret values).

## Controlled write tools

Existing-project edits require **expectedProjectPath**, the saved path from
`get_current_project`. If the active tab changes, the request fails instead of
editing a different project. The new `create_project` tool does not require an
active project, because it creates a separate file from a bundled UI template.

- `create_project({ projectPath, lvglVersion?, flowSupport?, displayWidth?, displayHeight?, openWhenDone? })` — creates an independent LVGL project using the same EmptyUI template as the GUI wizard. The destination must be an absolute `.eez-project` filename in an **existing local directory**. It never overwrites existing files. By default, the editor receives an open-project request after creation.
- `create_page({ expectedProjectPath, name, width?, height? })`
- `rename_page({ expectedProjectPath, pageName, pageId, name })` — renames a user page, updates ClassInfo-backed references and initial page; one Undo transaction.
- `delete_page({ expectedProjectPath, pageName, pageId })` — refuses the last page, initial page or referenced pages; one Undo transaction.
- `create_style({ expectedProjectPath, name, widgetType })` — creates a named top-level LVGL Style.
- `rename_style({ expectedProjectPath, stylePath, styleId, name })` — renames Style and updates widget/default references in one Undo transaction.
- `delete_style({ expectedProjectPath, stylePath, styleId })` — refuses removal if Style is referenced, default, or has child Styles.
- `set_default_style({ expectedProjectPath, stylePath, styleId, enabled })` — sets or clears a type's default Style.
- `import_bitmap({ expectedProjectPath, filePath, name })` — imports a PNG/JPEG <= 10 MiB using the editor's Bitmap loader, restricted to the saved project directory (including realpath symlink checks). Requires prior write approval.
- `create_variable({ expectedProjectPath, name, type, initialValue? })` — creates typed global variables in Flow-enabled projects; scalar initial value only.
- `create_action({ expectedProjectPath, name })` — creates an empty named Flow Action; binding it to an event does not implement the action's body.
- `get_action_graph({ actionName, actionId })` — inspect a Flow Action's nodes, ports, and connections; get actionId from `list_actions`.
- `add_action_node({ expectedProjectPath, actionName, actionId, nodeType, left, top, name?, milliseconds?, variableName?, value?, conditionVariableName?, conditionValue?, targetActionName?, screenName? })` — add Start/NoOp/End/Delay/SetVariable/IsTrue/CallAction/LVGL screen-change nodes with Undo. IsTrue accepts exactly one boolean literal or existing boolean global variable. CallAction requires a distinct existing Flow Action with Start/End and no custom ports; recursive calls are rejected. Screen-change only targets a named user page and uses fixed safe animation defaults. No arbitrary scripts.
- `connect_action_nodes({ expectedProjectPath, actionName, actionId, sourceId, targetId, output? })` — connect `@seqout` (default) or IsTrue's `True`/`False` branch output to `@seqin`, with identity, occupied-port, sequence-cycle checks and Undo.
- `disconnect_action_line({ expectedProjectPath, actionName, actionId, lineId })` — remove a line with Undo.
- `delete_action_node({ expectedProjectPath, actionName, actionId, nodeId })` — remove a Flow node and all attached lines atomically with Undo.
- `bind_widget_variable({ expectedProjectPath, widgetPath, widgetId, property, variableName, pageName? })` — binds an expression-capable widget property to an existing, type-compatible global variable.
- `unbind_widget_variable({ expectedProjectPath, widgetPath, widgetId, property, value, pageName? })` — restores a validated literal to a bound widget property.
- `add_widget({ expectedProjectPath, widgetType, properties, pageName?, parentPath?, parentId? })`
- `update_widget({ expectedProjectPath, widgetPath, widgetId, properties, pageName? })`
- `reorder_widget({ expectedProjectPath, widgetPath, widgetId, anchorPath, anchorId, position, pageName? })` — before/after a sibling in the same parent collection; one Undo transaction, rejects cross-container moves.
- `duplicate_widget({ expectedProjectPath, pageName?, widgetPath, widgetId, newIdentifier, left?, top? })` — safely clones a leaf LVGL widget with fresh IDs and a unique identifier, reuses local style/event config, and inserts immediately after the source; supports Undo.
- `move_widget({ expectedProjectPath, sourcePageName, widgetPath, widgetId, targetPageName, targetParentPath?, targetParentId? })` — safe cross-page/cross-container reparent with cycle and identity guards; one Undo transaction, no direct array mutation.
- `delete_widget({ expectedProjectPath, widgetPath, widgetId, pageName? })`
- `set_style_property({ expectedProjectPath, stylePath, styleId, part, state, property, value })`
- `set_widget_property({ expectedProjectPath, widgetPath, widgetId, property, value, pageName? })`
- `set_widget_properties({ expectedProjectPath, widgetPath, widgetId, properties, pageName? })` — validates all 1–32 properties against the live widget schema, then applies one atomic Undo transaction.
- `set_widget_local_style({ expectedProjectPath, widgetPath, widgetId, part, state, property, value, pageName? })`
- `add_widget_event({ expectedProjectPath, widgetPath, widgetId, eventName, actionName, userData?, pageName? })` — binds an existing Action to an event listed by `get_widget_schema.availableEvents`, with undo support; no script generation.
- `remove_widget_event({ expectedProjectPath, widgetPath, widgetId, eventId, pageName? })` — removes only Action-type event bindings (eventId from `list_widget_events`), preserving Flow connections.
- `start_project_check({ expectedProjectPath })` — requests the editor's asynchronous source validation without generating build files; requires local write approval.
- `get_project_check_status({})` — read task status, errors, warnings and bounded editor output; useful for AI edit → check → fix loops.
- `start_project_build({ expectedProjectPath })` — starts the editor's existing Build asynchronously after checking output directory, template filenames, symlink ancestry, and previous build manifest; requires user confirmation and must remain inside the saved project directory.
- `get_project_build_status({})` — poll build status and bounded output messages; completed task results are kept separate from later checks.
- `save_project({ expectedProjectPath })`
- `undo({ expectedProjectPath })` and `redo({ expectedProjectPath })`

Creatable widget types are discovered dynamically from the editor's registered
LVGL palette for the current project and version, rather than a fixed 11-type
list. Screen root and internal UserWidget classes remain blocked. Initial widget
creation accepts a small validated field set; after creation use
`get_widget_schema` + `set_widget_properties` for supported additional fields.
No arbitrary JavaScript, event script editing, project-external file writes or
OS commands are exposed.

Existing-project writes check the saved-project identity. MCP Server must be
running, and writes require a local confirmation offering **Allow once** or
**Allow for this session**. Session grants are memory-only, revoked when MCP
Server is turned off or DigiStudio exits.
Writes are serialized. The adapter calls ProjectStore editing APIs and groups
individual operations with UndoManager transactions; it cannot undo unrelated
manual edits. It rejects Run Mode and
read-only projects. Turning the MCP server off revokes write permission.

## Tests and release checks

```powershell
npm run build-src
npm run verify-mcp           # unit, MCP, socket/IPC, safety and Codex config tests
npm run verify-mcp-live      # requires the restarted, enabled DigiStudio IDE
npm run pack                 # Windows unpacked release
npm run verify-mcp-packaged  # real packaged .exe / app.asar MCP handshake
```

For packaged Windows clients, click **Add to Codex** from the installed
DigiwiseStudio app (not the development build). The configured executable
and ASAR script path are then derived from the running installation.

Security: read access exposes the current project to authorized local
clients. Write access is OFF on every application launch and must be
re-enabled manually. This is a local, single-user MCP service; it does not
support remote access, multi-user authorization, or arbitrary project writes.
The renderer bridge is compiled by the main application build, so source
separation does not yet imply independent TypeScript compilation.
