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
  // ── Cinema author fields ──────────────────────────────────────────────────
  /** Author-written narration body; overrides auto-generated body verbatim */
  cinemaScript?: string;
  /** When true, forces this node to render as a bottleneck scene in cinema */
  cinemaBottleneck?: boolean;
  /** When true, this node is excluded from the cinema pipeline entirely */
  cinemaSkip?: boolean;
}

/**
 * PathType — the structural weight of an edge, rendered via V-Groove engraving.
 * Always applied when pathType data is present; defaults to 'standard'.
 */
export type PathType = 'optional' | 'standard' | 'priority' | 'critical';

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
  /** Runtime-only: injected from edgePathTypes store map; NOT stored on the edge object itself */
  pathType?: PathType;
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
 * - 'tracePath': click source node then target to find and assign path types to a traced route
 */
export type DesignTool = 'select' | 'add' | 'connect' | 'tracePath';

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
 * OwnerFocusSnapshot — the graph state captured immediately before entering owner focus mode.
 * Stored so we can restore the exact pre-focus layout when the user exits owner focus.
 */
export interface OwnerFocusSnapshot {
  /** The activeOwners set before owner focus was entered */
  activeOwners: Set<string>;
  /** Node positions before owner focus was entered */
  positions: Record<string, Position>;
  /** Lane metrics before owner focus was entered */
  laneMetrics: Record<string, LaneMetrics>;
  /** Viewport transform before owner focus was entered */
  transform: Transform;
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
  edgePathTypes?: Record<string, PathType>;
}

// ─── PHASE TYPES ─────────────────────────────────────────────────────────────

/**
 * 16 high-distinction colors used for phases, tags, and owners.
 * Covers the full hue spectrum with sufficient spacing to tell apart easily.
 */
export const PHASE_PALETTE = [
  '#E53935', // Red
  '#F4511E', // Deep Orange
  '#FB8C00', // Orange
  '#FFB300', // Amber
  '#C0CA33', // Lime
  '#7CB342', // Light Green
  '#43A047', // Green
  '#00897B', // Teal
  '#00ACC1', // Cyan
  '#039BE5', // Sky Blue
  '#1E88E5', // Blue
  '#3949AB', // Indigo
  '#8E24AA', // Purple
  '#D81B60', // Pink
  '#6D4C41', // Brown
  '#757575', // Gray
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
  // ── Cinema author fields ──────────────────────────────────────────────────
  /** Author-written narration body; overrides auto-generated body verbatim */
  cinemaScript?: string;
  /** When true, forces this group to render as a bottleneck scene in cinema */
  cinemaBottleneck?: boolean;
  /** When true, this group is excluded from the cinema pipeline entirely */
  cinemaSkip?: boolean;
}

// ─── CINEMA TYPES ─────────────────────────────────────────────────────────────

/**
 * The visual role a scene plays in the cinema narrative.
 * Determines template, reading time weight, and prediction gate eligibility.
 */
export type CinemaSceneType =
  | 'genesis'      // all roots grouped into one opening scene
  | 'terminal'     // all sinks grouped into one closing scene
  | 'fork'         // outDegree >= 2; process splits into parallel paths
  | 'bottleneck'   // inDegree >= 2 AND on critical path; convergence under pressure
  | 'convergence'  // inDegree >= 2 NOT on critical path; has slack
  | 'bridge'       // first node entering a new phase (phase-override mode only)
  | 'reveal'       // everything else; standard narrative scene
  | 'parallel'     // sibling-compressed group of same-depth, same-parent nodes
  | 'prediction';  // interactive gate; locked until the user answers

/** One option in a prediction gate question. */
export interface CinemaPredictionOption {
  id: string;
  text: string;
  isCorrect: boolean;
  /** Shown after the user selects this option — explains why it is right or wrong. */
  feedback: string;
}

/** An interactive prediction gate embedded between narrative scenes. */
export interface CinemaPredictionGate {
  question: string;
  options: CinemaPredictionOption[];
}

/** A single scene in the cinema sequence. */
export interface CinemaScene {
  type: CinemaSceneType;
  act: 1 | 2 | 3;
  /** Primary node(s) for this scene. Parallel scenes list all grouped nodes. */
  nodeIds: string[];
  headline: string;
  body: string;
  /** Structural insight. Omitted for simple reveal scenes without critical-path membership. */
  insight?: string;
  /** Ids of the shared parents for a parallel group scene. */
  parentIds?: string[];
  /** Ids of the convergence nodes that follow a parallel group. */
  convergenceIds?: string[];
  /** Present only on prediction scenes. */
  prediction?: CinemaPredictionGate;
  /** Pre-computed reading time in seconds (from READING_TIME_WEIGHTS in cinema.ts). */
  readingTimeSeconds: number;
}

/** The complete output of buildTourSequence(). */
export interface CinemaSequence {
  scenes: CinemaScene[];
  /** Total estimated viewing time, rounded to the nearest 0.5 min. */
  estimatedMinutes: number;
  /** Scene indices where Act II and Act III begin. */
  actBoundaries: { act2Start: number; act3Start: number };
  /** True when phase coverage was >= 30% and phase order drove act assignment. */
  usedPhaseOverride: boolean;
}

/** Normalized engagement score stored per nodeId after a cinema session. */
export type CinemaEngagementMap = Record<string, number>;

/**
 * DiscoveryPhase — which post-cinema phase the session is in.
 * null             → cinema has not started, or has fully exited
 * 'cinema'         → narration is active (scenes are playing)
 * 'transition'     → narration complete; user choosing between Phase 2 and Phase 3
 * 'reconstruction' → Phase 2: user rebuilding the graph from memory (blank-slot quiz)
 * 'heatmap'        → Phase 3: spatial engagement heatmap visible on canvas
 */
export type DiscoveryPhase = 'cinema' | 'transition' | 'reconstruction' | 'heatmap' | null;

/**
 * HeatTier — engagement tier assigned to a node after normalization in startHeatmap.
 *
 * hot  >= 2.0x baseline  (disproportionate attention)
 * warm >= 1.0x baseline  (at or above average)
 * cold  < 1.0x baseline  (seen but not dwelled on)
 * ice  = 0 or absent     (never appeared in cinema, or scored zero)
 */
export type HeatTier = 'hot' | 'warm' | 'cold' | 'ice';
