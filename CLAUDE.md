# FlowGraph — CLAUDE.md

Built completely with **Claude Code**. Authored by **Giang Tran**.

---

## What this app is

FlowGraph is a browser-based interactive dependency flowchart viewer and editor.
Users load, create, and edit directed acyclic graphs (DAGs) stored as JSON files.
No server required — runs entirely in the browser and can be hosted on GitHub Pages.

---

# USAGE LIMIT SURVIVAL

/model sonnet
One feature maximum per session
/cost every 3 prompts
/compact after each feature
/clear between features

# MISTAKE HANDLING

When wrong: "Update CLAUDE.md with this rule"

## Commands

```bash
npm run dev           # Vite dev server (hot reload)
npm run build         # tsc + vite build → dist/
npm run preview       # preview the production build locally
npm run lint          # ESLint over src/
```

The only build command needed before committing is `npm run build`. If it passes
TypeScript compilation (`tsc`) and Vite bundling with no errors, the code is ready.

---

## Tech Stack

| Layer     | Choice                                                                              |
| --------- | ----------------------------------------------------------------------------------- |
| UI        | React 18 + TypeScript                                                               |
| Build     | Vite 5                                                                              |
| State     | Zustand (single store, no providers)                                                |
| Styling   | CSS Modules + global CSS variables                                                  |
| Rendering | Native SVG (no D3/Cytoscape)                                                        |
| File I/O  | File System Access API (Chrome/Edge) with `<input type="file">` / download fallback |

---

## Project Structure

```
src/
├── App.tsx                     Root layout: Header | (Sidebar + Canvas + Inspector)
├── App.module.css
├── main.tsx
├── styles/
│   └── global.css              CSS custom properties (design tokens) + keyframes + print CSS
├── types/
│   ├── graph.ts                All TypeScript interfaces: GraphNode, GraphEdge, GraphPhase, Transform, …
│   └── fileSystem.d.ts         File System Access API type stubs (showOpenFilePicker, showSaveFilePicker)
├── store/
│   └── graphStore.ts           Single Zustand store — ALL app state and actions live here
├── utils/
│   ├── layout.ts               DAG layout (Sugiyama-style) + lane layout algorithms
│   ├── grouping.ts             Group hierarchy queries, connectivity validation, polygon geometry
│   ├── colors.ts               Owner → hex color assignment
│   ├── exportJson.ts           JSON serialization: buildExportPayload() + exportGraphToJson()
│   └── exportPdf.ts            SVG-based PDF export via window.print() — current view or full chart
├── adapters/
│   ├── adapterInterface.ts     GraphAdapter base interface (load / save)
│   ├── fileAdapter.ts          Local JSON file adapter
│   └── sharepointAdapter.ts    SharePoint/OneDrive stub (Microsoft Graph API)
└── components/
    ├── Header/                 File ops, search, view toggle, save/save-as/export, design mode
    ├── Canvas/                 SVG canvas, pan/zoom, NodeCard, EdgeLayer, GroupCard, LaneLayer, GhostEdge, MiniMap,
    │                           PhaseLayer (vertical bands), PhaseNavigator (floating pill bar)
    ├── Panels/                 Sidebar (owner filter) + Inspector (selected node/group/phase details)
    ├── DesignMode/             DesignToolbar + NodeEditModal + GroupEditModal + PhaseEditModal
    └── Modals/                 UserGuideModal (Shift+?), HelpModal
```

---

## Architecture Rules

### State

- **All state lives in `graphStore.ts`**. No component-level state for graph data.
- Components call store actions; actions update state; React re-renders.
- Never mutate store state directly from a component.

### JSON Format

```json
{
  "nodes": [
    {
      "id": "STEP-01",
      "name": "Step name (≤60 chars)",
      "owner": "Team name (determines swim lane + color)",
      "description": "1–3 sentences.",
      "dependencies": ["ID-OF-PREREQ"]
    }
  ],
  "_layout": {
    "currentView": "dag",
    "dag":   { "positions": { "STEP-01": { "x": 0, "y": 0 } }, "transform": { "x": 0, "y": 0, "k": 1 } },
    "lanes": { "positions": { ... }, "transform": { ... } }
  },
  "groups": [
    {
      "id": "GROUP-01",
      "name": "Group name",
      "description": "Optional description.",
      "owners": ["Team name"],
      "childNodeIds": ["STEP-01", "STEP-02"],
      "childGroupIds": [],
      "collapsed": false
    }
  ],
  "phases": [
    {
      "id": "PHASE-01",
      "name": "Discovery",
      "description": "Optional detail.",
      "color": "#4A90D9",
      "nodeIds": ["STEP-01", "STEP-02"],
      "sequence": 0
    }
  ]
}
```

Legacy format (plain `[ ... ]` array, no `_layout`) is still accepted on load.
Files without a `phases` key load fine — phases defaults to `[]`.

### Serialization

`buildExportPayload()` in `exportJson.ts` is the **single source of truth** for
serialization. Both the download path and the File System Access API in-place
write path call this function. Never duplicate the serialization logic.

### File I/O modes

| Mode                     | When                                                                  | Save behaviour                                  |
| ------------------------ | --------------------------------------------------------------------- | ----------------------------------------------- |
| **Linked** (teal chip)   | Opened via `showOpenFilePicker` / `showSaveFilePicker` in Chrome/Edge | Writes directly to file on disk — no download   |
| **Unlinked** (gray chip) | Opened via `<input type="file">` (Firefox/Safari) or new flowchart    | Downloads a copy to the user's Downloads folder |

After **Save As**, the returned `FileSystemFileHandle` replaces the old handle and
`currentFileName` is updated to the new filename — so subsequent saves go to the
new location.

### PDF Export

`exportPdf.ts` exports via `window.print()`. Signature:

```ts
exportToPdf(mode: 'current' | 'full', positions?, _ownerColors?, _nodeOwnerMap?, _transform?, viewMode?)
```

Steps (all DOM changes are reverted in `afterprint`):

1. **JS-based DOM isolation** — walks up from `#canvas-wrap` to `<body>`, hides all siblings at every level with `visibility:hidden`. Forces `#canvas-wrap` to `position:fixed; inset:0; background:#fff; z-index:99999`. Restoring is done by reverting inline styles. This is more reliable than `@media print` CSS for hiding the sidebar/header.
2. **ViewBox setup**:
   - `'full'`: `computeFullBBox()` computes positions bbox + PADDING=80. In `'lanes'` mode, `minX` is clamped to `≤ -PADDING/2` so lane labels (drawn at x=0) are included. Sets viewBox; resets `#graph-root` transform to identity.
   - `'current'`: sets viewBox to `"0 0 svgW svgH"` where svgW/svgH are the canvas pixel dimensions. The `#graph-root` transform is left untouched — the SVG renders exactly what's on-screen, scaled to fill the page.
3. **Grid injection** — two separate injections, both removed in `afterprint`:
   - `injectBlackArrow()` inserts a `<defs id="pdf-arrow-defs">` as a **direct child of `<svg>`** (not inside any `<g>` — browsers silently ignore `<defs>` nested inside `<g>`). Defines `#arrow-pdf-black` marker with black polygon fill `#222`.
   - `injectBackgroundAndGrid()` inserts `<g id="pdf-bg-grid">` before `#graph-root`. Contains: a white `<rect>` covering the full viewBox, then explicit `<line>` elements for minor (`#d8e6ed`, 0.3px) and major (`#b8cdd8`, 0.6px) grid lines. Grid uses **explicit lines, not SVG patterns** — patterns defined in `<defs>` inside `<g>` are unreliable across browsers/PDF renderers. Spacing: `minor = clamp(round(vbW/35), 20, 100)`, `major = minor × 5`. Lines start from a snapped multiple of `minor` so they land on round coordinates.
4. **Edge colorization**: every `.edge-vis` reads `data-edge-from` on its parent `<g>`, looks up `nodeOwnerMap[fromId]` → `ownerColors[owner]`, sets `stroke` and `style.color` to that color, `stroke-width=2`, `opacity=1`, `marker-end=url(#arrow-dyn)`. The existing `#arrow-dyn` marker (defined in Canvas.tsx) uses `fill="currentColor"` so the arrowhead automatically matches the edge color via inheritance. No new marker injection needed.
5. Calls `window.print()`.
6. In `afterprint`: `restoreIsolation()`, removes injected `<g>`, restores edge attributes, restores viewBox/transform.

Print CSS in `global.css` (`@media print`):

- SVG forced to `100vw × 100vh`.
- `print-color-adjust: exact` preserves colored node-card fills.
- `#canvas-wrap::before` hidden (removes the dark dot-grid pseudo-element).
- Non-SVG children of `#canvas-wrap` hidden (minimap, banners, tooltips).

### Custom Events (component decoupling)

| Event                        | Fired by                                   | Handled by     |
| ---------------------------- | ------------------------------------------ | -------------- |
| `flowgraph:open-guide`       | App.tsx (Shift+?) / Header                 | UserGuideModal |
| `flowgraph:guide-state`      | Header (📖 button)                         | UserGuideModal |
| `flowgraph:help-state`       | Header (📋 button)                         | HelpModal      |
| `flowgraph:toggle-sidebar`   | Header                                     | Sidebar        |
| `flowgraph:toggle-inspector` | Header (▣ button)                          | Inspector      |
| `flowgraph:open-file-picker` | Canvas empty state                         | Header         |
| `flowgraph:add-node`         | Canvas click (add tool)                    | NodeEditModal  |
| `flowgraph:create-group`     | DesignToolbar (multi-select)               | GroupEditModal |
| `flowgraph:edit-group`       | GroupCard dblclick / Inspector             | GroupEditModal |
| `flowgraph:create-phase`     | DesignToolbar / PhaseNavigator "+" pill    | PhaseEditModal |
| `flowgraph:edit-phase`       | PhaseLayer dblclick / Inspector            | PhaseEditModal |

`flowgraph:create-phase` carries `detail: { nodeIds?: string[] }` — when fired from
"Assign to Phase → New Phase…" in the toolbar, nodeIds is pre-populated with the
currently multi-selected node IDs so the modal pre-assigns them.

`flowgraph:edit-phase` carries `detail: { phaseId: string }`.

### Responsive Header

All button text is wrapped in `<span className={styles.btnLabel}>`. At `< 920px`
this class is hidden, leaving icon-only buttons. Tooltips always carry the full
description so nothing is lost.

### Stable DOM IDs

These IDs are used for direct DOM access — do not remove or rename them:

- `#canvas-wrap` — the outer canvas container div
- `#graph-root` — the SVG `<g>` that receives the pan/zoom transform
- `#graph-content` — inner `<g>` that wraps lanes/edges/nodes (keyed for fade-in)
- `#phase-layer` — `<g>` containing all PhaseLayer band elements (inside `#graph-content`)
- `#lanes-layer` — `<g>` containing LaneLayer elements (inside `#graph-content`)
- `#edge-delete-tip` — the floating edge-delete tooltip

### Groups

Groups are hierarchical collections of nodes and/or sub-groups.

- **Polygon sides** = 4 + nesting depth (top-level = pentagon/5, child = hexagon/6, etc.)
- **Collapsed state**: Group renders as a labelled polygon; edges from/to member nodes reroute to the polygon boundary
- **Expanded state**: Group renders as a translucent bounding box behind its children
- **Multi-select creation**: Shift+click nodes in design mode → "Create Group" button validates connectivity, derives owners, opens GroupEditModal
- **Serialization**: `groups` array is written by `buildExportPayload()` and read by `loadData()`
- **Hierarchy utilities** (`grouping.ts`): `getGroupDepth()`, `getGroupAncestors()`, `validateGroupConnectivity()`, `deriveGroupOwners()`, `computeGroupPolygon()`

### Phases

Phases are flat (non-nested) time/progress bands rendered as **vertical columns** behind nodes. They capture the _when_ dimension (e.g. Discovery → Build → Deploy).

- **Rendering**: `PhaseLayer.tsx` — SVG `<g>` elements inside `#phase-layer`, rendered first (behind lanes, edges, nodes). Each band is bounded by `min(x)` and `max(x + NODE_W)` of its assigned nodes, extended by `PHASE_PAD_X = 30px` on each side.
- **Band anatomy**: fill rect (full height) + header strip (32px, more opaque) + dashed right separator + numbered badge (circle) + name text
- **Opacity states**:
  - Normal: fill 4%, header 16%
  - Hovered: fill 8%, header 22%
  - Focused (spotlit): fill 12%, header 30%
  - Ghosted (another phase is spotlit): fill 1%, header 1%
- **Canvas height tracking**: `Canvas.tsx` uses a `ResizeObserver` on `#canvas-wrap` to track pixel height. The SVG-space band height is computed as `pixelH / k + |offsetY / k| + 200` so bands always fill the visible canvas regardless of zoom/pan.
- **Navigator**: `PhaseNavigator.tsx` — floating `<div>` at `bottom: 56px; left: 50%` inside `#canvas-wrap`. Pills sorted by `phase.sequence`. Active pill uses solid phase color background + white text. Auto-hides when no phases exist and not in design mode. In design mode a "+" pill always shows.
- **Spotlight / focus**: `focusedPhaseId` in the store drives ghosting. Clicking a navigator pill sets `focusedPhaseId`; clicking "All" or the active pill again clears it to `null`.
- **Selection**: clicking a phase band sets `selectedPhaseId` and clears `selectedNodeId` + `selectedGroupId`. Inspector then shows phase details.
- **Edit flow**: double-clicking a phase band (design mode only) fires `flowgraph:edit-phase`. Inspector has "Edit Phase" and "Delete Phase" buttons (design mode only).
- **Node assignment rules**: a node belongs to at most one phase. `assignNodesToPhase()` removes the node from all other phases before adding it. `createPhase()` does the same for the pre-selected nodeIds.
- **Sequence**: auto-assigned as `max(existing sequences) + 1` on create. Gaps are allowed. Bands render left-to-right in sequence order regardless of node positions.
- **ID format**: `PHASE-01`, `PHASE-02`, … (not guaranteed to be contiguous after deletes).
- **Color palette**: `PHASE_PALETTE` in `types/graph.ts` — 8 hex strings exported as `as const`. Auto-assigned round-robin on create (`phases.length % 8`). Use `useState<string>` (not inferred literal) when storing the selected color to avoid TypeScript narrowing errors.
- **Serialization**: `buildExportPayload()` includes `phases` only when non-empty (same pattern as groups). `loadData()` extracts phases from `savedLayout` via cast: `(savedLayout as { phases?: GraphPhase[] } | null)?.phases ?? []`. `Header.tsx` attaches `obj.phases` to `savedLayout` during file parse, same pattern as groups.
- **Undo**: phase mutations (`createPhase`, `deletePhase`) push an `UndoSnapshot` that includes `phases?: GraphPhase[]`. The undo/redo handlers do NOT yet restore phases (undo restores nodes/positions/groups only) — phases survive undo.
- **PDF export**: phase bands are SVG elements inside `#graph-root` so they print automatically. No special handling needed — they inherit the existing print CSS.

### Hover Highlighting

Use **positive-only hover styling**: only apply `.hovered` and `.neighbor` CSS classes to affected elements via direct DOM manipulation. Never dim or bulk-modify non-hovered elements — it causes mass repaints.

### Layout Cache

`layoutCache` in the store holds `{positions, transform}` snapshots keyed by view mode (`'dag'` / `'lanes'`). Always call `saveLayoutToCache()` after drag-drop or any manual layout change so view-mode switching restores the last arrangement exactly.

---

## Adding New Features

### New store field + action

1. Add the field + action signature to the `GraphStore` interface.
2. Add the field to the initial state object.
3. Implement the action (the `set(...)` call) in the store body.

### New header button

1. Add button JSX with `<span className={styles.btnLabel}>Label</span>` around the text.
2. Add styles in `Header.module.css`.
3. Icon-only responsive behaviour is handled automatically by the `< 920px` media query.

### New modal

1. Create the component and have it listen for a custom event in `useEffect`.
2. Dispatch the custom event from wherever it should be triggered.
3. Render the modal in `App.tsx` (outside the layout flow, at the end of the JSX).

### New group action

1. Add the action signature to the `GraphStore` interface.
2. Implement in store body using `get().groups` + `set(...)`.
3. Ensure `buildExportPayload()` in `exportJson.ts` includes the updated groups in the serialized output.

### New phase action

1. Add the action signature to the `GraphStore` interface (phases section).
2. Implement in store body. Phase mutations that should be undoable must push `UndoSnapshot` with `phases: [...state.phases]`.
3. `buildExportPayload()` already serializes phases — no changes needed for new actions that only mutate `phases[]`.

### Adding a new serialized top-level field (like groups/phases)

Pattern used for both groups and phases — apply the same to any future field:
1. `types/graph.ts` — define the interface.
2. `graphStore.ts` — add to state, `clearGraph`, `loadData` (extract with cast + `?? []`), and all relevant actions.
3. `exportJson.ts` — add to `buildExportPayload()` signature and output (conditional, same as groups/phases).
4. `exportGraphToJson()` — add the param and pass through.
5. `Header.tsx` — add to `parseAndLoad()` (attach `obj.field` to `savedLayout`) and to all `buildExportPayload` / `exportGraphToJson` call sites. Update `useCallback` dep arrays.

### Updating the User Guide

Edit the `SECTIONS` array in `UserGuideModal.tsx`. The guide's search box uses
`extractText()` to recursively pull plain text from the JSX — no separate keyword
lists need to be maintained.

---

## Known Constraints & Gotchas

| Issue                                            | Cause                                                                          | Fix in place                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Black square flicker on hover                    | SVG `filter: drop-shadow` causes GPU compositing artifacts                     | Replaced with stroke-based glow on `.node-main-rect`; `will-change: opacity` on `.node-group` |
| Header covers canvas content                     | `.svgCanvas { overflow: visible }` let filter regions paint outside SVG bounds | Changed to `overflow: hidden`                                                                 |
| Lane Y-drift on owner toggle                     | Old absolute Y positions become wrong when lanes shift                         | `toggleOwner` / `toggleAllOwners` translate Y positions by `newLane.y − oldLane.y` delta      |
| Firefox/Safari can't save in-place               | No File System Access API                                                      | Graceful fallback: download a copy; broken-chain chip signals the mode                        |
| `window.print()` is synchronous on some browsers | Print dialog may close before `afterprint` fires on Safari                     | Cleanup is idempotent — safe to call multiple times                                           |
| `PHASE_PALETTE` literal type narrowing           | `as const` on the palette array makes `useState(PHASE_PALETTE[0])` infer `"#4A90D9"` as type, blocking assignment of other colors | Always use `useState<string>(PHASE_PALETTE[0])` — explicit generic defeats the narrowing |
| Phase bands don't cover full canvas after zoom   | Band height must be in SVG user-space, not pixels                              | Height computed as `pixelH / k + |offsetY / k| + 200` in `Canvas.tsx` using `canvasPixelHeight` state from `ResizeObserver` |
| Undo does not restore phases                     | `UndoSnapshot` carries `phases?` but `undo`/`redo` actions in the store do not restore it | Known gap — phases survive undo. To fix: add `phases: prev.phases ?? state.phases` to the `set(...)` calls in `undo` and `redo` |
| Phase bands invisible when phase has no nodes with positions | `PhaseLayer` skips rendering if `assignedPositions.length === 0` | Expected — band appears as soon as at least one assigned node has a computed position |

---

## Deployment

GitHub Pages via GitHub Actions. The workflow builds on push to `main` and
deploys `dist/` to the `gh-pages` branch. The Vite config sets `base: '/ProcessFlowChart/'`.

Repo: `gtran-07/ProcessFlowChart`
Live: `https://gtran-07.github.io/ProcessFlowChart/`
