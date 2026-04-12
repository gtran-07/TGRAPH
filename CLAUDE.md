# FlowGraph — CLAUDE.md

Built completely with **Claude Code**. Authored by **Giang Tran**.

---

## What This App Is

FlowGraph is a browser-based interactive dependency flowchart viewer and editor.
Users load, create, and edit directed acyclic graphs (DAGs) stored as JSON files.
No server required — runs entirely in the browser and can be hosted on GitHub Pages.

---

## Session Protocol

**Usage discipline:**
- `/model sonnet` — use Sonnet, not Opus
- One feature maximum per session
- `/cost` every 3 prompts
- `/compact` after each feature
- `/clear` between features

**When I make a mistake:** say "Update CLAUDE.md with this rule" and I will add a corrective rule here immediately.

---

## Behavioral Rules (Always Apply)

### When to Use Subagents
- Use an **Explore** agent when the task requires understanding a complex system across multiple files before any code is written.
- Use a **Plan** agent when the task touches 3+ files or needs an architectural decision before implementation.
- Use a **general-purpose** agent for deep research, open-ended codebase searches, or tasks where you are not confident a simple Glob/Grep will find the right answer in 1–2 tries.
- Spawn subagents **in parallel** when multiple independent sub-tasks can run simultaneously — do not serialize work that can be parallelized.
- Do NOT spawn subagents for simple, directed lookups (known file path, specific symbol) — use Glob/Grep/Read directly.

### Planning Before Coding
- Read CLAUDE.md and memory files FIRST. Only reach for Explore/Grep/Read if what you need is genuinely not already in context.
- For multi-file work: build a concrete plan (file order, exact changes, reasoning) before touching any file. Share the plan with the user.
- Before writing any code, confirm the root cause is understood — not just the symptom.

### Implementation Discipline
- Work on ONE file at a time, completely finish it, then move to the next. No jumping between files mid-task.
- Never be ad-hoc or erratic — follow the plan in the stated order.
- Prefer refactoring to the correct abstraction over layering workarounds.
- Do not pursue surface-level "just make it work" patches — find and fix the root cause.
- **Do not be lazy.** Always find the root cause and fix from there. Pursue elegant solutions — not the quickest patch that happens to work. If the clean fix requires more work, do the work.

### Node–Group Parity Principle
Every feature and bug fix that applies to a node must work identically for a group. Groups are not a separate concept — they are a higher-level unit that behaves like a node from the outside.

- **Connectors**: A group's connectors = union of all connectors of all descendant nodes at every nesting depth.
- **When node and group are in separate files**: fix node first, verify, then apply the same fix to group. Never leave one broken.
- **When node and group share co-located code**: fix both in the same pass.
- **Checklist for every feature/fix touching nodes**: Does it involve connectors? hover/highlight? phase membership? selection? drag? undo? — Apply the same logic to groups.

---

## Commands

```bash
npm run dev           # Vite dev server (hot reload)
npm run build         # tsc + vite build → dist/
npm run preview       # Preview the production build locally
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
    │                           PhaseLayer (vertical bands), PhaseNavigator (floating pill bar), PhaseCrowns
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
    "lanes": { "positions": { "..." : {} }, "transform": { "x": 0, "y": 0, "k": 1 } }
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

### File I/O Modes

| Mode                     | When                                                                  | Save behaviour                                  |
| ------------------------ | --------------------------------------------------------------------- | ----------------------------------------------- |
| **Linked** (teal chip)   | Opened via `showOpenFilePicker` / `showSaveFilePicker` in Chrome/Edge | Writes directly to file on disk — no download   |
| **Unlinked** (gray chip) | Opened via `<input type="file">` (Firefox/Safari) or new flowchart   | Downloads a copy to the user's Downloads folder |

After **Save As**, the returned `FileSystemFileHandle` replaces the old handle and
`currentFileName` is updated to the new filename — so subsequent saves go to the new location.

### PDF Export

`exportPdf.ts` exports via `window.print()`. Signature:

```ts
exportToPdf(mode: 'current' | 'full', positions?, _ownerColors?, _nodeOwnerMap?, _transform?, viewMode?)
```

All DOM changes are reverted in `afterprint`:

1. **DOM isolation** — walks up from `#canvas-wrap` to `<body>`, hides all siblings with `visibility:hidden`. Forces `#canvas-wrap` to `position:fixed; inset:0; background:#fff; z-index:99999`. More reliable than `@media print` CSS for hiding the sidebar/header.
2. **ViewBox setup**:
   - `'full'`: `computeFullBBox()` computes positions bbox + `PADDING=80`. In `'lanes'` mode, `minX` is clamped to `≤ -PADDING/2` so lane labels (drawn at x=0) are included. Sets viewBox; resets `#graph-root` transform to identity.
   - `'current'`: sets viewBox to `"0 0 svgW svgH"` (canvas pixel dimensions). The `#graph-root` transform is left untouched — renders exactly what's on-screen.
3. **Grid injection** — two injections, both removed in `afterprint`:
   - `injectBlackArrow()` inserts `<defs id="pdf-arrow-defs">` as a **direct child of `<svg>`** (not inside `<g>` — browsers silently ignore `<defs>` nested in `<g>`). Defines `#arrow-pdf-black` with black fill `#222`.
   - `injectBackgroundAndGrid()` inserts `<g id="pdf-bg-grid">` before `#graph-root` — a white `<rect>` covering the full viewBox, then explicit `<line>` elements for minor (`#d8e6ed`, 0.3px) and major (`#b8cdd8`, 0.6px) grid lines. Uses **explicit lines, not SVG patterns** — patterns in `<defs>` inside `<g>` are unreliable across PDF renderers. Spacing: `minor = clamp(round(vbW/35), 20, 100)`, `major = minor × 5`.
4. **Edge colorization** — every `.edge-vis` reads `data-edge-from` on its parent `<g>`, looks up `nodeOwnerMap[fromId]` → `ownerColors[owner]`, sets `stroke` and `style.color` to that color, `stroke-width=2`, `opacity=1`, `marker-end=url(#arrow-dyn)`. The `#arrow-dyn` marker uses `fill="currentColor"` so arrowheads inherit edge color automatically.
5. Calls `window.print()`.
6. `afterprint`: `restoreIsolation()`, removes injected elements, restores edge attributes and viewBox/transform.

Print CSS in `global.css` (`@media print`): SVG forced to `100vw × 100vh`; `print-color-adjust: exact`; `#canvas-wrap::before` hidden; non-SVG children of `#canvas-wrap` hidden (minimap, banners, tooltips).

### Custom Events (Component Decoupling)

| Event                        | Fired by                                | Handled by     |
| ---------------------------- | --------------------------------------- | -------------- |
| `flowgraph:open-guide`       | App.tsx (Shift+?) / Header              | UserGuideModal |
| `flowgraph:guide-state`      | Header (📖 button)                      | UserGuideModal |
| `flowgraph:help-state`       | Header (📋 button)                      | HelpModal      |
| `flowgraph:toggle-sidebar`   | Header                                  | Sidebar        |
| `flowgraph:toggle-inspector` | Header (▣ button)                       | Inspector      |
| `flowgraph:open-file-picker` | Canvas empty state                      | Header         |
| `flowgraph:add-node`         | Canvas click (add tool)                 | NodeEditModal  |
| `flowgraph:create-group`     | DesignToolbar (multi-select)            | GroupEditModal |
| `flowgraph:edit-group`       | GroupCard dblclick / Inspector          | GroupEditModal |
| `flowgraph:create-phase`     | DesignToolbar / PhaseNavigator "+" pill | PhaseEditModal |
| `flowgraph:edit-phase`       | PhaseLayer dblclick / Inspector         | PhaseEditModal |

`flowgraph:create-phase` carries `detail: { nodeIds?: string[] }` — when fired from "Assign to Phase → New Phase…", `nodeIds` is pre-populated with the currently multi-selected node IDs.

`flowgraph:edit-phase` carries `detail: { phaseId: string }`.

### Responsive Header

All button text is wrapped in `<span className={styles.btnLabel}>`. At `< 920px` this class is hidden, leaving icon-only buttons. Tooltips always carry the full label.

### Stable DOM IDs

These IDs are used for direct DOM access — do not remove or rename them:

| ID               | Element                                                         |
| ---------------- | --------------------------------------------------------------- |
| `#canvas-wrap`   | Outer canvas container `<div>`                                  |
| `#graph-root`    | SVG `<g>` that receives the pan/zoom transform                  |
| `#graph-content` | Inner `<g>` wrapping lanes/edges/nodes (keyed for fade-in)      |
| `#phase-layer`   | `<g>` containing all PhaseLayer bands (inside `#graph-content`) |
| `#lanes-layer`   | `<g>` containing LaneLayer elements (inside `#graph-content`)   |
| `#edge-delete-tip` | Floating edge-delete tooltip                                  |

### Groups

Groups are hierarchical collections of nodes and/or sub-groups.

- **Polygon sides** = 4 + nesting depth (top-level = pentagon/5, child = hexagon/6, …)
- **Collapsed**: renders as a labelled polygon; edges from/to members reroute to the polygon boundary
- **Expanded**: renders as a translucent bounding box behind children
- **Multi-select creation**: Shift+click nodes in design mode → "Create Group" validates connectivity, derives owners, opens GroupEditModal
- **Serialization**: `groups` array written by `buildExportPayload()` and read by `loadData()`
- **Hierarchy utilities** (`grouping.ts`): `getGroupDepth()`, `getGroupAncestors()`, `validateGroupConnectivity()`, `deriveGroupOwners()`, `computeGroupPolygon()`

### Phases

Phases are flat (non-nested) time/progress bands rendered as **vertical columns** behind nodes, capturing the _when_ dimension (e.g. Discovery → Build → Deploy).

- **Rendering**: `PhaseLayer.tsx` — SVG `<g>` elements inside `#phase-layer`, drawn first (behind all other content). Each band bounded by `min(x)` / `max(x + NODE_W)` of assigned nodes ± `PHASE_PAD_X = 30px`.
- **DAG vs Lane mode**: In DAG mode bands are tight envelopes (rounded rect) around their nodes. In Lane mode bands are full-height columns.
- **Band anatomy**: fill rect + header strip (32px, more opaque) + dashed border + numbered badge + name text
- **Opacity states**:
  - Normal: fill 4%, header 16%
  - Hovered: fill 8%, header 22%
  - Focused (spotlit): fill 12%, header 30%
  - Ghosted (another phase spotlit): fill 1%, header 1%
- **Canvas height tracking**: `Canvas.tsx` uses a `ResizeObserver` on `#canvas-wrap`. SVG-space band height = `pixelH / k + |offsetY / k| + 200`.
- **Navigator**: `PhaseNavigator.tsx` — floating pill bar at `bottom: 56px; left: 50%`. Pills sorted by `phase.sequence`. Active pill = solid color + white text. Auto-hides when no phases exist (except in design mode, where "+" always shows).
- **Spotlight**: `focusedPhaseId` drives ghosting. Navigator pill click sets it; clicking "All" or the active pill again clears it to `null`.
- **Selection**: clicking a band sets `selectedPhaseId` and clears `selectedNodeId` / `selectedGroupId`.
- **Edit flow**: double-clicking a band (design mode only) fires `flowgraph:edit-phase`. Inspector shows "Edit Phase" and "Delete Phase" buttons in design mode.
- **Node assignment**: a node belongs to at most one phase. `assignNodesToPhase()` removes the node from all other phases first. `createPhase()` does the same for pre-selected nodeIds.
- **Sequence**: auto-assigned as `max(existing sequences) + 1`. Gaps are allowed. Bands render left-to-right by sequence regardless of node x-positions.
- **ID format**: `PHASE-01`, `PHASE-02`, … (not guaranteed contiguous after deletes).
- **Color palette**: `PHASE_PALETTE` in `types/graph.ts` — 8 hex strings `as const`. Auto-assigned round-robin (`phases.length % 8`). Always use `useState<string>(PHASE_PALETTE[0])` — the explicit generic prevents TypeScript literal-type narrowing errors.
- **Serialization**: `buildExportPayload()` includes `phases` only when non-empty. `loadData()` extracts phases via `(savedLayout as { phases?: GraphPhase[] } | null)?.phases ?? []`. `Header.tsx` attaches `obj.phases` to `savedLayout` during file parse.
- **Undo**: phase mutations push `UndoSnapshot` with `phases?: GraphPhase[]`, but undo/redo do NOT yet restore phases — phases survive undo. Known gap.
- **PDF export**: phase bands are inside `#graph-root` and print automatically via the existing print CSS.

### Hover Highlighting

Use **positive-only hover styling**: apply `.hovered` and `.neighbor` CSS classes only to affected elements via direct DOM manipulation. Never dim or bulk-modify non-hovered elements — it causes mass repaints.

### Layout Cache

`layoutCache` holds `{positions, transform}` snapshots keyed by view mode (`'dag'` / `'lanes'`). Always call `saveLayoutToCache()` after drag-drop or any manual layout change so view-mode switching restores the last arrangement exactly.

---

## Adding New Features

### New store field + action

1. Add the field + action signature to the `GraphStore` interface.
2. Add the field to the initial state object.
3. Implement the action (`set(...)` call) in the store body.

### New header button

1. Add button JSX with `<span className={styles.btnLabel}>Label</span>` wrapping the text.
2. Add styles in `Header.module.css`.
3. Icon-only responsive behaviour is handled automatically by the `< 920px` media query.

### New modal

1. Create the component; listen for a custom event in `useEffect`.
2. Dispatch the custom event from wherever it should trigger.
3. Render the modal in `App.tsx` (outside the layout flow, at the end of the JSX).

### New group action

1. Add the action signature to `GraphStore`.
2. Implement in store body using `get().groups` + `set(...)`.
3. Ensure `buildExportPayload()` in `exportJson.ts` includes the updated groups.

### New phase action

1. Add the action signature to `GraphStore` (phases section).
2. Implement in store body. Undoable mutations must push `UndoSnapshot` with `phases: [...state.phases]`.
3. `buildExportPayload()` already serializes phases — no change needed for pure `phases[]` mutations.

### New serialized top-level field

Apply the same pattern used for groups and phases:

1. `types/graph.ts` — define the interface.
2. `graphStore.ts` — add to state, `clearGraph`, `loadData` (extract with cast + `?? []`), and all relevant actions.
3. `exportJson.ts` — add to `buildExportPayload()` signature and output (conditional, same as groups/phases).
4. `exportGraphToJson()` — add the param and pass through.
5. `Header.tsx` — add to `parseAndLoad()` (attach `obj.field` to `savedLayout`) and to all `buildExportPayload` / `exportGraphToJson` call sites. Update `useCallback` dep arrays.

### Updating the User Guide

Edit the `SECTIONS` array in `UserGuideModal.tsx`. The search box uses `extractText()` to recursively pull plain text from JSX — no separate keyword lists needed.

---

## Known Constraints & Gotchas

| Issue | Cause | Fix in place |
| ----- | ----- | ------------ |
| Black square flicker on hover | SVG `filter: drop-shadow` causes GPU compositing artifacts | Stroke-based glow on `.node-main-rect`; `will-change: opacity` on `.node-group` |
| Header covers canvas content | `overflow: visible` let filter regions paint outside SVG bounds | Changed to `overflow: hidden` |
| Lane Y-drift on owner toggle | Old absolute Y positions become wrong when lanes shift | `toggleOwner` / `toggleAllOwners` translate Y by `newLane.y − oldLane.y` delta |
| Firefox/Safari can't save in-place | No File System Access API | Graceful fallback: download a copy; broken-chain chip signals the mode |
| `window.print()` synchronous on some browsers | Print dialog may close before `afterprint` fires on Safari | Cleanup is idempotent — safe to call multiple times |
| `PHASE_PALETTE` literal type narrowing | `as const` makes `useState(PHASE_PALETTE[0])` infer `"#4A90D9"` as type | Always use `useState<string>(PHASE_PALETTE[0])` |
| Phase bands don't cover full canvas after zoom | Band height must be in SVG user-space, not pixels | Height = `pixelH / k + |offsetY / k| + 200` via `ResizeObserver` in `Canvas.tsx` |
| Undo does not restore phases | `undo`/`redo` store actions don't apply `phases` from the snapshot | Known gap — to fix: add `phases: prev.phases ?? state.phases` in the `undo`/`redo` `set(...)` calls |
| Phase band invisible when phase has no positioned nodes | `PhaseLayer` skips rendering when `assignedPositions.length === 0` | Expected — band appears once at least one assigned node has a computed position |

---

## Deployment

GitHub Pages via GitHub Actions. The workflow builds on push to `main` and deploys `dist/` to the `gh-pages` branch. Vite config sets `base: '/ProcessFlowChart/'`.

- Repo: `gtran-07/ProcessFlowChart`
- Live: `https://gtran-07.github.io/ProcessFlowChart/`
