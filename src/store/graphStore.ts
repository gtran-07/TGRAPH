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
  Position,
  Transform,
  ViewMode,
  DesignTool,
  LayoutSnapshot,
  FocusSnapshot,
  LaneMetrics,
  UndoSnapshot,
} from '../types/graph';
import {
  computeLayout,
  computeLaneLayout,
  rebuildEdgesFromNodes,
  NODE_W,
  NODE_H,
  LANE_LABEL_W,
} from '../utils/layout';
import { assignOwnerColors } from '../utils/colors';

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
  fitToScreen: () => void;
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
  focusNodeId: string | null
): { visibleNodes: GraphNode[]; visibleEdges: GraphEdge[] } {
  let visibleNodes: GraphNode[];

  if (focusMode && focusNodeId) {
    // Focus mode: show only the focused node + its direct parents and children
    const focusedNode = allNodes.find((node) => node.id === focusNodeId);
    if (!focusedNode) {
      // The focused node no longer exists (shouldn't happen, but handle gracefully)
      return { visibleNodes: [], visibleEdges: [] };
    }

    const directParentIds = new Set(focusedNode.dependencies);
    const directChildIds = new Set(
      allEdges.filter((edge) => edge.from === focusNodeId).map((edge) => edge.to)
    );
    const focusedIds = new Set([focusNodeId, ...directParentIds, ...directChildIds]);

    visibleNodes = allNodes.filter(
      (node) => focusedIds.has(node.id) && activeOwners.has(node.owner)
    );
  } else {
    // Normal mode: show all nodes whose owner is active
    visibleNodes = allNodes.filter((node) => activeOwners.has(node.owner));
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
 */
function derivePositions(
  visibleNodes: GraphNode[],
  visibleEdges: GraphEdge[],
  viewMode: ViewMode,
  activeOwners: Set<string>,
  allNodes: GraphNode[]
): { positions: Record<string, Position>; laneMetrics: Record<string, LaneMetrics> } {
  if (viewMode === 'lanes') {
    return computeLaneLayout(visibleNodes, visibleEdges, activeOwners, allNodes);
  } else {
    return {
      positions: computeLayout(visibleNodes, visibleEdges),
      laneMetrics: {},
    };
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
  designMode: false,
  designTool: 'select',
  connectSourceId: null,
  designDirty: false,
  undoStack: [],
  redoStack: [],
  currentFileName: null,
  fileHandle: null,

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
      currentFileName: null,
      fileHandle: null,
    });
  },

  // ── setFileHandle ─────────────────────────────────────────────────────────
  setFileHandle: (handle) => set({ fileHandle: handle }),

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

    const { visibleNodes, visibleEdges } = deriveVisibility(
      nodes, allEdges, activeOwners, false, null
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
      : derivePositions(visibleNodes, visibleEdges, 'dag', activeOwners, nodes);

    set({
      allNodes: nodes,
      allEdges,
      visibleNodes,
      visibleEdges,
      positions: activeLayout ? activeLayout.positions : freshPositions,
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

    const undoSnapshot: UndoSnapshot = { nodes: [...state.allNodes], positions: { ...state.positions } };
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
      allNodes, allEdges, activeOwners, state.focusMode, state.focusNodeId
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

    const undoSnapshot: UndoSnapshot = { nodes: [...state.allNodes], positions: { ...state.positions } };
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
      allNodes, state.allEdges, activeOwners, state.focusMode, state.focusNodeId
    );

    set({ allNodes, visibleNodes, visibleEdges, ownerColors, activeOwners, designDirty: true, undoStack, redoStack: [] });
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

    const undoSnapshot: UndoSnapshot = { nodes: [...state.allNodes], positions: { ...state.positions } };
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

    const { visibleNodes, visibleEdges } = deriveVisibility(
      allNodes, allEdges, state.activeOwners, state.focusMode, state.focusNodeId
    );

    set({ allNodes, allEdges, visibleNodes, visibleEdges, positions, selectedNodeId, designDirty: true, undoStack, redoStack: [] });
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

    const undoSnapshot: UndoSnapshot = { nodes: [...state.allNodes], positions: { ...state.positions } };
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
      allNodes, allEdges, state.activeOwners, state.focusMode, state.focusNodeId
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

    const undoSnapshot: UndoSnapshot = { nodes: [...state.allNodes], positions: { ...state.positions } };
    const undoStack = [...state.undoStack, undoSnapshot].slice(-50);

    const allNodes = state.allNodes.map((node) => {
      if (node.id === toId) {
        return { ...node, dependencies: node.dependencies.filter((depId) => depId !== fromId) };
      }
      return node;
    });

    const allEdges = rebuildEdgesFromNodes(allNodes);

    const { visibleNodes, visibleEdges } = deriveVisibility(
      allNodes, allEdges, state.activeOwners, state.focusMode, state.focusNodeId
    );

    set({ allNodes, allEdges, visibleNodes, visibleEdges, designDirty: true, undoStack, redoStack: [] });
  },

  // ── setTransform ──────────────────────────────────────────────────────────
  setTransform: (transform: Transform) => set({ transform }),

  // ── setDesignMode ─────────────────────────────────────────────────────────
  setDesignMode: (on: boolean) => {
    set({
      designMode: on,
      // Reset tool to 'select' when toggling design mode on or off
      designTool: 'select',
      connectSourceId: null,
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
      // Restore the exact layout the user left behind in this view mode
      set({
        viewMode: mode,
        layoutCache: cache,
        positions: cachedLayout.positions,
        transform: cachedLayout.transform,
        laneMetrics: mode === 'lanes'
          ? computeLaneLayout(state.visibleNodes, state.visibleEdges, state.activeOwners, state.allNodes).laneMetrics
          : {},
      });
    } else {
      // No cache (or in focus mode) — compute fresh positions for the current visible set
      const { positions, laneMetrics } = derivePositions(
        state.visibleNodes, state.visibleEdges, mode, state.activeOwners, state.allNodes
      );
      set({ viewMode: mode, layoutCache: cache, positions, laneMetrics });
      setTimeout(() => get().fitToScreen(), 60);
    }
  },

  // ── setSelectedNode ───────────────────────────────────────────────────────
  setSelectedNode: (id: string | null) => set((s) => ({
    selectedNodeId: id,
    // Clear the search glow when selecting a different node
    lastJumpedNodeId: s.lastJumpedNodeId && s.lastJumpedNodeId !== id ? null : s.lastJumpedNodeId,
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
    const newRedoStack = [...state.redoStack, { nodes: [...state.allNodes], positions: { ...state.positions } }];

    const allNodes = prev.nodes;
    const allEdges = rebuildEdgesFromNodes(allNodes);
    const owners = [...new Set(allNodes.map((n) => n.owner))];
    const ownerColors = assignOwnerColors(owners, state.ownerColors);
    const activeOwners = new Set([...state.activeOwners].filter((o) => allNodes.some((n) => n.owner === o)));
    const { visibleNodes, visibleEdges } = deriveVisibility(allNodes, allEdges, activeOwners, state.focusMode, state.focusNodeId);

    set({
      allNodes, allEdges, visibleNodes, visibleEdges,
      positions: prev.positions, ownerColors, activeOwners,
      undoStack: newUndoStack, redoStack: newRedoStack, designDirty: true,
    });
  },

  // ── redo ──────────────────────────────────────────────────────────────────
  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    const newRedoStack = state.redoStack.slice(0, -1);
    const newUndoStack = [...state.undoStack, { nodes: [...state.allNodes], positions: { ...state.positions } }];

    const allNodes = next.nodes;
    const allEdges = rebuildEdgesFromNodes(allNodes);
    const owners = [...new Set(allNodes.map((n) => n.owner))];
    const ownerColors = assignOwnerColors(owners, state.ownerColors);
    const activeOwners = new Set([...state.activeOwners].filter((o) => allNodes.some((n) => n.owner === o)));
    const { visibleNodes, visibleEdges } = deriveVisibility(allNodes, allEdges, activeOwners, state.focusMode, state.focusNodeId);

    set({
      allNodes, allEdges, visibleNodes, visibleEdges,
      positions: next.positions, ownerColors, activeOwners,
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
      state.allNodes, state.allEdges, activeOwners, state.focusMode, state.focusNodeId
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

    set({ activeOwners, visibleNodes, visibleEdges, positions, laneMetrics, selectedNodeId });
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
      state.allNodes, state.allEdges, activeOwners, state.focusMode, state.focusNodeId
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

    set({ activeOwners, visibleNodes, visibleEdges, positions, laneMetrics, selectedNodeId: null });
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
      state.allNodes, state.allEdges, state.activeOwners, state.focusMode, state.focusNodeId
    );

    const { positions, laneMetrics } = derivePositions(
      visibleNodes, visibleEdges, state.viewMode, state.activeOwners, state.allNodes
    );

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

    // Save the current state for restoration on exit
    const preFocusSnapshot: FocusSnapshot = {
      viewModeAtEnter: state.viewMode,
      positions: { ...state.positions },
      transform: { ...state.transform },
      visibleNodes: [...state.visibleNodes],
      visibleEdges: [...state.visibleEdges],
    };

    const { visibleNodes, visibleEdges } = deriveVisibility(
      state.allNodes, state.allEdges, state.activeOwners, true, nodeId
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
      // Same view mode as when focus was entered — restore the exact pre-focus layout.
      // snapshot.transform is the exact camera the user had before double-clicking,
      // so we set it directly. No fitToScreen call needed or wanted here.
      set({
        focusMode: false,
        focusNodeId: null,
        preFocusSnapshot: null,
        visibleNodes: snapshot.visibleNodes,
        visibleEdges: snapshot.visibleEdges,
        positions: snapshot.positions,
        transform: snapshot.transform,
      });
    } else {
      // View mode changed while in focus — the snapshot belongs to a different view,
      // so discard it and rebuild the full graph in the current view mode.
      set({ focusMode: false, focusNodeId: null, preFocusSnapshot: null });
      get().rebuildGraph();
      // Fit after React renders the fresh layout (rebuildGraph doesn't touch the camera)
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
      state.allNodes, state.allEdges, state.activeOwners, false, null
    );

    set({
      positions: snapshot.positions,
      transform: snapshot.transform,
      viewMode,
      visibleNodes,
      visibleEdges,
      focusMode: false,
      focusNodeId: null,
    });
  },

  // ── fitToScreen ───────────────────────────────────────────────────────────

  /**
   * fitToScreen — computes a transform that centers and scales the graph to fill the viewport.
   *
   * This is called after loading data or resetting layout. The canvas element's
   * dimensions are read from the DOM to compute the correct scale and offset.
   */
  fitToScreen: () => {
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

    set({ transform: { x: offsetX, y: offsetY, k: scale } });
  },
}));
