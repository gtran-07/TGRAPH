# Plan: Phase-Aware Layout + Horizontal Phase Collapse

## Overview

Two related features that together make phases structurally meaningful on the canvas:

1. **Phase zone enforcement** — after layout runs, push non-phase nodes out of phase bands so no node bleeds into a band it doesn't belong to.
2. **Horizontal collapse/expand** — each phase band can be collapsed to a narrow strip, hiding its nodes and shifting the rest of the chart left.

---

## Feature 1 — Phase Zone Enforcement (Auto-Relayout)

### Problem

Currently, `computeLayout()` is phase-unaware. A node assigned to Phase B can end up at the same x-column as nodes in Phase A, causing visual overlap between bands.

### Approach: Post-layout x-column shift (pure function, no layout rewrite)

After `computeLayout()` produces positions, run a second pure function:

```ts
// src/utils/layout.ts (new export)
enforcePhaseZones(
  rawPositions: Record<string, Position>,
  phases: GraphPhase[],           // sorted by sequence
  nodeW: number                   // NODE_W constant
): Record<string, Position>
```

**Algorithm:**

1. **Identify x-columns.** Group node IDs by their raw x value (a column = all nodes sharing the same x, since DAG layout assigns one x per layer).

2. **Classify each column.** For each x-column, determine which phase(s) "own" the nodes there. A column is:
   - *Phase-owned* if all its nodes belong to the same phase.
   - *Mixed* if nodes from multiple phases (or a mix of phased + unphased) share the column.
   - *Unphased* if none of its nodes are assigned to any phase.

3. **Compute phase x-bands.** For each phase (sorted by sequence), the x-range is `[min(owned-node-x) - PHASE_PAD_X, max(owned-node-x + NODE_W) + PHASE_PAD_X]`.

4. **Detect violations.** A column violates zone rules if:
   - It contains unphased nodes that fall inside a phase's x-range.
   - It contains nodes assigned to Phase A that fall inside Phase B's x-range.

5. **Resolve violations by column shift.** For each violating column, compute the nearest valid x position outside all conflicting phase ranges (prefer shifting right to maintain sequence order). Apply the shift to all nodes in that column.

6. **Return adjusted positions.** The stored positions are replaced by these adjusted ones (same as if the user had dragged those nodes manually).

**Where to call it:**

- In `graphStore.ts`, in the `runLayout` action (line 298), after `computeLayout()`:
  ```ts
  const raw = computeLayout(visibleNodes, visibleEdges);
  const positions = enforcePhaseZones(raw, get().phases, NODE_W);
  ```
- Also call it in `loadData` after positions are loaded when phases exist, so loaded files are also corrected.

**Trade-offs:**
- Mixed columns (node A in Phase 1, node B in Phase 2, both at the same DAG layer) are unavoidable via dependency structure alone. The algorithm resolves these by duplicating the column x-position (one copy shifted left for Phase 1, one shifted right for Phase 2), which can introduce slight edge crossings. This is an acceptable trade-off.
- Unphased nodes are pushed to the rightmost free zone (after all phase bands). A future option could let the user choose left/right placement.

---

## Feature 2 — Horizontal Phase Collapse/Expand

### Problem

Phases can span many nodes. When a user wants to focus on one phase, collapsing others would reduce visual clutter and shrink the canvas width.

### Approach: Virtual x-offset (no stored position mutation)

**State change — `graphStore.ts`:**

Add one new field to the store:
```ts
collapsedPhaseIds: string[];   // IDs of phases currently collapsed
```
Actions: `collapsePhase(id)`, `expandPhase(id)`, `togglePhaseCollapse(id)`.

This field is **not serialized** to JSON (it's transient UI state, like `focusedPhaseId`).

**Collapsed band geometry — `PhaseLayer.tsx`:**

Define `COLLAPSED_W = 48` (px in SVG space). When a phase is collapsed:
- Band renders as a `COLLAPSED_W`-wide strip at its original left edge.
- Phase name is rotated 90° inside the strip.
- A small expand icon ( `▶` ) replaces the number badge.
- Clicking the strip calls `expandPhase(id)` (not the phase spotlight flow).
- The dashed separator moves to `minX + COLLAPSED_W`.

**Virtual offset computation — new pure util:**

```ts
// src/utils/layout.ts (new export)
computePhaseAdjustedPositions(
  phases: GraphPhase[],            // sorted by sequence
  rawPositions: Record<string, Position>,
  collapsedPhaseIds: string[],
  nodeW: number
): {
  adjustedPositions: Record<string, Position>;
  hiddenNodeIds: Set<string>;
  xShiftPerPhase: Record<string, number>; // how much each phase band's left edge shifts
}
```

**Algorithm:**

1. Sort phases by sequence. Compute each phase's x-range from `rawPositions`.
2. Walk left-to-right through phases. For each collapsed phase, compute `savings = bandWidth - COLLAPSED_W`. Accumulate a running `totalShift`.
3. For every node whose raw x is to the right of a collapsed phase's `minX`: subtract `savings` from its x (shift left). Nodes inside a collapsed phase: add to `hiddenNodeIds`.
4. For each phase band itself, shift its `minX` and `maxX` by the accumulated shift at that phase's position.
5. Return adjusted positions, hidden node IDs, and the per-phase shift map for PhaseLayer rendering.

**Where to apply:**

- In `Canvas.tsx`, compute `{ adjustedPositions, hiddenNodeIds }` as a `useMemo` derived from `positions`, `phases`, `collapsedPhaseIds`.
- Pass `adjustedPositions` to: `PhaseLayer`, `EdgeLayer`, `NodeCard`, `GroupCard`, `MiniMap` — everywhere that currently receives `positions`.
- Pass `hiddenNodeIds` to the node render loop; skip rendering nodes in that set.

**UX details:**
- The PhaseNavigator pill for a collapsed phase shows a `⟨` icon prefix and slightly dimmed text.
- Collapsing all phases is allowed (canvas becomes very narrow — expected).
- Collapse state resets on `clearGraph` (it's transient).
- PDF export: before `window.print()`, expand all phases (call `expandPhase` for each), restore after `afterprint`. This ensures the full chart always prints.

---

## Interaction Between the Two Features

| Scenario | Behaviour |
|---|---|
| Collapse a phase, then run auto-layout | `enforcePhaseZones` operates on raw stored positions. After layout, recompute virtual offsets. Order: `computeLayout → enforcePhaseZones → computePhaseAdjustedPositions`. |
| Expand a collapsed phase | Remove from `collapsedPhaseIds`. `computePhaseAdjustedPositions` re-runs via `useMemo`. No layout recompute needed — raw positions are untouched. |
| Phase with 0 assigned nodes | `enforcePhaseZones` skips it (no range to enforce). Collapse hides nothing (no `hiddenNodeIds`). Collapsed strip still renders at a default position (or is skipped if no range). |
| Load a file with phases | `loadData` calls `enforcePhaseZones` if phases are non-empty. Collapse state starts empty. |

---

## Files Changed

| File | Change |
|---|---|
| `src/utils/layout.ts` | Add `enforcePhaseZones()` and `computePhaseAdjustedPositions()` exports |
| `src/types/graph.ts` | No type changes needed — `GraphPhase` is sufficient |
| `src/store/graphStore.ts` | Add `collapsedPhaseIds: string[]` state + 3 actions; call `enforcePhaseZones` in `runLayout` and `loadData` |
| `src/components/Canvas/Canvas.tsx` | Add `useMemo` for adjusted positions; pass them downstream; handle `hiddenNodeIds` |
| `src/components/Canvas/PhaseLayer.tsx` | Render collapsed strip variant; receive `collapsedPhaseIds` prop |
| `src/components/Canvas/PhaseNavigator.tsx` | Show collapsed indicator on pills; click to toggle |
| `src/utils/exportPdf.ts` | Expand all phases before print; restore after `afterprint` |

**No changes needed to:** `exportJson.ts`, `Header.tsx`, `Inspector.tsx`, `PhaseEditModal.tsx`, `EdgeLayer.tsx` (EdgeLayer already receives positions prop — just needs to receive the adjusted one).

---

## Open Questions

1. **Where should unphased nodes land?** Current plan pushes them right of all phases. An alternative: let the user configure a "free zone" position (left / right / between phases). Recommend starting with "right of all phases" and adding a setting later.

2. **Should collapse state be serialized?** Currently planned as transient. If users want collapsed state to persist across sessions, add it to `_layout` in the JSON. Recommend keeping it transient for now.

3. **Enforce zones on manual drag?** If a user drags a Phase A node into Phase B's territory, should it snap back? Recommend NO for now — enforcement only on layout runs, not during manual drag. Adds a `Re-enforce Layout` button in the Inspector for phases as a future option.

4. **Lane view compatibility?** Phase bands are only rendered in DAG view today. Both features should be gated to DAG view only. In lanes view, leave positions as-is.
