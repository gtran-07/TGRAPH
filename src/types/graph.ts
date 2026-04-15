/**
 * types/graph.ts — All shared TypeScript interfaces and types for FlowGraph.
 *
 * This file is the single source of truth for data shapes. Every component,
 * hook, utility, and adapter imports types from here — never redefines them.
 *
 * What belongs here: data shapes, union types, enums, generic interfaces.
 * What does NOT belong here: React component prop types (those live in their component files).
 */

// ─── CORE DATA TYPES ────────────────────────────────────────────────────────

/**
 * GraphNode — the fundamental unit of the graph.
 * Each node represents a step, task, or process in the flow.
 *
 * This shape is also the canonical JSON format for file import/export
 * and maps directly to SharePoint list columns (see sharepointAdapter.ts).
 */
/** A single tag attached to a node — a short label with a display color. */
export interface NodeTag {
  /** Display label. Keep short (≤60 chars). */
  label: string;
  /** Hex color string, e.g. "#ef4444". */
  color: string;
}

export interface GraphNode {
  /** Unique identifier. Used as the key for positions, edges, and dependencies. Case-sensitive. */
  id: string;
  /** Display label shown on the node card. Keep short (≤60 chars) for readability. */
  name: string;
  /** The owner, team, or swim lane this node belongs to. Determines node color and lane grouping. */
  owner: string;
  /** 1–3 sentence explanation of what this step involves. Shown in the Inspector panel. */
  description: string;
  /**
   * IDs of nodes that must be completed BEFORE this node can start.
   * Direction: if B depends on A, then B.dependencies = ["A"].
   * This is the prerequisite list, NOT the downstream list.
   */
  dependencies: string[];
  /** Optional tags for categorising or flagging the node. Each tag has a label and a color. */
  tags?: NodeTag[];
}

/**
 * GraphEdge — a directed connection between two nodes.
 * Edges are derived from node dependencies — they are never stored independently.
 *
 * Direction: from → to means "from must happen before to".
 * In other words: to.dependencies includes from.id.
 */
export interface GraphEdge {
  /** ID of the prerequisite node (the one that must happen first) */
  from: string;
  /** ID of the dependent node (the one that cannot start until 'from' is done) */
  to: string;
}

/**
 * Position — the x/y coordinate of a node on the SVG canvas.
 * These are in SVG user-space coordinates, not screen pixels.
 * The canvas transform (pan/zoom) is applied separately via graphRoot's transform attribute.
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Transform — the current pan and zoom state of the canvas viewport.
 * Applied as an SVG transform: translate(x, y) scale(k)
 */
export interface Transform {
  /** Horizontal pan offset in screen pixels */
  x: number;
  /** Vertical pan offset in screen pixels */
  y: number;
  /** Zoom scale factor. 1.0 = 100%, 0.5 = 50%, 2.0 = 200% */
  k: number;
}

// ─── LAYOUT TYPES ───────────────────────────────────────────────────────────

/**
 * LayoutSnapshot — a saved state of node positions and the viewport transform.
 * Used by the layout cache to restore exact positions when switching view modes
 * or returning from focus mode.
 */
export interface LayoutSnapshot {
  /** Each node's position at the time of the snapshot */
  positions: Record<string, Position>;
  /** The viewport pan/zoom at the time of the snapshot */
  transform: Transform;
}

/**
 * LaneMetrics — the computed vertical bounds of a swim lane.
 * Used in LANES view to position nodes within their owner's horizontal band
 * and to draw the lane background rectangles.
 */
export interface LaneMetrics {
  /** The top Y coordinate of this lane (in SVG user-space) */
  y: number;
  /** The total height of this lane, including padding */
  height: number;
}

// ─── UI STATE TYPES ──────────────────────────────────────────────────────────

/**
 * ViewMode — which layout algorithm is currently active.
 * - 'dag': Sugiyama-style left-to-right DAG layout. Best for understanding overall flow.
 * - 'lanes': Swim lane layout grouped by owner. Best for understanding who does what.
 */
export type ViewMode = 'dag' | 'lanes';

/**
 * DesignTool — which design mode tool is currently selected.
 * - 'select': default mode; drag nodes, click to inspect
 * - 'add': click empty canvas to add a new node at that position
 * - 'connect': click source node then target node to draw a directed edge
 */
export type DesignTool = 'select' | 'add' | 'connect';

/**
 * SavedLayout — a named layout snapshot stored in localStorage.
 * Users can save their current arrangement and restore it later.
 */
export interface SavedLayout {
  /** User-provided name for this layout */
  name: string;
  /** ISO timestamp string of when this layout was saved */
  savedAt: string;
  /** Which view mode was active when this layout was saved */
  viewMode: ViewMode;
  /** The full layout snapshot (positions + transform) */
  snapshot: LayoutSnapshot;
}

/**
 * FocusSnapshot — the graph state captured immediately before entering focus mode.
 * Stored so we can restore the exact pre-focus view when the user exits focus mode.
 */
export interface FocusSnapshot {
  /** Which view mode was active before focus was entered */
  viewModeAtEnter: ViewMode;
  /** Node positions before focus was entered */
  positions: Record<string, Position>;
  /** Lane metrics before focus was entered (needed to restore LANES view correctly) */
  laneMetrics: Record<string, LaneMetrics>;
  /** Viewport transform before focus was entered */
  transform: Transform;
  /** Which nodes were visible before focus was entered */
  visibleNodes: GraphNode[];
  /** Which edges were visible before focus was entered */
  visibleEdges: GraphEdge[];
}

// ─── ADAPTER TYPES ───────────────────────────────────────────────────────────

/**
 * GraphAdapter — the interface every data source must implement.
 *
 * Why this abstraction exists: the app should be completely unaware of WHERE
 * data comes from or goes to. Swapping from file-based storage to SharePoint
 * only requires implementing this two-method interface.
 *
 * Current implementations:
 *   - FileAdapter      → loads/saves local JSON files via browser File API
 *   - SharePointAdapter → stubbed; uses Microsoft Graph API (needs MSAL auth)
 */
export interface GraphAdapter {
  /** Human-readable label shown in the UI, e.g. "Local File" or "SharePoint" */
  readonly label: string;
  /**
   * Fetch all nodes from the data source.
   * @throws Error if the data source is unavailable or the data is malformed
   */
  load(): Promise<GraphNode[]>;
  /**
   * Persist all nodes back to the data source.
   * @param nodes - The complete current node list (full replace, not partial update)
   * @throws Error if the save fails
   */
  save(nodes: GraphNode[]): Promise<void>;
}

/**
 * UndoSnapshot — a point-in-time snapshot of nodes and positions for undo/redo.
 */
export interface UndoSnapshot {
  nodes: GraphNode[];
  positions: Record<string, Position>;
  groups: GraphGroup[];
  phases?: GraphPhase[];
}

// ─── PHASE TYPES ─────────────────────────────────────────────────────────────

/**
 * 8 soft pastel colors auto-assigned to phases in order.
 * Users may override with any hex value.
 */
export const PHASE_PALETTE = [
  '#4A90D9', // Sky Blue
  '#27AE60', // Emerald Green
  '#F5A623', // Amber
  '#9B59B6', // Violet
  '#E74C3C', // Coral Red
  '#16A085', // Teal
  '#E67E22', // Burnt Orange
  '#2980B9', // Ocean Blue
] as const;

/**
 * GraphPhase — a named time/progress band shown as a vertical column on the canvas.
 *
 * Phases capture the _when_ dimension (e.g. "Discovery → Design → Build → Deploy").
 * They are purely visual overlays: they do NOT affect layout, visibility, or dependencies.
 * A node belongs to at most one phase (flat — no nesting unlike groups).
 */
export interface GraphPhase {
  /** Unique identifier in the format "PHASE-01" */
  id: string;
  /** Display name shown in the band header and navigator pill */
  name: string;
  /** Optional detail shown in the Inspector */
  description: string;
  /** Hex color from PHASE_PALETTE or user-chosen */
  color: string;
  /** IDs of nodes assigned to this phase */
  nodeIds: string[];
  /** IDs of collapsed groups assigned to this phase */
  groupIds?: string[];
  /** 0, 1, 2… determines left-to-right band order on the canvas */
  sequence: number;
}

// ─── GROUP TYPES ─────────────────────────────────────────────────────────────

/**
 * GraphGroup — a named collection of connected nodes (and/or sub-groups).
 *
 * Groups form a hierarchy: a group may contain nodes (childNodeIds) and/or
 * other groups (childGroupIds). The nesting depth determines the polygon shape:
 *   depth 1 → pentagon (5 sides), depth 2 → hexagon (6 sides), etc.
 *
 * When collapsed the group is rendered as a polygon placeholder and all its
 * descendant nodes are hidden from the canvas. When expanded an overlay
 * bounding-box is drawn around the children.
 */
/** Metadata block written to every saved JSON file as `_meta`. */
export interface GraphMeta {
  note: string;
  app: string;
  author: string;
  usage: string;
}

export interface GraphGroup {
  /** Unique identifier in the format "GROUP-XX" */
  id: string;
  /** Display name shown on the group polygon */
  name: string;
  /** Optional description shown in the Inspector */
  description: string;
  /**
   * Owner names derived from the group's children.
   * Single entry when all children share an owner; multiple when mixed.
   */
  owners: string[];
  /** IDs of nodes that are direct (immediate) children of this group */
  childNodeIds: string[];
  /** IDs of sub-groups that are direct children of this group */
  childGroupIds: string[];
  /** When true the group is rendered as a collapsed polygon on the canvas */
  collapsed: boolean;
}
