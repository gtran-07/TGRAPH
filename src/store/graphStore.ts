/**
 * store/graphStore.ts — Central Zustand state store for FlowGraph.
 *
 * This is the single source of truth for ALL application state. Every component
 * reads from this store via hooks and mutates state through actions defined here.
 *
 * Why Zustand? It's minimal, doesn't require providers/wrappers, and its
 * selector-based subscriptions mean components only re-render when the specific
 * slice of state they care about changes.
 *
 * Architecture rule: NO direct state mutation outside of this file.
 * Components call actions; actions update state; React re-renders.
 *
 * What belongs here: all state fields and all state mutation functions.
 * What does NOT belong here: React JSX, DOM manipulation, SVG rendering.
 */

import { create } from 'zustand';
import type {
  GraphNode,
  GraphEdge,
  GraphGroup,
  GraphPhase,
  GraphMeta,
  NodeTag,
  Position,
  Transform,
  ViewMode,
  DesignTool,
  LayoutSnapshot,
  FocusSnapshot,
  LaneMetrics,
  UndoSnapshot,
} from '../types/graph';
import { PHASE_PALETTE } from '../types/graph';
import {
  computeLayout,
  computeLaneLayout,
  rebuildEdgesFromNodes,
  enforcePhaseZones,
  pushNodesOutOfPhaseBand,
  enforceAllPhaseBoundaries,
  resolveNodeOverlaps,
  NODE_W,
  NODE_H,
  LANE_LABEL_W,
  LEGIBILITY_PAD_X,
  LEGIBILITY_PAD_Y,
} from '../utils/layout';
import { assignOwnerColors } from '../utils/colors';
import {
  deriveGroupOwners,
  generateGroupId,
  getHiddenNodeIds,
  getAllDescendantNodeIds,
  getAllDescendantGroupIds,
  GROUP_R,
} from '../utils/grouping';

// ─── STORE INTERFACE ─────────────────────────────────────────────────────────

export interface GraphStore {
  // ── Core graph data ──────────────────────────────────────────────────────
  /** Complete list of all nodes, regardless of visibility or filtering */
  allNodes: GraphNode[];
  /** Complete list of all edges, derived from node dependencies */
  allEdges: GraphEdge[];

  // ── Visibility (filtered subset of allNodes/allEdges) ────────────────────
  /** Nodes currently rendered on canvas (subset of allNodes, filtered by activeOwners + focus mode) */
  visibleNodes: GraphNode[];
  /** Edges currently rendered on canvas (subset of allEdges, both endpoints must be visible) */
  visibleEdges: GraphEdge[];

  // ── Layout ───────────────────────────────────────────────────────────────
  /** Current x/y positions for each node by node id */
  positions: Record<string, Position>;
  /** Swim lane vertical metrics, only populated in 'lanes' view mode */
  laneMetrics: Record<string, LaneMetrics>;
  /** Which owners are currently checked (visible) in the filter sidebar */
  activeOwners: Set<string>;
  /** Color assigned to each owner, maps owner name → hex color string */
  ownerColors: Record<string, string>;

  // ── View ─────────────────────────────────────────────────────────────────
  /** Current layout mode: 'dag' = left-to-right dependency layout, 'lanes' = swim lanes by owner */
  viewMode: ViewMode;
  /**
   * Cached layouts per view mode. When the user switches from DAG to LANES and back,
   * their arrangement is restored exactly as they left it.
   */
  layoutCache: Record<string, LayoutSnapshot>;

  // ── Selection & interaction ───────────────────────────────────────────────
  /** ID of the node whose details are shown in the Inspector panel. Null if nothing is selected. */
  selectedNodeId: string | null;
  /** ID of the node currently being hovered. Drives the highlight/dim effect. */
  hoveredNodeId: string | null;
  /** ID of the node most recently jumped to via search. Used for the pulsing glow animation. */
  lastJumpedNodeId: string | null;

  // ── Focus mode ───────────────────────────────────────────────────────────
  /** True when focus mode is active (user double-clicked a node in view mode) */
  focusMode: boolean;
  /** The anchor node id in focus mode (the node that was double-clicked) */
  focusNodeId: string | null;
  /**
   * Snapshot of the graph state captured immediately before entering focus mode.
   * Used to restore the exact pre-focus layout when the user exits.
   */
  preFocusSnapshot: FocusSnapshot | null;

  // ── Canvas viewport ───────────────────────────────────────────────────────
  /** Current pan (x, y) and zoom (k) applied to the graph canvas */
  transform: Transform;
  /**
   * When non-null, Canvas.tsx will animate the transform from its current value
   * to this target using a smooth easeOutCubic "fly-to" animation.
   * Set via flyTo(); cleared by Canvas after animation completes.
   */
  flyTarget: Transform | null;

  // ── Design mode ───────────────────────────────────────────────────────────
  /** True when design mode is active (the user clicked the Design button) */
  designMode: boolean;
  /** Which design tool is currently selected */
  designTool: DesignTool;
  /** ID of the node that was first-clicked in 'connect' tool mode (the source of the new edge) */
  connectSourceId: string | null;
  /** True when there are unsaved changes since the last load/save */
  designDirty: boolean;
  undoStack: UndoSnapshot[];
  redoStack: UndoSnapshot[];
  undo: () => void;
  redo: () => void;

  // ── Groups ────────────────────────────────────────────────────────────────
  /** All groups in the graph */
  groups: GraphGroup[];
  /** IDs of nodes/groups currently selected for group creation (design mode multi-select) */
  multiSelectIds: string[];
  /** ID of the selected group (shown in Inspector). Null when nothing selected. */
  selectedGroupId: string | null;

  // ── Phases ────────────────────────────────────────────────────────────────
  /** All phases in the graph (vertical time bands on the canvas) */
  phases: GraphPhase[];
  /** ID of the phase whose details are shown in the Inspector. Null if nothing selected. */
  selectedPhaseId: string | null;
  /** ID of the phase currently spotlit via the Phase Navigator. Null = show all. */
  focusedPhaseId: string | null;
  /** IDs of phases currently collapsed to a narrow strip (transient — not serialized) */
  collapsedPhaseIds: string[];

  /** Name of the currently-loaded JSON file, or null if no file is loaded */
  currentFileName: string | null;
  /**
   * File System Access API handle for the currently-open file.
   * When present, Save writes directly back to the file on disk (Chrome/Edge).
   * When null, Save falls back to downloading a copy.
   */
  fileHandle: FileSystemFileHandle | null;

  // ── Actions ───────────────────────────────────────────────────────────────
  /** clearGraph — resets all graph data and enters design mode for a fresh start */
  clearGraph: () => void;
  setFileHandle: (handle: FileSystemFileHandle | null) => void;
  setCurrentFileName: (name: string | null) => void;
  loadData: (nodes: GraphNode[], savedLayout?: {
    currentView?: string;
    dag?:   { positions: Record<string, Position>; transform: Transform } | null;
    lanes?: { positions: Record<string, Position>; transform: Transform } | null;
    /** @deprecated single-view format from older saves — still accepted for backward compat */
    positions?: Record<string, Position>;
    transform?: Transform;
    viewMode?: string;
  } | null, fileName?: string | null) => void;
  addNode: (node: GraphNode, clickPosition: Position) => void;
  updateNode: (id: string, changes: Partial<Omit<GraphNode, 'id'>>) => void;
  deleteNode: (id: string) => void;
  addEdge: (fromId: string, toId: string) => void;
  deleteEdge: (fromId: string, toId: string) => void;
  setTransform: (transform: Transform) => void;
  setDesignMode: (on: boolean) => void;
  setDesignTool: (tool: DesignTool) => void;
  setConnectSource: (nodeId: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSelectedNode: (id: string | null) => void;
  setHoveredNode: (id: string | null) => void;
  setLastJumpedNode: (id: string | null) => void;
  toggleOwner: (owner: string) => void;
  toggleAllOwners: () => void;
  rebuildGraph: (animated?: boolean) => void;
  enterFocusMode: (nodeId: string) => void;
  exitFocusMode: () => void;
  saveLayoutToCache: () => void;
  saveNamedLayout: (name: string) => void;
  loadNamedLayout: (snapshot: LayoutSnapshot, viewMode: ViewMode) => void;
  fitToScreen: (animate?: boolean) => void;
  /** Trigger a smooth animated pan+zoom to the given transform. */
  flyTo: (target: Transform) => void;
  /** Clear flyTarget after animation finishes (called by Canvas). */
  clearFlyTarget: () => void;

  // ── Group actions ──────────────────────────────────────────────────────────
  /** Create a new group from selected node IDs and optional child group IDs */
  createGroup: (
    childNodeIds: string[],
    childGroupIds: string[],
    data: { name: string; description: string }
  ) => void;
  /** Update one or more fields of an existing group */
  updateGroup: (id: string, changes: Partial<Omit<GraphGroup, 'id'>>) => void;
  /**
   * Delete a group.
   * If dissolve=true, its children remain as standalone nodes/groups.
   * If dissolve=false (default), children are also deleted.
   */
  deleteGroup: (id: string, dissolve?: boolean) => void;
  /** Toggle the collapsed/expanded state of a group */
  toggleGroupCollapse: (id: string) => void;
  /** Set the selected group ID (Inspector) */
  setSelectedGroup: (id: string | null) => void;
  /** Add or remove an item from the multi-select set (design mode) */
  toggleMultiSelect: (id: string) => void;
  /** Clear all multi-selected items */
  clearMultiSelect: () => void;

  // ── Phase actions ──────────────────────────────────────────────────────────
  /** Create a new phase, optionally pre-assigning nodes and/or collapsed groups */
  createPhase: (nodeIds: string[], data: { name: string; description: string; color?: string }, groupIds?: string[]) => void;
  /** Collapse a phase band to a narrow strip */
  collapsePhase: (id: string) => void;
  /** Expand a previously collapsed phase band */
  expandPhase: (id: string) => void;
  /** Toggle the collapsed/expanded state of a phase band */
  togglePhaseCollapse: (id: string) => void;
  /** Collapse all phase bands at once */
  collapseAllPhases: () => void;
  /** Expand all phase bands at once */
  expandAllPhases: () => void;
  /** Update one or more fields of an existing phase */
  updatePhase: (id: string, changes: Partial<Omit<GraphPhase, 'id'>>) => void;
  /** Delete a phase (nodes are unaffected — they simply no longer belong to a phase) */
  deletePhase: (id: string) => void;
  /** Assign a set of nodes to a phase, removing them from any previous phase first */
  assignNodesToPhase: (nodeIds: string[], phaseId: string) => void;
  /** Remove a set of nodes from whichever phase they belong to */
  removeNodesFromPhase: (nodeIds: string[]) => void;
  /** Assign a set of collapsed groups to a phase, removing them from any previous phase first */
  assignGroupsToPhase: (groupIds: string[], phaseId: string) => void;
  /** Remove a set of groups from whichever phase they belong to */
  removeGroupsFromPhase: (groupIds: string[]) => void;

  // ── Clipboard ─────────────────────────────────────────────────────────────
  /** Nodes currently on the clipboard (set by copySelection) */
  clipboard: GraphNode[];
  /** Copy selected nodes to the clipboard */
  copySelection: () => void;
  /** Paste clipboard nodes as new nodes, offset by +80/+80, preserving internal deps */
  pasteClipboard: () => void;
  /** Run full phase-constraint settlement for all phases in the current view mode and write back positions */
  settleAllPhases: () => void;
  /** Re-assign phase sequence numbers by ascending mean-X of member nodes */
  reorderPhasesByPosition: () => void;
  /** Detect overlapping nodes / collapsed groups and spread them apart to remove overlaps */
  resolveOverlaps: () => void;
  /**
   * settleAndResolve — combined phase-settlement + overlap-resolution pipeline.
   *
   * Runs settleAllPhases logic to enforce phase band boundaries, then calls
   * resolveNodeOverlaps to push any remaining overlapping items apart with
   * LEGIBILITY_PAD_X/Y spacing. In LANES view, Y positions are clamped back to
   * the owner's lane bounds after resolution. Does NOT call saveLayoutToCache —
   * callers are responsible for saving to cache after this returns.
   *
   * @param anchorIds - IDs of items that must not move (e.g. the just-dragged node).
   *                    All other items push away from anchors.
   */
  settleAndResolve: (anchorIds?: Set<string>) => void;
  /** Set the selected phase ID (Inspector) */
  setSelectedPhaseId: (id: string | null) => void;
  /** Set the focused phase ID (Navigator spotlight) */
  setFocusedPhaseId: (id: string | null) => void;

  // ── Owner & tag management ─────────────────────────────────────────────────
  /** Override the display color for an owner */
  setOwnerColor: (owner: string, color: string) => void;
  /** Rename an owner across all nodes, updating colors and active filter set */
  renameOwner: (oldName: string, newName: string) => void;
  /** Change the color of every tag with the given label across all nodes */
  recolorTag: (label: string, color: string) => void;
  /** Rename a tag label across all nodes */
  renameTag: (oldLabel: string, newLabel: string) => void;

  // ── Tag registry ───────────────────────────────────────────────────────────
  /**
   * Session-only registry of tags created in the sidebar but not yet assigned to
   * any node. These appear in the node-edit dropdown so users can pre-define tags.
   * Not serialized — entries survive only until the next file load/clear.
   */
  tagRegistry: NodeTag[];
  /** Add a tag to the session registry (no-op if a tag with that label already exists) */
  addTagToRegistry: (tag: NodeTag) => void;
  /** Remove a tag from the session registry by label */
  removeTagFromRegistry: (label: string) => void;

  // ── Owner registry ──────────────────────────────────────────────────────────
  /**
   * Registry of owner names pre-created in the sidebar (design mode).
   * Owners here appear in the Owners filter pane and the node-edit owner dropdown
   * even before any node is assigned to them. Serialized with the file.
   */
  ownerRegistry: string[];
  /** Add an owner to the registry (no-op if the name already exists on a node or in the registry) */
  addOwnerToRegistry: (name: string) => void;
  /** Remove an owner from the registry by name (only registry-only owners; no-op if a node uses it) */
  removeOwnerFromRegistry: (name: string) => void;

  // ── File metadata ────────────────────────────────────────────────────────────
  /**
   * Metadata read from `_meta` in the loaded JSON. Preserved on save so the
   * field survives round-trips. Null for brand-new charts (defaults are injected
   * by buildExportPayload at save time).
   */
  meta: GraphMeta | null;
}

// ─── HELPER: compute visible nodes/edges from current state ─────────────────

/**
 * deriveVisibility — filters the full node/edge list down to what should be visible
 * given the current activeOwners set and focus mode state.
 *
 * This is a pure function (no side effects) so it can be called safely from within
 * Zustand's set() callback.
 */
function deriveVisibility(
  allNodes: GraphNode[],
  allEdges: GraphEdge[],
  activeOwners: Set<string>,
  focusMode: boolean,
  focusNodeId: string | null,
  groups: GraphGroup[] = []
): { visibleNodes: GraphNode[]; visibleEdges: GraphEdge[] } {
  // Nodes inside a collapsed group are hidden regardless of owner filter
  const hiddenByGroup = getHiddenNodeIds(groups);

  let visibleNodes: GraphNode[];

  if (focusMode && focusNodeId) {
    // Focus mode: show only the focused node + its direct parents and children
    const focusedNode = allNodes.find((node) => node.id === focusNodeId);
    if (!focusedNode) {
      return { visibleNodes: [], visibleEdges: [] };
    }

    const directParentIds = new Set(focusedNode.dependencies);
    const directChildIds = new Set(
      allEdges.filter((edge) => edge.from === focusNodeId).map((edge) => edge.to)
    );
    const focusedIds = new Set([focusNodeId, ...directParentIds, ...directChildIds]);

    visibleNodes = allNodes.filter(
      (node) =>
        focusedIds.has(node.id) &&
        activeOwners.has(node.owner) &&
        !hiddenByGroup.has(node.id)
    );
  } else {
    visibleNodes = allNodes.filter(
      (node) => activeOwners.has(node.owner) && !hiddenByGroup.has(node.id)
    );
  }

  const visibleIdSet = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = allEdges.filter(
    (edge) => visibleIdSet.has(edge.from) && visibleIdSet.has(edge.to)
  );

  return { visibleNodes, visibleEdges };
}

// ─── HELPER: compute layout positions ───────────────────────────────────────

/**
 * derivePositions — computes layout positions for the given nodes and edges.
 * Returns both the positions map and (for lane mode) the lane metrics.
 *
 * When phases and groups are provided in DAG mode, they are forwarded into
 * computeLayout so the phase-stratified layering and group-cohesion sort apply.
 * enforcePhaseZones still runs afterward as a safety net for any unphased nodes
 * that topological layering may have placed inside a phase band.
 */
function derivePositions(
  visibleNodes: GraphNode[],
  visibleEdges: GraphEdge[],
  viewMode: ViewMode,
  activeOwners: Set<string>,
  allNodes: GraphNode[],
  phases?: GraphPhase[],
  groups?: GraphGroup[]
): { positions: Record<string, Position>; laneMetrics: Record<string, LaneMetrics> } {
  if (viewMode === 'lanes') {
    return computeLaneLayout(visibleNodes, visibleEdges, activeOwners, allNodes);
  } else {
    const raw = computeLayout(visibleNodes, visibleEdges, phases, groups);
    const positions = phases && phases.length > 0
      ? enforcePhaseZones(raw, phases, NODE_W)
      : raw;
    return { positions, laneMetrics: {} };
  }
}

// ─── STORE ──────────────────────────────────────────────────────────────────

export const useGraphStore = create<GraphStore>((set, get) => ({
  // ── Initial state ─────────────────────────────────────────────────────────
  allNodes: [],
  allEdges: [],
  visibleNodes: [],
  visibleEdges: [],
  positions: {},
  laneMetrics: {},
  activeOwners: new Set(),
  ownerColors: {},
  viewMode: 'dag',
  layoutCache: {},
  selectedNodeId: null,
  hoveredNodeId: null,
  lastJumpedNodeId: null,
  focusMode: false,
  focusNodeId: null,
  preFocusSnapshot: null,
  transform: { x: 0, y: 0, k: 1 },
  flyTarget: null,
  designMode: false,
  designTool: 'select',
  connectSourceId: null,
  designDirty: false,
  undoStack: [],
  redoStack: [],
  groups: [],
  multiSelectIds: [],
  selectedGroupId: null,
  phases: [],
  selectedPhaseId: null,
  focusedPhaseId: null,
  collapsedPhaseIds: [],
  currentFileName: null,
  fileHandle: null,
  clipboard: [],
  tagRegistry: [],
  ownerRegistry: [],
  meta: null,

  // ── clearGraph ────────────────────────────────────────────────────────────
  clearGraph: () => {
    set({
      allNodes: [],
      allEdges: [],
      visibleNodes: [],
      visibleEdges: [],
      positions: {},
      laneMetrics: {},
      activeOwners: new Set(),
      ownerColors: {},
      viewMode: 'dag',
      layoutCache: {},
      selectedNodeId: null,
      hoveredNodeId: null,
      lastJumpedNodeId: null,
      focusMode: false,
      focusNodeId: null,
      preFocusSnapshot: null,
      transform: { x: 0, y: 0, k: 1 },
      designMode: true,
      designTool: 'select',
      connectSourceId: null,
      designDirty: false,
      undoStack: [],
      redoStack: [],
      groups: [],
      multiSelectIds: [],
      selectedGroupId: null,
      phases: [],
      selectedPhaseId: null,
      focusedPhaseId: null,
      collapsedPhaseIds: [],
      currentFileName: null,
      fileHandle: null,
      tagRegistry: [],
      ownerRegistry: [],
      meta: null,
    });
  },

  // ── setFileHandle ─────────────────────────────────────────────────────────
  setFileHandle: (handle) => set({ fileHandle: handle }),
  setCurrentFileName: (name) => set({ currentFileName: name }),

  // ── loadData ─────────────────────────────────────────────────────────────

  /**
   * loadData — ingests a new node array, rebuilds all derived state, and renders.
   *
   * Called when the user loads a JSON file. Resets all state (layout cache,
   * focus mode, design mode, etc.) and computes a fresh layout.
   */
  loadData: (nodes, savedLayout, fileName) => {
    const allEdges = rebuildEdgesFromNodes(nodes);
    const owners = [...new Set(nodes.map((node) => node.owner))];
    const ownerColors = assignOwnerColors(owners);
    const activeOwners = new Set(owners);

    // Extract groups from savedLayout if present
    const groups: GraphGroup[] = (savedLayout as { groups?: GraphGroup[] } | null)?.groups ?? [];
    // Extract phases from savedLayout if present (backward compat — default empty)
    const phases: GraphPhase[] = (savedLayout as { phases?: GraphPhase[] } | null)?.phases ?? [];
    // Extract tagRegistry from savedLayout if present (backward compat — default empty)
    const tagRegistry: NodeTag[] = (savedLayout as { tagRegistry?: NodeTag[] } | null)?.tagRegistry ?? [];
    // Extract ownerRegistry from savedLayout if present (backward compat — default empty)
    const ownerRegistry: string[] = (savedLayout as { ownerRegistry?: string[] } | null)?.ownerRegistry ?? [];
    // Extract _meta if present — preserved as-is so it round-trips through saves
    const meta: GraphMeta | null = (savedLayout as { meta?: GraphMeta } | null)?.meta ?? null;

    const { visibleNodes, visibleEdges } = deriveVisibility(
      nodes, allEdges, activeOwners, false, null, groups
    );

    // ── Normalise savedLayout into the new two-view format ────────────────
    // Old format: { positions, transform, viewMode }
    // New format: { currentView, dag, lanes }
    let restoredViewMode: ViewMode = 'dag';
    let activeLayout: { positions: Record<string, Position>; transform: Transform } | null = null;
    const restoredCache: Record<string, { positions: Record<string, Position>; transform: Transform }> = {};

    if (savedLayout) {
      if (savedLayout.dag || savedLayout.lanes) {
        // New two-view format
        restoredViewMode = savedLayout.currentView === 'lanes' ? 'lanes' : 'dag';
        if (savedLayout.dag)   restoredCache['dag']   = savedLayout.dag;
        if (savedLayout.lanes) restoredCache['lanes'] = savedLayout.lanes;
        activeLayout = restoredCache[restoredViewMode] ?? null;
      } else if (savedLayout.positions && savedLayout.transform) {
        // Old single-view format (backward compat)
        restoredViewMode = savedLayout.viewMode === 'lanes' ? 'lanes' : 'dag';
        activeLayout = { positions: savedLayout.positions, transform: savedLayout.transform };
        restoredCache[restoredViewMode] = activeLayout;
      }
    }

    // Compute fresh layout for the active view (used as fallback for missing positions)
    const { positions: freshPositions, laneMetrics } = activeLayout
      ? derivePositions(visibleNodes, visibleEdges, restoredViewMode, activeOwners, nodes)
      : derivePositions(visibleNodes, visibleEdges, 'dag', activeOwners, nodes, phases);

    const rawActivePositions = activeLayout ? activeLayout.positions : freshPositions;
    const activePositions = restoredViewMode === 'lanes' && phases.length > 0
      ? enforceAllPhaseBoundaries(rawActivePositions, phases, groups, GROUP_R, LANE_LABEL_W)
      : rawActivePositions;

    set({
      allNodes: nodes,
      allEdges,
      visibleNodes,
      visibleEdges,
      positions: activePositions,
      laneMetrics,
      activeOwners,
      ownerColors,
      viewMode: activeLayout ? restoredViewMode : 'dag',
      // Pre-populate the cache so switching views restores the saved arrangement
      layoutCache: restoredCache,
      selectedNodeId: null,
      hoveredNodeId: null,
      lastJumpedNodeId: null,
      focusMode: false,
      focusNodeId: null,
      preFocusSnapshot: null,
      designMode: false,
      designTool: 'select',
      connectSourceId: null,
      designDirty: false,
      undoStack: [],
      redoStack: [],
      groups,
      multiSelectIds: [],
      selectedGroupId: null,
      phases,
      selectedPhaseId: null,
      focusedPhaseId: null,
      collapsedPhaseIds: [],
      tagRegistry,
      ownerRegistry,
      meta,
      transform: activeLayout ? activeLayout.transform : { x: 0, y: 0, k: 1 },
      currentFileName: fileName ?? null,
      fileHandle: null, // caller sets this via setFileHandle after loadData
    });
  },

  // ── addNode ───────────────────────────────────────────────────────────────

  /**
   * addNode — adds a new node to the graph and places it at the given canvas position.
   *
   * The new node is appended to allNodes, edges are rebuilt, and the canvas
   * re-renders with the node at the click position. Does NOT recompute the full layout
   * (so existing nodes don't jump around when a new one is added).
   */
  addNode: (newNode: GraphNode, clickPosition: Position) => {
    const state = get();

    // Prevent duplicate IDs
    if (state.allNodes.find((node) => node.id === newNode.id)) {
      console.warn(`addNode: node with id "${newNode.id}" already exists. Skipping.`);
      return;
    }

    const undoSnapshot: UndoSnapshot = { nodes: [...state.allNodes], positions: { ...state.positions }, groups: [...state.groups] };
    const undoStack = [...state.undoStack, undoSnapshot].slice(-50);

    const allNodes = [...state.allNodes, newNode];
    const allEdges = rebuildEdgesFromNodes(allNodes);

    // Assign color if this is a new owner
    const ownerColors = assignOwnerColors(
      [...new Set(allNodes.map((node) => node.owner))],
      state.ownerColors
    );

    // Make sure the new owner is active (visible)
    const activeOwners = new Set([...state.activeOwners, newNode.owner]);

    const { visibleNodes, visibleEdges } = deriveVisibility(
      allNodes, allEdges, activeOwners, state.focusMode, state.focusNodeId, state.groups
    );

    // Place the new node centered on the click position
    const newPositions = {
      ...state.positions,
      [newNode.id]: {
        x: clickPosition.x - NODE_W / 2,
        y: clickPosition.y - NODE_H / 2,
      },
    };

    set({
      allNodes,
      allEdges,
      visibleNodes,
      visibleEdges,
      positions: newPositions,
      ownerColors,
      activeOwners,
      designDirty: true,
      undoStack,
      redoStack: [],
    });
    // Resolve overlaps so the new node never lands on top of an existing one.
    // The new node itself is the anchor — surrounding nodes push away from it.
    get().settleAndResolve(new Set([newNode.id]));
  },

  // ── updateNode ────────────────────────────────────────────────────────────

  /**
   * updateNode — updates one or more fields of an existing node.
   *
   * If the owner changes and it's a new owner, assigns a color for it.
   * Does not recompute layout (node stays in its current position).
   */
  updateNode: (id: string, changes: Partial<Omit<GraphNode, 'id'>>) => {
    const state = get();

    const undoSnapshot: UndoSnapshot = { nodes: [...state.allNodes], positions: { ...state.positions }, groups: [...state.groups] };
    const undoStack = [...state.undoStack, undoSnapshot].slice(-50);

    const allNodes = state.allNodes.map((node) =>
      node.id === id ? { ...node, ...changes } : node
    );

    const ownerColors = assignOwnerColors(
      [...new Set(allNodes.map((node) => node.owner))],
      state.ownerColors
    );

    const activeOwners = new Set([
      ...state.activeOwners,
      ...(changes.owner ? [changes.owner] : []),
    ]);

    const { visibleNodes, visibleEdges } = deriveVisibility(
      allNodes, state.allEdges, activeOwners, state.focusMode, state.focusNodeId, state.groups
    );

    // When owner changes in lanes view, snap the node into its new lane and
    // translate all other nodes by the lane-Y delta (same pattern as toggleOwner).
    const ownerChanged = changes.owner !== undefined &&
      changes.owner !== state.allNodes.find((n) => n.id === id)?.owner;

    if (ownerChanged && state.viewMode === 'lanes') {
      const { positions: freshPositions, laneMetrics } =
        computeLaneLayout(visibleNodes, visibleEdges, activeOwners, allNodes);

      const positions: Record<string, Position> = { ...state.positions };

      // Translate existing nodes by their lane's Y delta
      visibleNodes.forEach((n) => {
        if (n.id === id) return; // handled below
        const oldLane = state.laneMetrics[n.owner];
        const newLane = laneMetrics[n.owner];
        if (oldLane && newLane && state.positions[n.id]) {
          positions[n.id] = {
            x: state.positions[n.id].x,
            y: state.positions[n.id].y + (newLane.y - oldLane.y),
          };
        }
      });

      // Place the changed node at the fresh position in its new lane
      if (freshPositions[id]) {
        positions[id] = freshPositions[id];
      }

      set({ allNodes, visibleNodes, visibleEdges, ownerColors, activeOwners, positions, laneMetrics, designDirty: true, undoStack, redoStack: [] });
    } else {
      set({ allNodes, visibleNodes, visibleEdges, ownerColors, activeOwners, designDirty: true, undoStack, redoStack: [] });
    }
  },

  // ── deleteNode ────────────────────────────────────────────────────────────

  /**
   * deleteNode — removes a node and all edges connected to it.
   *
   * Also removes the deleted node's id from all other nodes' dependency lists,
   * so no dangling references remain in the data.
   */
  deleteNode: (id: string) => {
    const state = get();

    const undoSnapshot: UndoSnapshot = { nodes: [...state.allNodes], positions: { ...state.positions }, groups: [...state.groups] };
    const undoStack = [...state.undoStack, undoSnapshot].slice(-50);

    // Remove from node list
    let allNodes = state.allNodes.filter((node) => node.id !== id);

    // Remove this node from any other node's dependencies
    allNodes = allNodes.map((node) => ({
      ...node,
      dependencies: node.dependencies.filter((depId) => depId !== id),
    }));

    const allEdges = rebuildEdgesFromNodes(allNodes);

    // Clear selection if the deleted node was selected
    const selectedNodeId = state.selectedNodeId === id ? null : state.selectedNodeId;

    // Remove position
    const positions = { ...state.positions };
    delete positions[id];

    // Remove from any group's childNodeIds
    const groups = state.groups.map((g) => ({
      ...g,
      childNodeIds: g.childNodeIds.filter((nid) => nid !== id),
    }));

    const { visibleNodes, visibleEdges } = deriveVisibility(
      allNodes, allEdges, state.activeOwners, state.focusMode, state.focusNodeId, groups
    );

    set({ allNodes, allEdges, visibleNodes, visibleEdges, positions, selectedNodeId, groups, designDirty: true, undoStack, redoStack: [] });
  },

  // ── addEdge ───────────────────────────────────────────────────────────────

  /**
   * addEdge — creates a directed connection from fromId to toId.
   *
   * "from → to" means "to depends on from" (from must happen before to).
   * Silently ignores duplicate edges and self-connections.
   */
  addEdge: (fromId: string, toId: string) => {
    const state = get();

    // Guard: no self-connections
    if (fromId === toId) return;

    // Guard: no duplicate edges
    if (state.allEdges.find((edge) => edge.from === fromId && edge.to === toId)) return;

    const undoSnapshot: UndoSnapshot = { nodes: [...state.allNodes], positions: { ...state.positions }, groups: [...state.groups] };
    const undoStack = [...state.undoStack, undoSnapshot].slice(-50);

    // Add fromId to toNode's dependencies array
    const allNodes = state.allNodes.map((node) => {
      if (node.id === toId && !node.dependencies.includes(fromId)) {
        return { ...node, dependencies: [...node.dependencies, fromId] };
      }
      return node;
    });

    const allEdges = rebuildEdgesFromNodes(allNodes);

    const { visibleNodes, visibleEdges } = deriveVisibility(
      allNodes, allEdges, state.activeOwners, state.focusMode, state.focusNodeId, state.groups
    );

    set({ allNodes, allEdges, visibleNodes, visibleEdges, designDirty: true, undoStack, redoStack: [] });
  },

  // ── deleteEdge ────────────────────────────────────────────────────────────

  /**
   * deleteEdge — removes the connection from fromId to toId.
   *
   * Removes fromId from toNode's dependencies array and removes the edge from allEdges.
   */
  deleteEdge: (fromId: string, toId: string) => {
    const state = get();

    const undoSnapshot: UndoSnapshot = { nodes: [...state.allNodes], positions: { ...state.positions }, groups: [...state.groups] };
    const undoStack = [...state.undoStack, undoSnapshot].slice(-50);

    const allNodes = state.allNodes.map((node) => {
      if (node.id === toId) {
        return { ...node, dependencies: node.dependencies.filter((depId) => depId !== fromId) };
      }
      return node;
    });

    const allEdges = rebuildEdgesFromNodes(allNodes);

    const { visibleNodes, visibleEdges } = deriveVisibility(
      allNodes, allEdges, state.activeOwners, state.focusMode, state.focusNodeId, state.groups
    );

    set({ allNodes, allEdges, visibleNodes, visibleEdges, designDirty: true, undoStack, redoStack: [] });
  },

  // ── setTransform ──────────────────────────────────────────────────────────
  setTransform: (transform: Transform) => set({ transform }),

  // ── flyTo / clearFlyTarget ────────────────────────────────────────────────
  flyTo: (target: Transform) => set({ flyTarget: target }),
  clearFlyTarget: () => set({ flyTarget: null }),

  // ── setDesignMode ─────────────────────────────────────────────────────────
  setDesignMode: (on: boolean) => {
    set({
      designMode: on,
      // Reset tool to 'select' when toggling design mode on or off
      designTool: 'select',
      connectSourceId: null,
      // Clear selection when exiting design mode so no red-glow highlights remain
      ...(on ? {} : {
        selectedNodeId: null,
        selectedGroupId: null,
        selectedPhaseId: null,
        multiSelectIds: [],
      }),
    });
  },

  // ── setDesignTool ─────────────────────────────────────────────────────────
  setDesignTool: (tool: DesignTool) => {
    set({
      designTool: tool,
      // Clear any in-progress connection when switching tools
      connectSourceId: tool !== 'connect' ? null : get().connectSourceId,
    });
  },

  // ── setConnectSource ──────────────────────────────────────────────────────
  setConnectSource: (nodeId: string | null) => set({ connectSourceId: nodeId }),

  // ── setViewMode ───────────────────────────────────────────────────────────

  /**
   * setViewMode — switches between DAG and LANES layout, caching the current layout first.
   *
   * If a cached layout exists for the target mode, it's restored exactly.
   * If not, a fresh layout is computed.
   */
  setViewMode: (mode: ViewMode) => {
    const state = get();
    if (mode === state.viewMode) return;

    // Only persist/restore the layout cache when NOT in focus mode.
    // Focus mode shows a subgraph — saving those positions would corrupt the full-graph cache,
    // and restoring a full-graph cache while in focus would cause a nodes/positions mismatch.
    const cache = { ...state.layoutCache };
    if (!state.focusMode && Object.keys(state.positions).length > 0) {
      cache[state.viewMode] = {
        positions: { ...state.positions },
        transform: { ...state.transform },
      };
    }

    const cachedLayout = !state.focusMode ? cache[mode] : null;

    if (cachedLayout) {
      // Restore the layout the user left behind, then re-enforce phase zones in case
      // phases were added/changed since the cache was saved.
      const restoredPositions = state.phases.length > 0
        ? mode === 'dag'
          ? enforcePhaseZones(cachedLayout.positions, state.phases, NODE_W)
          : enforceAllPhaseBoundaries(cachedLayout.positions, state.phases, state.groups, GROUP_R, LANE_LABEL_W)
        : cachedLayout.positions;
      // Apply positions/viewMode first (keep current transform), then fly to the saved transform.
      set({
        viewMode: mode,
        layoutCache: cache,
        positions: restoredPositions,
        laneMetrics: mode === 'lanes'
          ? computeLaneLayout(state.visibleNodes, state.visibleEdges, state.activeOwners, state.allNodes).laneMetrics
          : {},
      });
      set({ flyTarget: cachedLayout.transform });
    } else {
      // No cache (or in focus mode) — compute fresh positions for the current visible set
      const { positions: rawPositions, laneMetrics } = derivePositions(
        state.visibleNodes, state.visibleEdges, mode, state.activeOwners, state.allNodes,
        state.phases.length > 0 ? state.phases : undefined
      );
      const positions = state.phases.length > 0
        ? enforceAllPhaseBoundaries(
            rawPositions, state.phases, state.groups, GROUP_R,
            mode === 'lanes' ? LANE_LABEL_W : 0
          )
        : rawPositions;
      set({ viewMode: mode, layoutCache: cache, positions, laneMetrics });
      setTimeout(() => get().fitToScreen(), 60);
    }
  },

  // ── setSelectedNode ───────────────────────────────────────────────────────
  setSelectedNode: (id: string | null) => set((s) => ({
    selectedNodeId: id,
    selectedGroupId: null,
    selectedPhaseId: id !== null ? null : s.selectedPhaseId,
    lastJumpedNodeId: s.lastJumpedNodeId && s.lastJumpedNodeId !== id ? null : s.lastJumpedNodeId,
    multiSelectIds: [],
  })),

  // ── setHoveredNode ────────────────────────────────────────────────────────
  setHoveredNode: (id: string | null) => set({ hoveredNodeId: id }),

  // ── setLastJumpedNode ─────────────────────────────────────────────────────
  setLastJumpedNode: (id: string | null) => set({ lastJumpedNodeId: id }),

  // ── undo ──────────────────────────────────────────────────────────────────
  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const prev = state.undoStack[state.undoStack.length - 1];
    const newUndoStack = state.undoStack.slice(0, -1);
    const newRedoStack = [...state.redoStack, { nodes: [...state.allNodes], positions: { ...state.positions }, groups: [...state.groups] }];

    const allNodes = prev.nodes;
    const prevGroups = prev.groups ?? [];
    const allEdges = rebuildEdgesFromNodes(allNodes);
    const owners = [...new Set(allNodes.map((n) => n.owner))];
    const ownerColors = assignOwnerColors(owners, state.ownerColors);
    const activeOwners = new Set([...state.activeOwners].filter((o) => allNodes.some((n) => n.owner === o)));
    const { visibleNodes, visibleEdges } = deriveVisibility(allNodes, allEdges, activeOwners, state.focusMode, state.focusNodeId, prevGroups);

    set({
      allNodes, allEdges, visibleNodes, visibleEdges,
      positions: prev.positions, ownerColors, activeOwners, groups: prevGroups,
      undoStack: newUndoStack, redoStack: newRedoStack, designDirty: true,
    });
  },

  // ── redo ──────────────────────────────────────────────────────────────────
  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    const newRedoStack = state.redoStack.slice(0, -1);
    const newUndoStack = [...state.undoStack, { nodes: [...state.allNodes], positions: { ...state.positions }, groups: [...state.groups] }];

    const allNodes = next.nodes;
    const nextGroups = next.groups ?? [];
    const allEdges = rebuildEdgesFromNodes(allNodes);
    const owners = [...new Set(allNodes.map((n) => n.owner))];
    const ownerColors = assignOwnerColors(owners, state.ownerColors);
    const activeOwners = new Set([...state.activeOwners].filter((o) => allNodes.some((n) => n.owner === o)));
    const { visibleNodes, visibleEdges } = deriveVisibility(allNodes, allEdges, activeOwners, state.focusMode, state.focusNodeId, nextGroups);

    set({
      allNodes, allEdges, visibleNodes, visibleEdges,
      positions: next.positions, ownerColors, activeOwners, groups: nextGroups,
      undoStack: newUndoStack, redoStack: newRedoStack, designDirty: true,
    });
  },

  // ── toggleOwner ───────────────────────────────────────────────────────────

  /**
   * toggleOwner — shows or hides all nodes belonging to an owner in the filter sidebar.
   *
   * After updating visibility, positions are recomputed for the new visible set.
   * Existing positions are PRESERVED so the user's manual layout is not destroyed —
   * only nodes that are newly visible (no existing position) get fresh computed positions.
   */
  toggleOwner: (owner: string) => {
    const state = get();
    const activeOwners = new Set(state.activeOwners);

    if (activeOwners.has(owner)) {
      activeOwners.delete(owner);
    } else {
      activeOwners.add(owner);
    }

    const { visibleNodes, visibleEdges } = deriveVisibility(
      state.allNodes, state.allEdges, activeOwners, state.focusMode, state.focusNodeId, state.groups
    );

    // Compute fresh layout for the new visible set, then merge:
    // nodes that already have a position keep it; only newly-visible nodes get a fresh slot.
    const { positions: freshPositions, laneMetrics } = derivePositions(
      visibleNodes, visibleEdges, state.viewMode, activeOwners, state.allNodes
    );
    const positions: Record<string, Position> = { ...freshPositions };

    if (state.viewMode === 'lanes') {
      // In lanes view, lane Y positions shift when lanes are added/removed.
      // Translate each preserved node position by (newLaneY - oldLaneY) so nodes
      // stay in the correct vertical position within their lane.
      visibleNodes.forEach((n) => {
        const oldLane = state.laneMetrics[n.owner];
        const newLane = laneMetrics[n.owner];
        if (oldLane && newLane && state.positions[n.id]) {
          positions[n.id] = {
            x: state.positions[n.id].x,
            y: state.positions[n.id].y + (newLane.y - oldLane.y),
          };
        }
      });
    } else {
      visibleNodes.forEach((n) => {
        if (state.positions[n.id]) positions[n.id] = state.positions[n.id];
      });
    }

    // Clear selection if the selected node's owner was just hidden
    const selectedNodeId =
      state.selectedNodeId && !activeOwners.has(
        state.allNodes.find((n) => n.id === state.selectedNodeId)?.owner ?? ''
      )
        ? null
        : state.selectedNodeId;

    const finalPositions = state.viewMode === 'lanes' && state.phases.length > 0
      ? enforceAllPhaseBoundaries(positions, state.phases, state.groups, GROUP_R, LANE_LABEL_W)
      : positions;

    set({ activeOwners, visibleNodes, visibleEdges, positions: finalPositions, laneMetrics, selectedNodeId });
  },

  // ── toggleAllOwners ───────────────────────────────────────────────────────

  /**
   * toggleAllOwners — selects or deselects every owner at once.
   * Recomputes positions using the same merge strategy as toggleOwner.
   */
  toggleAllOwners: () => {
    const state = get();
    const allOwners = [...new Set(state.allNodes.map((node) => node.owner))];
    const allActive = allOwners.every((owner) => state.activeOwners.has(owner));

    const activeOwners = allActive ? new Set<string>() : new Set(allOwners);

    const { visibleNodes, visibleEdges } = deriveVisibility(
      state.allNodes, state.allEdges, activeOwners, state.focusMode, state.focusNodeId, state.groups
    );

    const { positions: freshPositions, laneMetrics } = derivePositions(
      visibleNodes, visibleEdges, state.viewMode, activeOwners, state.allNodes
    );
    const positions: Record<string, Position> = { ...freshPositions };
    if (state.viewMode === 'lanes') {
      visibleNodes.forEach((n) => {
        const oldLane = state.laneMetrics[n.owner];
        const newLane = laneMetrics[n.owner];
        if (oldLane && newLane && state.positions[n.id]) {
          positions[n.id] = {
            x: state.positions[n.id].x,
            y: state.positions[n.id].y + (newLane.y - oldLane.y),
          };
        }
      });
    } else {
      visibleNodes.forEach((n) => {
        if (state.positions[n.id]) positions[n.id] = state.positions[n.id];
      });
    }

    const finalPositions = state.viewMode === 'lanes' && state.phases.length > 0
      ? enforceAllPhaseBoundaries(positions, state.phases, state.groups, GROUP_R, LANE_LABEL_W)
      : positions;

    set({ activeOwners, visibleNodes, visibleEdges, positions: finalPositions, laneMetrics, selectedNodeId: null });
  },

  // ── rebuildGraph ──────────────────────────────────────────────────────────

  /**
   * rebuildGraph — recomputes layout and visibility from scratch.
   *
   * Called after loading data, changing owners, or resetting layout.
   * Does NOT preserve cached positions — use setViewMode for cached switching.
   */
  rebuildGraph: () => {
    const state = get();

    const { visibleNodes, visibleEdges } = deriveVisibility(
      state.allNodes, state.allEdges, state.activeOwners, state.focusMode, state.focusNodeId, state.groups
    );

    const { positions: rawPositions, laneMetrics } = derivePositions(
      visibleNodes, visibleEdges, state.viewMode, state.activeOwners, state.allNodes, state.phases, state.groups
    );

    const enforcedPositions = state.phases.length > 0
      ? enforceAllPhaseBoundaries(
          rawPositions, state.phases, state.groups, GROUP_R,
          state.viewMode === 'lanes' ? LANE_LABEL_W : 0
        )
      : rawPositions;

    // Guarantee zero overlaps after a fresh layout.
    // resolveNodeOverlaps runs up to 120 pairwise-separation passes to push apart any
    // remaining collisions — residual overlaps can occur when groups are present,
    // when phase enforcement shifts nodes, or in dense disconnected-component stacks.
    const collapsedGroupIds = new Set(state.groups.filter((g) => g.collapsed).map((g) => g.id));
    const positions = resolveNodeOverlaps(enforcedPositions, collapsedGroupIds, GROUP_R);

    set({ visibleNodes, visibleEdges, positions, laneMetrics });
  },

  // ── enterFocusMode ────────────────────────────────────────────────────────

  /**
   * enterFocusMode — zooms into one node's immediate neighborhood.
   *
   * Captures a snapshot of the current state so we can restore it exactly on exit.
   * Then filters visibility to only the focused node + its parents and children.
   */
  enterFocusMode: (nodeId: string) => {
    const state = get();
    const focusedNode = state.allNodes.find((node) => node.id === nodeId);
    if (!focusedNode) return;

    // When re-focusing from within focus mode, keep the ORIGINAL pre-focus snapshot
    // so that exit focus mode always restores to the full graph, not a previous
    // focus neighborhood. Only capture a new snapshot on the first entry.
    const preFocusSnapshot: FocusSnapshot =
      state.focusMode && state.preFocusSnapshot
        ? state.preFocusSnapshot
        : {
            viewModeAtEnter: state.viewMode,
            positions: { ...state.positions },
            laneMetrics: { ...state.laneMetrics },
            transform: { ...state.transform },
            visibleNodes: [...state.visibleNodes],
            visibleEdges: [...state.visibleEdges],
          };

    const { visibleNodes, visibleEdges } = deriveVisibility(
      state.allNodes, state.allEdges, state.activeOwners, true, nodeId, state.groups
    );

    const { positions, laneMetrics } = derivePositions(
      visibleNodes, visibleEdges, state.viewMode, state.activeOwners, state.allNodes
    );

    set({ focusMode: true, focusNodeId: nodeId, preFocusSnapshot, visibleNodes, visibleEdges, positions, laneMetrics });
  },

  // ── exitFocusMode ─────────────────────────────────────────────────────────

  /**
   * exitFocusMode — restores the graph to the state it was in before focus was entered.
   *
   * If the view mode changed while in focus, we skip restoring the old snapshot
   * (it would conflict with the new view mode) and just rebuild fresh.
   */
  exitFocusMode: () => {
    const state = get();
    const snapshot = state.preFocusSnapshot;

    if (snapshot && snapshot.viewModeAtEnter === state.viewMode) {
      // Re-derive visibility from the current allNodes/groups state rather than
      // restoring the stale snapshot nodes. This correctly handles any group
      // collapse/expand changes made during focus mode, preventing nodes from
      // disappearing or appearing outside their groups on exit.
      const { visibleNodes, visibleEdges } = deriveVisibility(
        state.allNodes, state.allEdges, state.activeOwners, false, null, state.groups
      );
      set({
        focusMode: false,
        focusNodeId: null,
        preFocusSnapshot: null,
        visibleNodes,
        visibleEdges,
        positions: snapshot.positions,
        laneMetrics: snapshot.laneMetrics,
        transform: snapshot.transform,
      });
    } else {
      // View mode changed while in focus — discard snapshot, rebuild fresh.
      set({ focusMode: false, focusNodeId: null, preFocusSnapshot: null });
      get().rebuildGraph();
      setTimeout(() => get().fitToScreen(), 60);
    }
  },

  // ── saveLayoutToCache ─────────────────────────────────────────────────────
  saveLayoutToCache: () => {
    const state = get();
    if (state.focusMode) return; // Don't cache focus-mode layouts

    set({
      layoutCache: {
        ...state.layoutCache,
        [state.viewMode]: {
          positions: { ...state.positions },
          transform: { ...state.transform },
        },
      },
    });
  },

  // ── saveNamedLayout ───────────────────────────────────────────────────────

  /**
   * saveNamedLayout — persists a named layout snapshot to localStorage.
   *
   * Saved layouts survive browser refresh. They are browser-specific (localStorage
   * is not shared between browsers or devices).
   */
  saveNamedLayout: (name: string) => {
    const state = get();
    const snapshot: LayoutSnapshot = {
      positions: { ...state.positions },
      transform: { ...state.transform },
    };

    const savedLayouts = JSON.parse(localStorage.getItem('flowgraph-layouts') ?? '[]');
    savedLayouts.push({
      name,
      savedAt: new Date().toISOString(),
      viewMode: state.viewMode,
      snapshot,
    });
    localStorage.setItem('flowgraph-layouts', JSON.stringify(savedLayouts));
  },

  // ── loadNamedLayout ───────────────────────────────────────────────────────
  loadNamedLayout: (snapshot: LayoutSnapshot, viewMode: ViewMode) => {
    const state = get();
    const { visibleNodes, visibleEdges } = deriveVisibility(
      state.allNodes, state.allEdges, state.activeOwners, false, null, state.groups
    );

    const enforcedPositions = viewMode === 'lanes' && state.phases.length > 0
      ? enforceAllPhaseBoundaries(snapshot.positions, state.phases, state.groups, GROUP_R, LANE_LABEL_W)
      : snapshot.positions;

    set({
      positions: enforcedPositions,
      viewMode,
      visibleNodes,
      visibleEdges,
      focusMode: false,
      focusNodeId: null,
    });
    set({ flyTarget: snapshot.transform });
  },

  // ── fitToScreen ───────────────────────────────────────────────────────────

  /**
   * fitToScreen — computes a transform that centers and scales the graph to fill the viewport.
   *
   * This is called after loading data or resetting layout. The canvas element's
   * dimensions are read from the DOM to compute the correct scale and offset.
   */
  fitToScreen: (animate = true) => {
    const state = get();
    if (Object.keys(state.positions).length === 0) return;

    const canvasEl = document.getElementById('canvas-wrap');
    if (!canvasEl) return;

    const { width: canvasW, height: canvasH } = canvasEl.getBoundingClientRect();

    // Find the bounding box of all visible nodes.
    // In lanes view, lane labels sit at x=0..LANE_LABEL_W, so we extend minX to 0
    // to prevent them from being clipped when fitting to screen.
    const xs = Object.values(state.positions).map((pos) => pos.x);
    const ys = Object.values(state.positions).map((pos) => pos.y);
    const minX = state.viewMode === 'lanes' ? 0 : Math.min(...xs);
    const maxX = Math.max(...xs) + NODE_W;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + NODE_H;

    const graphW = maxX - minX;
    const graphH = maxY - minY;

    const padding = 60; // px padding around the fitted graph
    const scaleX = (canvasW - padding * 2) / graphW;
    const scaleY = (canvasH - padding * 2) / graphH;
    const scale = Math.min(scaleX, scaleY, 1.5); // Cap zoom at 150% to avoid too-close view

    const offsetX = (canvasW - graphW * scale) / 2 - minX * scale;
    const offsetY = (canvasH - graphH * scale) / 2 - minY * scale;

    const target = { x: offsetX, y: offsetY, k: scale };
    if (animate) {
      set({ flyTarget: target });
    } else {
      set({ transform: target });
    }
  },

  // ── createGroup ───────────────────────────────────────────────────────────
  createGroup: (childNodeIds, childGroupIds, data) => {
    const state = get();

    const undoSnapshot: UndoSnapshot = {
      nodes: [...state.allNodes],
      positions: { ...state.positions },
      groups: [...state.groups],
    };

    const id = generateGroupId(state.groups);
    const owners = deriveGroupOwners(childNodeIds, childGroupIds, state.allNodes, state.groups);

    // Place the group polygon at the centroid of its children
    const childPositions = childNodeIds
      .map((nid) => state.positions[nid])
      .filter(Boolean) as { x: number; y: number }[];
    // Also include positions from child groups
    childGroupIds.forEach((gid) => {
      if (state.positions[gid]) childPositions.push(state.positions[gid]);
    });

    const cx = childPositions.length > 0
      ? childPositions.reduce((s, p) => s + p.x, 0) / childPositions.length
      : 200;
    const cy = childPositions.length > 0
      ? childPositions.reduce((s, p) => s + p.y, 0) / childPositions.length
      : 200;

    const newGroup: GraphGroup = {
      id,
      name: data.name,
      description: data.description,
      owners,
      childNodeIds,
      childGroupIds,
      collapsed: false,
    };

    const groups = [...state.groups, newGroup];
    const positions = { ...state.positions, [id]: { x: cx, y: cy } };

    const { visibleNodes, visibleEdges } = deriveVisibility(
      state.allNodes, state.allEdges, state.activeOwners, state.focusMode, state.focusNodeId, groups
    );

    set({
      groups,
      positions,
      visibleNodes,
      visibleEdges,
      multiSelectIds: [],
      designDirty: true,
      undoStack: [...state.undoStack, undoSnapshot].slice(-50),
      redoStack: [],
    });
  },

  // ── updateGroup ───────────────────────────────────────────────────────────
  updateGroup: (id, changes) => {
    const state = get();
    const groups = state.groups.map((g) => (g.id === id ? { ...g, ...changes } : g));

    const { visibleNodes, visibleEdges } = deriveVisibility(
      state.allNodes, state.allEdges, state.activeOwners, state.focusMode, state.focusNodeId, groups
    );

    set({ groups, visibleNodes, visibleEdges, designDirty: true });
  },

  // ── deleteGroup ───────────────────────────────────────────────────────────
  deleteGroup: (id, dissolve = true) => {
    const state = get();

    const undoSnapshot: UndoSnapshot = {
      nodes: [...state.allNodes],
      positions: { ...state.positions },
      groups: [...state.groups],
    };

    let groups = state.groups.filter((g) => g.id !== id);
    const positions = { ...state.positions };

    if (!dissolve) {
      // Also remove all descendant nodes and groups
      const toDelete = getAllDescendantNodeIds(id, state.groups);
      const groupsToDelete = new Set(getAllDescendantGroupIds(id, state.groups));
      groups = groups.filter((g) => !groupsToDelete.has(g.id));
      let allNodes = state.allNodes.filter((n) => !toDelete.includes(n.id));
      allNodes = allNodes.map((n) => ({
        ...n,
        dependencies: n.dependencies.filter((dep) => !toDelete.includes(dep)),
      }));
      toDelete.forEach((nid) => delete positions[nid]);
      groupsToDelete.forEach((gid) => delete positions[gid]);
      delete positions[id];

      // Remove the deleted group and all its descendants from any phase they belong to
      const allDeletedGroupIds = new Set([id, ...groupsToDelete]);
      const phasesAfterDelete = state.phases.map((p) => ({
        ...p,
        groupIds: (p.groupIds ?? []).filter((gid) => !allDeletedGroupIds.has(gid)),
      }));

      const allEdges = rebuildEdgesFromNodes(allNodes);
      const { visibleNodes, visibleEdges } = deriveVisibility(
        allNodes, allEdges, state.activeOwners, state.focusMode, state.focusNodeId, groups
      );
      set({
        allNodes, allEdges, visibleNodes, visibleEdges, groups, positions,
        phases: phasesAfterDelete,
        designDirty: true,
        undoStack: [...state.undoStack, undoSnapshot].slice(-50),
        redoStack: [],
      });
      return;
    }

    // Dissolve: children remain as standalone; just remove the group entry and its position
    delete positions[id];
    // Remove from any parent group's childGroupIds
    groups = groups.map((g) => ({
      ...g,
      childGroupIds: g.childGroupIds.filter((gid) => gid !== id),
    }));

    // Remove the group from any phase it belongs to
    const phases = state.phases.map((p) => ({
      ...p,
      groupIds: (p.groupIds ?? []).filter((gid) => gid !== id),
    }));

    const { visibleNodes, visibleEdges } = deriveVisibility(
      state.allNodes, state.allEdges, state.activeOwners, state.focusMode, state.focusNodeId, groups
    );

    set({
      groups, positions, visibleNodes, visibleEdges, phases,
      designDirty: true,
      undoStack: [...state.undoStack, undoSnapshot].slice(-50),
      redoStack: [],
    });
  },

  // ── toggleGroupCollapse ───────────────────────────────────────────────────
  toggleGroupCollapse: (id) => {
    const state = get();
    const group = state.groups.find((g) => g.id === id);
    const willCollapse = group && !group.collapsed;

    const groups = state.groups.map((g) =>
      g.id === id ? { ...g, collapsed: !g.collapsed } : g
    );

    // When collapsing, recalculate the polygon center from current child positions
    // so the polygon appears where the content actually is, not at the stale creation-time centroid.
    let positions = state.positions;
    if (willCollapse && group) {
      // Gather center points of all descendant nodes (node positions are top-left, so add half-size)
      const descendantNodeIds = getAllDescendantNodeIds(id, state.groups);
      const pts: { x: number; y: number }[] = [
        ...descendantNodeIds
          .map((nid) => state.positions[nid])
          .filter((p): p is { x: number; y: number } => !!p)
          .map((p) => ({ x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 })),
        // Child group positions are already centers
        ...group.childGroupIds
          .map((gid) => state.positions[gid])
          .filter((p): p is { x: number; y: number } => !!p),
      ];
      if (pts.length > 0) {
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        positions = { ...state.positions, [id]: { x: cx, y: cy } };
      }
    }

    const { visibleNodes, visibleEdges } = deriveVisibility(
      state.allNodes, state.allEdges, state.activeOwners, state.focusMode, state.focusNodeId, groups
    );

    set({ groups, positions, visibleNodes, visibleEdges, designDirty: true });

    // Both collapse and expand may create overlaps: collapse places a polygon at the
    // children's centroid (which may land on a neighbour), expand reveals children
    // that may need to spread out. Run overlap resolution in both cases.
    get().resolveOverlaps();
  },

  // ── setSelectedGroup ──────────────────────────────────────────────────────
  setSelectedGroup: (id) => set({ selectedGroupId: id, selectedNodeId: null, selectedPhaseId: null, multiSelectIds: [] }),

  // ── toggleMultiSelect ─────────────────────────────────────────────────────
  toggleMultiSelect: (id) => {
    const state = get();
    const ids = state.multiSelectIds;
    set({
      multiSelectIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    });
  },

  // ── clearMultiSelect ──────────────────────────────────────────────────────
  clearMultiSelect: () => set({ multiSelectIds: [] }),

  // ── createPhase ───────────────────────────────────────────────────────────
  createPhase: (nodeIds, data, groupIds = []) => {
    const state = get();

    // Expand groups to include all nested descendant groups and their nodes
    const allGroupIds = [...new Set([
      ...groupIds,
      ...groupIds.flatMap((gid) => getAllDescendantGroupIds(gid, state.groups)),
    ])];
    const allGroupNodeIds = [...new Set(
      groupIds.flatMap((gid) => getAllDescendantNodeIds(gid, state.groups)),
    )];
    const allNodeIds = [...new Set([...nodeIds, ...allGroupNodeIds])];

    const undoSnapshot: UndoSnapshot = {
      nodes: [...state.allNodes],
      positions: { ...state.positions },
      groups: [...state.groups],
      phases: [...state.phases],
    };

    const nextSeq = state.phases.length > 0
      ? Math.max(...state.phases.map((p) => p.sequence)) + 1
      : 0;
    const colorIdx = state.phases.length % PHASE_PALETTE.length;
    const id = `PHASE-${String(state.phases.length + 1).padStart(2, '0')}`;

    const newPhase: GraphPhase = {
      id,
      name: data.name,
      description: data.description,
      color: data.color ?? PHASE_PALETTE[colorIdx],
      nodeIds: allNodeIds,
      groupIds: allGroupIds,
      sequence: nextSeq,
    };

    // Remove these nodes/groups from any existing phase
    const phases = state.phases.map((p) => ({
      ...p,
      nodeIds: p.nodeIds.filter((nid) => !allNodeIds.includes(nid)),
      groupIds: (p.groupIds ?? []).filter((gid) => !allGroupIds.includes(gid)),
    }));

    const allPhasesAfterCreate = [...phases, newPhase];
    const adjustedPositions = pushNodesOutOfPhaseBand(
      state.positions,
      allPhasesAfterCreate,
      newPhase.id,
      NODE_W
    );
    const collapsedGroupIds1 = new Set(state.groups.filter((g) => g.collapsed).map((g) => g.id));
    const resolvedPositions = resolveNodeOverlaps(adjustedPositions, collapsedGroupIds1, GROUP_R);

    const otherMode: ViewMode = state.viewMode === 'dag' ? 'lanes' : 'dag';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [otherMode]: _dropped, ...cacheWithoutOther } = state.layoutCache;
    const updatedCache: Record<string, LayoutSnapshot> = {
      ...cacheWithoutOther,
      [state.viewMode]: { positions: resolvedPositions, transform: state.transform },
    };

    set({
      phases: allPhasesAfterCreate,
      positions: resolvedPositions,
      layoutCache: updatedCache,
      designDirty: true,
      undoStack: [...state.undoStack, undoSnapshot].slice(-50),
      redoStack: [],
    });
  },

  // ── updatePhase ───────────────────────────────────────────────────────────
  updatePhase: (id, changes) => {
    const state = get();
    const phases = state.phases.map((p) => (p.id === id ? { ...p, ...changes } : p));
    set({ phases, designDirty: true });
  },

  // ── deletePhase ───────────────────────────────────────────────────────────
  deletePhase: (id) => {
    const state = get();

    const undoSnapshot: UndoSnapshot = {
      nodes: [...state.allNodes],
      positions: { ...state.positions },
      groups: [...state.groups],
      phases: [...state.phases],
    };

    const phases = state.phases.filter((p) => p.id !== id);
    set({
      phases,
      selectedPhaseId: state.selectedPhaseId === id ? null : state.selectedPhaseId,
      focusedPhaseId: state.focusedPhaseId === id ? null : state.focusedPhaseId,
      collapsedPhaseIds: state.collapsedPhaseIds.filter((x) => x !== id),
      designDirty: true,
      undoStack: [...state.undoStack, undoSnapshot].slice(-50),
      redoStack: [],
    });
  },

  // ── assignNodesToPhase ────────────────────────────────────────────────────
  assignNodesToPhase: (nodeIds, phaseId) => {
    const state = get();
    const phases = state.phases.map((p) => {
      if (p.id === phaseId) {
        // Add without duplication
        const merged = [...new Set([...p.nodeIds, ...nodeIds])];
        return { ...p, nodeIds: merged };
      }
      // Remove from all other phases
      return { ...p, nodeIds: p.nodeIds.filter((nid) => !nodeIds.includes(nid)) };
    });

    // Push non-members out of the (potentially expanded) phase band
    const adjustedPositions = pushNodesOutOfPhaseBand(state.positions, phases, phaseId, NODE_W);
    const collapsedGroupIds2 = new Set(state.groups.filter((g) => g.collapsed).map((g) => g.id));
    const resolvedPositions2 = resolveNodeOverlaps(adjustedPositions, collapsedGroupIds2, GROUP_R);

    const otherMode: ViewMode = state.viewMode === 'dag' ? 'lanes' : 'dag';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [otherMode]: _dropped, ...cacheWithoutOther } = state.layoutCache;
    const updatedCache: Record<string, LayoutSnapshot> = {
      ...cacheWithoutOther,
      [state.viewMode]: { positions: resolvedPositions2, transform: state.transform },
    };

    set({ phases, positions: resolvedPositions2, layoutCache: updatedCache, designDirty: true });
  },

  // ── removeNodesFromPhase ──────────────────────────────────────────────────
  removeNodesFromPhase: (nodeIds) => {
    const state = get();
    const phases = state.phases.map((p) => ({
      ...p,
      nodeIds: p.nodeIds.filter((nid) => !nodeIds.includes(nid)),
    }));
    set({ phases, designDirty: true });
  },

  // ── assignGroupsToPhase ───────────────────────────────────────────────────
  assignGroupsToPhase: (groupIds, phaseId) => {
    const state = get();

    // Expand each group to include all nested descendant groups and their nodes
    const allGroupIds = [...new Set([
      ...groupIds,
      ...groupIds.flatMap((gid) => getAllDescendantGroupIds(gid, state.groups)),
    ])];
    const allNodeIds = [...new Set(
      groupIds.flatMap((gid) => getAllDescendantNodeIds(gid, state.groups)),
    )];

    const phases = state.phases.map((p) => {
      if (p.id === phaseId) {
        const mergedGroups = [...new Set([...(p.groupIds ?? []), ...allGroupIds])];
        const mergedNodes = [...new Set([...p.nodeIds, ...allNodeIds])];
        return { ...p, groupIds: mergedGroups, nodeIds: mergedNodes };
      }
      return {
        ...p,
        groupIds: (p.groupIds ?? []).filter((gid) => !allGroupIds.includes(gid)),
        nodeIds: p.nodeIds.filter((nid) => !allNodeIds.includes(nid)),
      };
    });

    const adjustedPositions = pushNodesOutOfPhaseBand(
      state.positions, phases, phaseId, NODE_W, state.groups, GROUP_R,
      state.viewMode === 'lanes' ? LANE_LABEL_W : undefined
    );
    const collapsedGroupIds3 = new Set(state.groups.filter((g) => g.collapsed).map((g) => g.id));
    const resolvedPositions3 = resolveNodeOverlaps(adjustedPositions, collapsedGroupIds3, GROUP_R);

    const otherMode: ViewMode = state.viewMode === 'dag' ? 'lanes' : 'dag';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [otherMode]: _dropped, ...cacheWithoutOther } = state.layoutCache;
    const updatedCache: Record<string, LayoutSnapshot> = {
      ...cacheWithoutOther,
      [state.viewMode]: { positions: resolvedPositions3, transform: state.transform },
    };

    set({ phases, positions: resolvedPositions3, layoutCache: updatedCache, designDirty: true });
  },

  // ── removeGroupsFromPhase ─────────────────────────────────────────────────
  removeGroupsFromPhase: (groupIds) => {
    const state = get();
    const phases = state.phases.map((p) => ({
      ...p,
      groupIds: (p.groupIds ?? []).filter((gid) => !groupIds.includes(gid)),
    }));
    set({ phases, designDirty: true });
  },

  // ── settleAllPhases ───────────────────────────────────────────────────────
  settleAllPhases: () => {
    const state = get();
    if (state.phases.length === 0) return;
    let settled: Record<string, { x: number; y: number }>;
    if (state.viewMode === 'lanes') {
      settled = enforceAllPhaseBoundaries(state.positions, state.phases, state.groups, GROUP_R, LANE_LABEL_W);
    } else {
      // DAG mode: chain pushNodesOutOfPhaseBand for each phase sorted by sequence
      const sorted = [...state.phases].sort((a, b) => a.sequence - b.sequence);
      settled = state.positions;
      for (const phase of sorted) {
        settled = pushNodesOutOfPhaseBand(settled, state.phases, phase.id, NODE_W, state.groups, GROUP_R, undefined);
      }
    }
    set({ positions: settled, designDirty: true });
  },

  // ── reorderPhasesByPosition ───────────────────────────────────────────────
  reorderPhasesByPosition: () => {
    const { phases, positions } = get();
    const withMeanX = phases.map((ph) => {
      const pts = ph.nodeIds.map((nid) => positions[nid]).filter(Boolean) as { x: number; y: number }[];
      const meanX = pts.length > 0 ? pts.reduce((s, p) => s + p.x, 0) / pts.length : Infinity;
      return { id: ph.id, meanX };
    });
    withMeanX.sort((a, b) => a.meanX - b.meanX);
    const updated = phases.map((ph) => ({
      ...ph,
      sequence: withMeanX.findIndex((w) => w.id === ph.id),
    }));
    set({ phases: updated, designDirty: true });
  },

  // ── resolveOverlaps ───────────────────────────────────────────────────────
  resolveOverlaps: () => {
    const state = get();
    if (Object.keys(state.positions).length < 2) return;
    const collapsedGroupIds = new Set(state.groups.filter((g) => g.collapsed).map((g) => g.id));
    const resolved = resolveNodeOverlaps(state.positions, collapsedGroupIds, GROUP_R);
    set({ positions: resolved, designDirty: true });
  },

  // ── settleAndResolve ──────────────────────────────────────────────────────
  settleAndResolve: (anchorIds?: Set<string>) => {
    const state = get();
    if (Object.keys(state.positions).length < 2) return;

    // Step 1 — phase band enforcement (same logic as settleAllPhases)
    let positions = state.positions;
    if (state.phases.length > 0) {
      if (state.viewMode === 'lanes') {
        positions = enforceAllPhaseBoundaries(positions, state.phases, state.groups, GROUP_R, LANE_LABEL_W);
      } else {
        const sorted = [...state.phases].sort((a, b) => a.sequence - b.sequence);
        for (const phase of sorted) {
          positions = pushNodesOutOfPhaseBand(positions, state.phases, phase.id, NODE_W, state.groups, GROUP_R, undefined);
        }
      }
    }

    // Step 2 — overlap resolution with legibility padding
    const collapsedGroupIds = new Set(state.groups.filter((g) => g.collapsed).map((g) => g.id));
    positions = resolveNodeOverlaps(
      positions, collapsedGroupIds, GROUP_R,
      LEGIBILITY_PAD_X, LEGIBILITY_PAD_Y,
      anchorIds ?? new Set()
    );

    // Step 3 — clamp Y back to lane bounds in LANES view
    // (overlap resolution may have pushed nodes outside their owner lane)
    if (state.viewMode === 'lanes') {
      const clamped: Record<string, Position> = {};
      Object.entries(positions).forEach(([id, pos]) => {
        const node = state.allNodes.find((n) => n.id === id);
        if (node) {
          const lane = state.laneMetrics[node.owner];
          if (lane) {
            const margin = 6;
            clamped[id] = {
              ...pos,
              y: Math.max(lane.y + margin, Math.min(lane.y + lane.height - NODE_H - margin, pos.y)),
            };
            return;
          }
        }
        clamped[id] = pos;
      });
      positions = clamped;
    }

    set({ positions, designDirty: true });
  },

  // ── setSelectedPhaseId ────────────────────────────────────────────────────
  setSelectedPhaseId: (id) => set({ selectedPhaseId: id, selectedNodeId: null, selectedGroupId: null }),

  // ── setFocusedPhaseId ─────────────────────────────────────────────────────
  setFocusedPhaseId: (id) => set({ focusedPhaseId: id }),

  // ── collapsePhase ─────────────────────────────────────────────────────────
  collapsePhase: (id) => {
    const state = get();
    if (state.collapsedPhaseIds.includes(id)) return;
    set({ collapsedPhaseIds: [...state.collapsedPhaseIds, id] });
  },

  // ── expandPhase ───────────────────────────────────────────────────────────
  expandPhase: (id) => set((s) => ({
    collapsedPhaseIds: s.collapsedPhaseIds.filter((x) => x !== id),
  })),

  // ── togglePhaseCollapse ───────────────────────────────────────────────────
  togglePhaseCollapse: (id) => {
    const state = get();
    set({
      collapsedPhaseIds: state.collapsedPhaseIds.includes(id)
        ? state.collapsedPhaseIds.filter((x) => x !== id)
        : [...state.collapsedPhaseIds, id],
    });
  },

  // ── collapseAllPhases ─────────────────────────────────────────────────────
  collapseAllPhases: () => set((s) => ({
    collapsedPhaseIds: s.phases.map((p) => p.id),
  })),

  // ── expandAllPhases ───────────────────────────────────────────────────────
  expandAllPhases: () => set({ collapsedPhaseIds: [] }),

  // ── copySelection ─────────────────────────────────────────────────────────
  copySelection: () => {
    const state = get();
    const groupIdSet = new Set(state.groups.map((g) => g.id));

    let nodeIds: string[];
    if (state.multiSelectIds.length > 0) {
      nodeIds = state.multiSelectIds.filter((id) => !groupIdSet.has(id));
    } else if (state.selectedNodeId) {
      nodeIds = [state.selectedNodeId];
    } else {
      return;
    }

    const clipboard = state.allNodes.filter((n) => nodeIds.includes(n.id));
    if (clipboard.length > 0) {
      set({ clipboard });
    }
  },

  // ── pasteClipboard ────────────────────────────────────────────────────────
  pasteClipboard: () => {
    const state = get();
    const { clipboard, allNodes, positions } = state;
    if (clipboard.length === 0) return;

    // Push undo snapshot
    const undoSnapshot: UndoSnapshot = {
      nodes: [...allNodes],
      positions: { ...positions },
      groups: [...state.groups],
    };
    const undoStack = [...state.undoStack, undoSnapshot].slice(-50);

    // Generate unique new IDs for each clipboard node
    const existingIds = new Set(allNodes.map((n) => n.id));
    const idMap = new Map<string, string>();
    const clipboardIdSet = new Set(clipboard.map((n) => n.id));
    let counter = allNodes.length + 1;

    for (const node of clipboard) {
      while (existingIds.has(`NODE-${String(counter).padStart(2, '0')}`)) {
        counter++;
      }
      const newId = `NODE-${String(counter).padStart(2, '0')}`;
      idMap.set(node.id, newId);
      existingIds.add(newId);
      counter++;
    }

    // Create pasted nodes: remap internal deps, keep external deps as-is
    const PASTE_OFFSET = 80;
    const newNodes: GraphNode[] = clipboard.map((node) => ({
      ...node,
      id: idMap.get(node.id)!,
      dependencies: node.dependencies.map((dep) =>
        clipboardIdSet.has(dep) ? idMap.get(dep)! : dep
      ),
    }));

    // Compute pasted positions offset from originals
    const newPositions: Record<string, Position> = {};
    for (const node of clipboard) {
      const orig = positions[node.id];
      const newId = idMap.get(node.id)!;
      newPositions[newId] = orig
        ? { x: orig.x + PASTE_OFFSET, y: orig.y + PASTE_OFFSET }
        : { x: 200, y: 200 };
    }

    const allNodesNew = [...allNodes, ...newNodes];
    const allEdges = rebuildEdgesFromNodes(allNodesNew);
    const ownerColors = assignOwnerColors([...new Set(allNodesNew.map((n) => n.owner))]);

    // Ensure pasted nodes' owners are visible
    const activeOwners = new Set(state.activeOwners);
    for (const node of newNodes) activeOwners.add(node.owner);

    const { visibleNodes, visibleEdges } = deriveVisibility(
      allNodesNew, allEdges, activeOwners, state.focusMode, state.focusNodeId, state.groups
    );

    const newNodeIds = newNodes.map((n) => n.id);
    set({
      allNodes: allNodesNew,
      allEdges,
      visibleNodes,
      visibleEdges,
      positions: { ...positions, ...newPositions },
      ownerColors,
      activeOwners,
      multiSelectIds: newNodeIds,
      selectedNodeId: newNodeIds.length === 1 ? newNodeIds[0] : null,
      selectedGroupId: null,
      designDirty: true,
      undoStack,
      redoStack: [],
    });
  },

  // ── setOwnerColor ─────────────────────────────────────────────────────────
  setOwnerColor: (owner, color) => {
    set((s) => ({ ownerColors: { ...s.ownerColors, [owner]: color } }));
  },

  // ── renameOwner ───────────────────────────────────────────────────────────
  renameOwner: (oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    const state = get();

    const allNodes = state.allNodes.map((n) =>
      n.owner === oldName ? { ...n, owner: trimmed } : n
    );

    const ownerColors = { ...state.ownerColors };
    if (ownerColors[oldName] !== undefined) {
      ownerColors[trimmed] = ownerColors[oldName];
      delete ownerColors[oldName];
    }

    const activeOwners = new Set(state.activeOwners);
    if (activeOwners.has(oldName)) {
      activeOwners.delete(oldName);
      activeOwners.add(trimmed);
    }

    const groups = state.groups.map((g) => ({
      ...g,
      owners: g.owners.map((o) => (o === oldName ? trimmed : o)),
    }));

    const { visibleNodes, visibleEdges } = deriveVisibility(
      allNodes, state.allEdges, activeOwners, state.focusMode, state.focusNodeId, groups
    );

    set({ allNodes, ownerColors, activeOwners, groups, visibleNodes, visibleEdges, designDirty: true });
  },

  // ── recolorTag ────────────────────────────────────────────────────────────
  recolorTag: (label, color) => {
    const key = label.toLowerCase();
    set((s) => {
      const updateNodes = (nodes: typeof s.allNodes) =>
        nodes.map((n) => {
          if (!n.tags?.some((t) => t.label.toLowerCase() === key)) return n;
          return { ...n, tags: n.tags.map((t) => t.label.toLowerCase() === key ? { ...t, color } : t) };
        });
      const tagRegistry = s.tagRegistry.map((t) =>
        t.label.toLowerCase() === key ? { ...t, color } : t
      );
      return {
        allNodes: updateNodes(s.allNodes),
        visibleNodes: updateNodes(s.visibleNodes),
        tagRegistry,
        designDirty: true,
      };
    });
  },

  // ── renameTag ─────────────────────────────────────────────────────────────
  renameTag: (oldLabel, newLabel) => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    const key = oldLabel.toLowerCase();
    set((s) => {
      const updateNodes = (nodes: typeof s.allNodes) =>
        nodes.map((n) => {
          if (!n.tags?.some((t) => t.label.toLowerCase() === key)) return n;
          return { ...n, tags: n.tags.map((t) => t.label.toLowerCase() === key ? { ...t, label: trimmed } : t) };
        });
      const tagRegistry = s.tagRegistry.map((t) =>
        t.label.toLowerCase() === key ? { ...t, label: trimmed } : t
      );
      return {
        allNodes: updateNodes(s.allNodes),
        visibleNodes: updateNodes(s.visibleNodes),
        tagRegistry,
        designDirty: true,
      };
    });
  },

  // ── addTagToRegistry ──────────────────────────────────────────────────────
  addTagToRegistry: (tag) => {
    set((s) => {
      const key = tag.label.toLowerCase();
      if (s.tagRegistry.some((t) => t.label.toLowerCase() === key)) return s;
      // Also skip if already on any node — it's already in the "global" pool
      const onNode = s.allNodes.some((n) =>
        n.tags?.some((t) => t.label.toLowerCase() === key)
      );
      if (onNode) return s;
      return { tagRegistry: [...s.tagRegistry, tag] };
    });
  },

  // ── removeTagFromRegistry ─────────────────────────────────────────────────
  removeTagFromRegistry: (label) => {
    const key = label.toLowerCase();
    set((s) => ({
      tagRegistry: s.tagRegistry.filter((t) => t.label.toLowerCase() !== key),
    }));
  },

  // ── addOwnerToRegistry ────────────────────────────────────────────────────
  addOwnerToRegistry: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    set((s) => {
      // No-op if already on a node or already in registry
      if (s.allNodes.some((n) => n.owner.toLowerCase() === key)) return s;
      if (s.ownerRegistry.some((o) => o.toLowerCase() === key)) return s;
      return { ownerRegistry: [...s.ownerRegistry, trimmed] };
    });
  },

  // ── removeOwnerFromRegistry ───────────────────────────────────────────────
  removeOwnerFromRegistry: (name) => {
    const key = name.toLowerCase();
    set((s) => ({
      ownerRegistry: s.ownerRegistry.filter((o) => o.toLowerCase() !== key),
    }));
  },
}));
