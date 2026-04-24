# FlowGraph — CLAUDE.md

Built completely with **Claude Code**. Authored by **Giang Tran**.

---

## What This App Is

FlowGraph is a browser-based interactive DAG viewer and editor. Users load, create, and edit directed acyclic graphs stored as JSON files. No server — runs entirely in the browser, hosted on GitHub Pages.

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
- **Explore**: complex system spanning multiple files before any code is written.
- **Plan**: task touches 3+ files or needs an architectural decision.
- **general-purpose**: open-ended search where graph tools + Glob/Grep won't find the answer in 1–2 tries.
- Spawn **in parallel** when sub-tasks are independent — never serialize parallelizable work.
- Do NOT spawn for simple lookups — use graph tools or Grep/Read directly.

### Planning Before Coding
- Read CLAUDE.md and memory files FIRST. Use graph tools before Grep/Glob/Read.
- Read the actual component before planning work on it — the planned optimization may already be done.
- Multi-file work: build a concrete plan (file order, exact changes, reasoning) before touching any file. Share it.
- Confirm root cause before writing any code — not just the symptom.

### Implementation Discipline
- ONE file at a time, completely finished, then move to next. No mid-task jumping.
- Follow the plan in stated order.
- Prefer the correct abstraction over workarounds.
- **Find and fix the root cause.** Never patch the symptom. If the clean fix requires more work, do the work.

### Node–Group Parity Principle
Every feature/fix that applies to a node must work identically for a group.

- **Connectors**: group connectors = union of all descendant node connectors at every depth.
- Separate files: fix node first, verify, then apply same fix to group.
- Co-located code: fix both in the same pass.
- **Checklist**: connectors? hover/highlight? phase membership? selection? drag? undo? cinema roles? → apply to groups.

---

## Commands

```bash
npm run dev     # Vite dev server (hot reload)
npm run build   # tsc + vite build → dist/
npm run preview # Preview production build
npm run lint    # ESLint
```

`npm run build` is the only pre-commit check needed. Passes tsc + Vite = ready.

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

Use `get_architecture_overview` for file/component structure.

---

## Architecture Rules

### State
- **All state lives in `graphStore.ts`**. No component-level state for graph data.
- Components call store actions; actions update state; React re-renders.
- Never mutate store state directly from a component.

### JSON Format (non-obvious rules only — full schema in `types/graph.ts`)
- `groups`, `phases`, `tagRegistry`, `ownerRegistry` — omitted when empty.
- `phases[].groupIds` — optional; assigns collapsed groups to a phase (parallel to `nodeIds`).
- `_layout` — omitted when no positions saved yet. Legacy plain array format still accepted on load.
- `cinemaScript`, `cinemaBottleneck`, `cinemaSkip` on nodes and groups — optional; omitted when not set.

### Serialization
`buildExportPayload()` in `exportJson.ts` is the **single source of truth**. All save paths call it — never duplicate.

**Adding a new serialized top-level field** (4 required touch points):
1. `types/graph.ts` — define the interface.
2. `graphStore.ts` — add to state, `clearGraph`, `loadData` (extract from `savedLayout` cast with a type-appropriate empty default: `{}`, `[]`, `null`, or `false`).
3. `exportJson.ts` — add param to `buildExportPayload()`. Emit conditionally (omit when empty/default).
4. `Header.tsx` — extract from `obj` in `parseAndLoad()`, attach to `savedLayout`; add to every call site; update `useCallback` dep arrays.

### File I/O Modes
| Mode                     | When                                                   | Save behaviour                |
| ------------------------ | ------------------------------------------------------ | ----------------------------- |
| **Linked** (teal chip)   | Opened via `showOpenFilePicker` / `showSaveFilePicker` | Writes directly to disk       |
| **Unlinked** (gray chip) | `<input type="file">` (Firefox/Safari) or new chart   | Downloads to Downloads folder |

After Save As, returned `FileSystemFileHandle` replaces old handle; `currentFileName` updates.

### PDF Export (design decisions — see `exportPdf.ts` for impl)
- **DOM isolation**: walks up from `#canvas-wrap` hiding siblings — more reliable than `@media print`.
- **`<defs>` must be a direct child of `<svg>`** (not inside `<g>`) — browsers silently ignore nested `<defs>`.
- **Grid uses explicit `<line>` elements, not `<pattern>`** — SVG patterns inside `<g>` are unreliable across PDF renderers.
- **Arrowhead color**: `#arrow-dyn` uses `fill="currentColor"`; edges set `style.color` so arrowheads inherit automatically.
- All DOM changes reverted in `afterprint`; cleanup is idempotent (safe on Safari's early-fire).

### Stable DOM IDs (do not rename)
| ID                 | Element                                        |
| ------------------ | ---------------------------------------------- |
| `#canvas-wrap`     | Outer canvas container `<div>`                 |
| `#graph-root`      | SVG `<g>` receiving pan/zoom transform         |
| `#graph-content`   | Inner `<g>` wrapping lanes/edges/nodes         |
| `#phase-layer`     | `<g>` for PhaseLayer bands                     |
| `#lanes-layer`     | `<g>` for LaneLayer                            |
| `#edge-delete-tip` | Floating edge-delete tooltip                   |

### Groups
- **Polygon sides** = 4 + nesting depth (top-level = 5/pentagon, child = 6/hexagon, …)
- **Collapsed**: labelled polygon; edges to/from members reroute to polygon boundary.
- **Expanded**: translucent bounding box behind children.
- Multi-select creation: Shift+click nodes in design mode → "Create Group" validates connectivity, derives owners.

### Phases
Flat time/progress bands rendered as vertical columns behind nodes.

- **DAG mode**: tight envelope (rounded rect) around assigned nodes. **Lane mode**: full-height columns.
- **Opacity**: normal fill 4%/header 16%; hovered 8%/22%; spotlit 12%/30%; ghosted 1%/1%.
- **Band height** must be SVG user-space: `pixelH / k + |offsetY / k| + 200` (ResizeObserver in `Canvas.tsx`).
- **`PHASE_PALETTE`**: `as const` causes type narrowing — always `useState<string>(PHASE_PALETTE[0])`.
- **Node assignment**: one phase per node. `assignNodesToPhase()` removes from all others first.
- **Accordion**: `computePhaseAdjustedPositions()` shifts non-collapsed content left at render time without mutating stored positions.
- **Known gaps**: undo doesn't restore phases; accordion only works in DAG mode; `setViewMode()` cache-hit path doesn't re-run `enforcePhaseZones`.

### Hover Highlighting
**Positive-only**: add `.hovered` / `.neighbor` to affected elements via direct DOM manipulation. Never dim non-hovered elements — causes mass repaints.

### Cinema / Discovery Mode
Multi-phase guided storytelling: `cinema` → `transition` → `reconstruction` | `heatmap`.

**Scene types**: `genesis | terminal | fork | bottleneck | convergence | bridge | reveal | parallel | prediction`

**Canvas roles** (applied via `setDiscoveryRoleMap`): `focus` (primary), `lit` (adjacent), `ghost` (0.07 opacity), `visited`, `danger` (bottleneck).

**Heatmap tiers**: `hot` (≥2.0×), `warm` (≥1.0×), `cold` (<1.0×), `ice` (absent).

**Author overrides on nodes/groups** (optional, serialized): `cinemaScript`, `cinemaBottleneck`, `cinemaSkip`.

**Known limitations** (do not re-implement without flagging):
- Groups not supported as blank slots in reconstruction
- Hint is global, not per-node; counter doesn't reset per scene
- No auto-pan to focus node on large graphs
- Rapid double-click can record two wrong reconstruction attempts
- No heatmap persistence across sessions
- Collapsed groups not colored in heatmap phase
- "Skipped" stat display not implemented
- Role labels are first-occurrence only

### Owner Focus Mode
Lane-spotlight in Lanes view. Isolates an owner's nodes with upstream/downstream roles.
- Edge coloring: upstream→owned = blue (`#4f9eff`), owned→downstream = amber (`#f5a623`), unrelated = ghost.
- Node roles: `owned | upstream | downstream | partial | null` — passed as `laneFocusRole` prop.
- Entrance animation suppressed on enter/exit (same as view-mode switch).

### Entrance Animations
Staggered on file load and focus-mode entry. Suppressed on view-mode switch, focus exit, owner-focus toggle, and filter changes.

- **Node stagger**: `120ms × column + 30ms × Y rank`, capped at 600ms. `--entrance-delay` CSS var on inner `.node-entrance` `<g>` in NodeCard / collapsed GroupCard. Expanded GroupCard uses `.group-entrance-expand`.
- **Edge stagger**: `EdgeLayer.useLayoutEffect` (empty deps — mount only) reads `getTotalLength()`, animates via Web Animations API staggered by source column. Inline styles removed after animation so JSX `strokeDasharray` takes effect.
- **Suppress**: `.suppress-entrance` on `#graph-content` → `animation: none !important` on node/group entrance classes; `transition: none` on `.node-group` / `.group-overlay` (prevents slide-from-identity-transform on mount).
- **Direction-aware suppression**: IIFE detects triggering render + 700ms `suppressActiveRef` window covers secondary renders (ResizeObserver, `fitToScreen` timeouts). `animateThisRender` always wins over the window.
- **Group collapse/expand**: `group-exploding` (445ms) / `group-imploding` (380ms) — not affected by suppression.
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` — instant, no transforms.

### Animation Patterns (structural rules — prevent re-discovering these bugs)
- **Never put animation-state classes in JSX `className`**. React re-renders restore it, undoing JS cleanup. Use `element.classList.add/remove()` imperatively only.
- **`animateOnMount = useRef(animate)` pattern**. Freeze the prop at mount — later prop changes don't retrigger animation on already-mounted elements.
- **`useLayoutEffect` for mount-time DOM animation**. `useEffect` fires after paint and can flash final state. Required for anything calling `getTotalLength()`, `getBoundingClientRect()`, or setting initial `style` before animating.
- **`data-*` handshake for React-vs-JS attribute conflicts**. Set JSX attribute to `undefined`; store value in `data-marker-end`. JS cleanup reads `getAttribute` and calls `setAttribute`. React never overwrites a `data-*` it doesn't own.

### Edges
- **No `id` field** — `GraphEdge` only has `{from, to}`. The composite key `"${fromId}:${toId}"` is the only identity. Use this pattern everywhere edges need a map key.
- **Derived, not stored** — edges are built from `node.dependencies` by `rebuildEdgesFromNodes()`. You cannot persist metadata on the edge object itself.
- **Per-edge metadata** — store in a parallel `Record<string, T>` map in state (keyed by `"${fromId}:${toId}"`). Inject as a runtime-only property on the edge object after each rebuild call. Follow the `edgePathTypes` pattern for any future edge-level data.

### SVG Portal Rule
Any popover, dropdown, or tooltip triggered by a click inside SVG must render via `ReactDOM.createPortal(content, document.body)` with `position: fixed`. SVG's `overflow` clips `position: fixed` React children at the SVG container boundary even though fixed positioning ignores normal document flow.

### Multi-Mode Visual Precedence
When multiple display modes affect the same visual property on an edge or node, establish the precedence chain explicitly at the time you add the mode. Current resolution: **structural properties** (strokeWidth) apply in all modes; **narrative properties** (opacity, color, dash) yield to higher-priority modes. Priority order: cinema > owner focus > river flow. Add new visual modes following this chain — do not let modes silently overwrite each other.

### Space-Key Pan
Holding `Space` activates pan-anywhere mode regardless of active design tool. Cursor → `grab`; release restores previous cursor.

### Layout Cache
`layoutCache` holds `{positions, transform}` keyed by view mode (`'dag'` / `'lanes'`). Always call `saveLayoutToCache()` after drag-drop or manual layout change.

---

## Known Constraints & Gotchas

| Issue | Cause | Fix / Status |
| ----- | ----- | ------------ |
| Black square flicker on hover | SVG `filter: drop-shadow` GPU compositing artifacts | Stroke-based glow; `will-change: opacity` on `.node-group` |
| Header covers canvas content | `overflow: visible` lets filter regions paint outside SVG bounds | Changed to `overflow: hidden` |
| Lane Y-drift on owner toggle | Absolute Y positions wrong when lanes shift | `toggleOwner` translates Y by `newLane.y − oldLane.y` delta |
| Firefox/Safari can't save in-place | No File System Access API | Download fallback; broken-chain chip signals mode |
| `window.print()` early on Safari | `afterprint` may fire before dialog closes | Cleanup is idempotent — safe to call multiple times |
| `PHASE_PALETTE` type narrowing | `as const` narrows `useState(PHASE_PALETTE[0])` to literal | Always `useState<string>(PHASE_PALETTE[0])` |
| Phase bands don't cover full canvas after zoom | Band height in pixels, not SVG user-space | Height = `pixelH / k + |offsetY / k| + 200` |
| Undo doesn't restore phases | `undo`/`redo` ignore `phases` in snapshot | Known gap — add `phases: prev.phases ?? state.phases` to fix |
| Phase band invisible with no positioned nodes | `PhaseLayer` skips when `assignedPositions.length === 0` | Expected — appears once a node has a computed position |
| Phase accordion DAG-only | `viewMode !== 'dag'` guard in `Canvas.tsx` `adjustedPositions` | Known gap — remove guard to extend |
| Stale phase positions on view switch | `setViewMode()` cache-hit path skips `enforcePhaseZones` | Known gap |
| Clipboard fails on non-HTTPS | `navigator.clipboard` requires secure context | Expected — no fix planned |
| Cinema heatmap not persisted | `discoveryEngagement` / `heatTiers` are transient store state | Known gap |
| Collapsed groups invisible in heatmap | `GroupCard` role classes not applied when `collapsed === true` | Known gap — mirror heatmap-tier logic from NodeCard |
| Entrance animation on view switch / focus exit | `#graph-content` remounts on key change; bulk fade always played | Direction-aware suppression: IIFE + 700ms `suppressActiveRef` window |
| JS removes animation class; React restores it | JSX `className` and `classList.remove()` fight — React wins | Never put animation-state classes in JSX `className` |
| `Record<UnionType, T>` breaks on union extension | TypeScript requires exhaustive keys; adding a value to a union immediately errors every map using it as a key | Extend the union and all its exhaustive maps in the same edit |
| EdgeLayer.tsx bottom section is dead code | `LaneLayer`, `GhostEdge`, `MiniMap` are defined at the bottom of EdgeLayer.tsx but imported from separate files by Canvas.tsx | Do not edit those bottom definitions — they are unreachable |

---

## Deployment

GitHub Pages via GitHub Actions — push to `main` builds and deploys `dist/` to `gh-pages`. Vite base: `/ProcessFlowChart/`.

- Repo: `gtran-07/ProcessFlowChart`
- Live: `https://gtran-07.github.io/ProcessFlowChart/`

---

## MCP Tools: code-review-graph

**ALWAYS use graph tools BEFORE Grep/Glob/Read.** Faster, cheaper, gives structural context (callers, dependents, impact radius) that file scanning cannot.

| Task | Tool |
|------|------|
| Find a function / component | `semantic_search_nodes` |
| Trace callers / imports | `query_graph` (callers_of / imports_of) |
| Blast radius of a change | `get_impact_radius` |
| Code review | `detect_changes` + `get_review_context` |
| File/component structure | `get_architecture_overview` |
| Execution path impact | `get_affected_flows` |
| Rename / dead code | `refactor_tool` |

Fall back to Grep/Glob/Read only when the graph doesn't cover it. Graph auto-updates on file changes via hooks.
