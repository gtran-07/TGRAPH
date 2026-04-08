/**
 * utils/layout.ts — Pure layout algorithm functions for the FlowGraph canvas.
 *
 * This file contains ONLY pure functions with no side effects and no React/DOM dependencies.
 * Every function here can be unit-tested in isolation by passing in data and asserting output.
 *
 * Two layout algorithms are implemented:
 *   1. DAG layout  — Sugiyama-style left-to-right layered layout
 *   2. Lane layout — Swim lane layout grouped by node owner
 *
 * What does NOT belong here: any DOM manipulation, React state, or SVG rendering.
 */

import type { GraphNode, GraphEdge, GraphPhase, Position, LaneMetrics } from '../types/graph';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

/** Width of each node rectangle in SVG user-space units */
export const NODE_W = 180;
/** Horizontal padding applied to each side of a phase band beyond its node bounding box */
export const PHASE_PAD_X = 30;
/** Width (in SVG user-space) of a horizontally collapsed phase band */
export const COLLAPSED_W = 48;
/** Height of each node rectangle in SVG user-space units */
export const NODE_H = 72;
/** Horizontal gap between node columns (the space between layers) */
export const GAP_X = 140;
/** Vertical gap between nodes within the same column */
export const GAP_Y = 52;
/** Width reserved on the left of each swim lane for the lane label */
export const LANE_LABEL_W = 130;
/** Vertical padding inside each swim lane (space above first node and below last node) */
export const LANE_PAD_Y = 28;
/** Vertical gap between swim lanes */
export const LANE_GAP = 18;

// ─── INTERNAL TYPES (not exported — only used within this file) ──────────────

/** Maps node id → its layer index (0 = leftmost column, increases rightward) */
type LayerMap = Record<string, number>;

/** Maps layer index → list of node ids in that layer */
type LayerGroups = Record<number, string[]>;

/** Maps node id → list of adjacent node ids (either in-edges or out-edges) */
type AdjacencyMap = Record<string, string[]>;

// ─── DAG LAYOUT ─────────────────────────────────────────────────────────────

/**
 * computeLayout — Sugiyama-style layered DAG layout.
 *
 * Produces an x/y position for every node such that:
 *   - Nodes are arranged left-to-right by dependency depth (layer 0 = no dependencies)
 *   - Nodes in the same layer are stacked vertically, centered as a group
 *   - Edge crossings are minimized using the barycenter heuristic
 *
 * Algorithm steps:
 *   1. Assign each node to a layer (longest-path layering via BFS)
 *   2. Sort nodes within each layer to reduce edge crossings (barycenter, 3 passes)
 *   3. Assign (x, y) coordinates based on layer index and position within the layer
 *
 * @param nodes - The nodes to lay out (only nodes in this list are positioned)
 * @param edges - The edges connecting those nodes
 * @returns     - A map of node id → {x, y} position. Nodes not in the input return no entry.
 */
export function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Record<string, Position> {
  if (nodes.length === 0) return {};

  const nodeIds = nodes.map((node) => node.id);
  const nodeIdSet = new Set(nodeIds);

  // ── Step 1: Build adjacency structures ──────────────────────────────────
  // We need both in-degree (for topological sort) and adjacency lists (for barycenter).
  const inDegree: Record<string, number> = {};
  const outAdjacency: AdjacencyMap = {}; // outAdjacency[A] = nodes that A points TO
  const inAdjacency: AdjacencyMap = {};  // inAdjacency[B]  = nodes that point TO B

  nodeIds.forEach((nodeId) => {
    inDegree[nodeId] = 0;
    outAdjacency[nodeId] = [];
    inAdjacency[nodeId] = [];
  });

  edges.forEach((edge) => {
    // Only process edges where both endpoints are in the current node set.
    // This handles the case where we're laying out a subset of the full graph (e.g. focus mode).
    if (nodeIdSet.has(edge.from) && nodeIdSet.has(edge.to)) {
      inDegree[edge.to]++;
      outAdjacency[edge.from].push(edge.to);
      inAdjacency[edge.to].push(edge.from);
    }
  });

  // ── Step 2: Assign layers using longest-path layering (Kahn's BFS) ────
  // Each node's layer = the length of the longest path from any root to that node.
  // This ensures that all dependencies of a node appear to its left.
  //
  // We use a tempDeg counter (copy of inDegree) so a node only enters the queue
  // after ALL of its parents have been processed. Without this, a node with
  // multiple parents at different depths could be processed before its deepest
  // parent, producing a wrong (too-shallow) layer assignment.
  const layer: LayerMap = {};
  const tempDeg: Record<string, number> = { ...inDegree };

  const rootNodes = nodeIds.filter((nodeId) => inDegree[nodeId] === 0);
  rootNodes.forEach((nodeId) => { layer[nodeId] = 0; });

  const visited = new Set<string>();
  let bfsQueue = [...rootNodes];

  while (bfsQueue.length > 0) {
    const nextQueue: string[] = [];
    bfsQueue.forEach((currentId) => {
      if (visited.has(currentId)) return;
      visited.add(currentId);

      outAdjacency[currentId].forEach((childId) => {
        // Push the child's layer as far right as this parent requires.
        layer[childId] = Math.max(layer[childId] ?? 0, (layer[currentId] ?? 0) + 1);
        // Only enqueue once all parents have been accounted for.
        tempDeg[childId]--;
        if (tempDeg[childId] === 0) nextQueue.push(childId);
      });
    });
    bfsQueue = nextQueue;
  }

  // Handle any unvisited nodes (these exist in cycles — the BFS can't reach them).
  // Place them in the last layer as a fallback so they at least appear somewhere.
  const maxLayer = Math.max(0, ...Object.values(layer));
  nodeIds.forEach((nodeId) => {
    if (layer[nodeId] === undefined) layer[nodeId] = maxLayer;
  });

  // ── Step 3: Group nodes by layer ────────────────────────────────────────
  const layerGroups: LayerGroups = {};
  nodeIds.forEach((nodeId) => {
    const layerIndex = layer[nodeId];
    if (!layerGroups[layerIndex]) layerGroups[layerIndex] = [];
    layerGroups[layerIndex].push(nodeId);
  });

  // ── Step 4: Minimize edge crossings with barycenter heuristic ───────────
  // The barycenter heuristic sorts nodes within each layer based on the average
  // position of their neighbors in the adjacent layer. Running it forward (left→right)
  // then backward (right→left) in multiple passes progressively reduces crossings.
  //
  // Why 3 passes? 1 pass gives a decent result; 3 passes converges close to optimal
  // without being computationally expensive. More than 3 passes rarely helps.
  const sortedLayerIndices = Object.keys(layerGroups).map(Number).sort((a, b) => a - b);

  for (let pass = 0; pass < 3; pass++) {
    // Forward sweep: sort each layer based on positions of nodes in the PREVIOUS layer
    sortedLayerIndices.forEach((layerIndex, positionInSortedList) => {
      if (positionInSortedList === 0) return; // No previous layer to reference
      layerGroups[layerIndex].sort((nodeA, nodeB) => {
        const scoreA = computeBarycenter(nodeA, inAdjacency, layerGroups, layer, sortedLayerIndices, positionInSortedList);
        const scoreB = computeBarycenter(nodeB, inAdjacency, layerGroups, layer, sortedLayerIndices, positionInSortedList);
        return scoreA - scoreB;
      });
    });

    // Backward sweep: sort each layer based on positions of nodes in the NEXT layer
    for (let positionInSortedList = sortedLayerIndices.length - 2; positionInSortedList >= 0; positionInSortedList--) {
      const layerIndex = sortedLayerIndices[positionInSortedList];
      layerGroups[layerIndex].sort((nodeA, nodeB) => {
        const scoreA = computeBarycenter(nodeA, outAdjacency, layerGroups, layer, sortedLayerIndices, positionInSortedList, true);
        const scoreB = computeBarycenter(nodeB, outAdjacency, layerGroups, layer, sortedLayerIndices, positionInSortedList, true);
        return scoreA - scoreB;
      });
    }
  }

  // ── Step 5: Assign final (x, y) coordinates ─────────────────────────────
  // X is determined by layer index: layer 0 → x=0, layer 1 → x=(NODE_W + GAP_X), etc.
  // Y is determined by position within the layer, centered vertically around y=0.
  const positions: Record<string, Position> = {};

  sortedLayerIndices.forEach((layerIndex) => {
    const nodesInLayer = layerGroups[layerIndex];
    const totalGroupHeight = nodesInLayer.length * (NODE_H + GAP_Y) - GAP_Y;
    // Center the group vertically around y=0 so the graph is centered on the canvas
    const startY = -totalGroupHeight / 2;

    nodesInLayer.forEach((nodeId, indexWithinLayer) => {
      positions[nodeId] = {
        x: layerIndex * (NODE_W + GAP_X),
        y: startY + indexWithinLayer * (NODE_H + GAP_Y),
      };
    });
  });

  return positions;
}

/**
 * computeBarycenter — calculates a sort key for one node based on its neighbors' positions.
 *
 * The barycenter of a node is the average index of its neighbors in the adjacent layer.
 * Sorting nodes by their barycenter score minimizes the number of edge crossings between layers.
 *
 * Example: if node A's neighbors in the previous layer are at positions 1 and 3,
 * A's barycenter is (1+3)/2 = 2. A will be sorted to appear near position 2 in its layer.
 *
 * @param nodeId              - The node we're computing a sort score for
 * @param adjacencyMap        - In-edges for forward sweep, out-edges for backward sweep
 * @param layerGroups         - All nodes grouped by layer index
 * @param layerMap            - Each node's assigned layer number
 * @param sortedLayerIndices  - Layer indices in sorted order
 * @param currentPosition     - This layer's position in the sorted layer list
 * @param isBackwardSweep     - True when sweeping right→left (uses next layer instead of previous)
 * @returns                   - A float sort key; lower values → placed earlier (higher on canvas)
 */
function computeBarycenter(
  nodeId: string,
  adjacencyMap: AdjacencyMap,
  layerGroups: LayerGroups,
  layerMap: LayerMap,
  sortedLayerIndices: number[],
  currentPosition: number,
  isBackwardSweep = false
): number {
  const neighbors = adjacencyMap[nodeId] ?? [];

  // Reference layer: the adjacent layer whose positions we use as the sort reference
  const referenceLayerIndex = isBackwardSweep
    ? sortedLayerIndices[currentPosition + 1]
    : sortedLayerIndices[currentPosition - 1];

  if (referenceLayerIndex === undefined) return 0;

  const referenceLayerNodes = layerGroups[referenceLayerIndex] ?? [];

  // Find which of this node's neighbors are actually in the reference layer
  const relevantNeighbors = neighbors.filter(
    (neighborId) => layerMap[neighborId] === referenceLayerIndex
  );

  // If no neighbors in the reference layer, place this node in the middle
  if (relevantNeighbors.length === 0) return referenceLayerNodes.length / 2;

  // Average index of the relevant neighbors in their layer
  const totalIndex = relevantNeighbors.reduce(
    (sum, neighborId) => sum + referenceLayerNodes.indexOf(neighborId),
    0
  );
  return totalIndex / relevantNeighbors.length;
}

// ─── SWIM LANE LAYOUT ────────────────────────────────────────────────────────

/**
 * computeLaneLayout — Swim lane layout that groups nodes by owner into horizontal bands.
 *
 * How it works:
 *   1. Uses the DAG layout to determine each node's "depth" (which column it belongs to)
 *   2. Groups nodes by owner, then within each owner group, positions them by depth
 *   3. Stacks the owner groups (lanes) vertically with padding and gaps between them
 *
 * The X position comes from the DAG depth (same column system as DAG layout).
 * The Y position is determined by which lane the node belongs to.
 *
 * @param nodes        - Nodes to lay out
 * @param edges        - Edges connecting those nodes
 * @param activeOwners - Set of owner names that are currently visible
 * @param allNodes     - The full node list (needed to preserve owner ordering)
 * @returns            - Object containing positions for each node AND lane metrics for rendering
 */
export function computeLaneLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  activeOwners: Set<string>,
  allNodes: GraphNode[]
): { positions: Record<string, Position>; laneMetrics: Record<string, LaneMetrics> } {
  if (nodes.length === 0) return { positions: {}, laneMetrics: {} };

  // Get the DAG depth for each node (we reuse DAG X positions as the column index)
  const dagPositions = computeLayout(nodes, edges);

  // Build the ordered list of active owners, preserving the order they first appear in allNodes.
  // We use allNodes (not just the current visible nodes) so the order stays stable
  // even when some owners are filtered out.
  const presentOwnerSet = new Set(
    nodes.map((node) => node.owner).filter((owner) => activeOwners.has(owner))
  );
  const ownerOrder: string[] = [];
  allNodes.forEach((node) => {
    if (presentOwnerSet.has(node.owner) && !ownerOrder.includes(node.owner)) {
      ownerOrder.push(node.owner);
    }
  });

  // Group each owner's nodes by their DAG depth column
  // Structure: ownerDepthGroups[owner][depthIndex] = [nodeId, nodeId, ...]
  const ownerDepthGroups: Record<string, Record<number, string[]>> = {};
  nodes.forEach((node) => {
    const dagPos = dagPositions[node.id];
    // Convert the DAG x coordinate back to a column index (integer depth)
    const depthIndex = dagPos ? Math.round(dagPos.x / (NODE_W + GAP_X)) : 0;
    if (!ownerDepthGroups[node.owner]) ownerDepthGroups[node.owner] = {};
    if (!ownerDepthGroups[node.owner][depthIndex]) ownerDepthGroups[node.owner][depthIndex] = [];
    ownerDepthGroups[node.owner][depthIndex].push(node.id);
  });

  // Compute each lane's vertical metrics (y position and height)
  const laneMetrics: Record<string, LaneMetrics> = {};
  let currentY = 0;

  ownerOrder.forEach((owner) => {
    const depthGroups = ownerDepthGroups[owner] ?? {};
    // Lane height is determined by the tallest column within this lane
    const maxNodesInOneColumn = Object.values(depthGroups).reduce(
      (maximum, groupArray) => Math.max(maximum, groupArray.length),
      1 // Minimum of 1 to avoid zero-height lanes
    );
    const laneHeight = maxNodesInOneColumn * (NODE_H + GAP_Y) - GAP_Y + LANE_PAD_Y * 2;
    laneMetrics[owner] = { y: currentY, height: laneHeight };
    currentY += laneHeight + LANE_GAP;
  });

  // Assign final (x, y) positions for each node
  const positions: Record<string, Position> = {};
  nodes.forEach((node) => {
    const dagPos = dagPositions[node.id];
    const depthIndex = dagPos ? Math.round(dagPos.x / (NODE_W + GAP_X)) : 0;
    const nodesAtThisDepth = ownerDepthGroups[node.owner]?.[depthIndex] ?? [];
    const indexWithinDepth = nodesAtThisDepth.indexOf(node.id);
    const laneMeta = laneMetrics[node.owner];

    if (!laneMeta) return; // Should never happen, but guard anyway

    // Center the group of nodes at this depth vertically within the lane
    const groupHeight = nodesAtThisDepth.length * (NODE_H + GAP_Y) - GAP_Y;
    const groupStartY = laneMeta.y + LANE_PAD_Y + (laneMeta.height - LANE_PAD_Y * 2 - groupHeight) / 2;

    positions[node.id] = {
      x: LANE_LABEL_W + depthIndex * (NODE_W + GAP_X),
      y: groupStartY + indexWithinDepth * (NODE_H + GAP_Y),
    };
  });

  return { positions, laneMetrics };
}

// ─── EDGE PATH ───────────────────────────────────────────────────────────────

/**
 * computeEdgePath — calculates the SVG path string for a curved edge between two nodes.
 *
 * Uses a cubic bezier curve (SVG 'C' command) for smooth, aesthetically pleasing edges.
 *
 * The curve starts at the right-center of the 'from' node and ends at the left-center
 * of the 'to' node. The control points are placed at 45% and 55% of the horizontal distance,
 * keeping the same Y as start and end respectively. This creates a smooth S-curve for
 * long edges and a gentle curve for short edges.
 *
 * @param from - Position of the source node (top-left corner)
 * @param to   - Position of the target node (top-left corner)
 * @returns    - An SVG path data string, e.g. "M 180 36 C 243 36, 257 36, 320 36"
 */
export function computeEdgePath(from: Position, to: Position): string {
  // Start point: right-center of the source node
  const startX = from.x + NODE_W;
  const startY = from.y + NODE_H / 2;

  // End point: slightly before the left-center of the target node.
  // Stopping 10px before the node edge ensures the arrowhead sits in the gap
  // and isn't covered by the node rectangle (which renders above the edge layer).
  const endX = to.x - 10;
  const endY = to.y + NODE_H / 2;

  // Control points: slightly past each endpoint in the horizontal direction.
  // The 0.45/0.55 split (rather than 0.5/0.5) gives a slight asymmetry that
  // makes the curve look more natural when nodes are at different Y positions.
  const controlX1 = startX + (endX - startX) * 0.45;
  const controlY1 = startY;
  const controlX2 = startX + (endX - startX) * 0.55;
  const controlY2 = endY;

  return `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`;
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

/**
 * truncateText — truncates a string to a maximum length, appending '…' if truncated.
 * Used to keep node labels within the fixed node width.
 *
 * @param text      - The string to potentially truncate
 * @param maxLength - Maximum number of characters before truncation
 * @returns         - The original string if short enough, or a truncated version with '…'
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}

// ─── PHASE-AWARE LAYOUT UTILITIES ───────────────────────────────────────────

/**
 * enforcePhaseZones — post-processes DAG positions to push unphased nodes out of phase bands.
 *
 * After computeLayout() assigns positions, any node not assigned to a phase may end up
 * visually inside a phase band. This function detects those violations and relocates
 * the offending nodes to a "free zone" to the right of all phase bands, preserving
 * their relative x-ordering.
 *
 * Only runs in DAG view (caller responsibility). Phase-owned nodes are never moved.
 *
 * @param rawPositions - Output from computeLayout()
 * @param phases       - All phases (any order)
 * @param nodeW        - NODE_W constant (passed to avoid circular deps)
 */
export function enforcePhaseZones(
  rawPositions: Record<string, Position>,
  phases: GraphPhase[],
  nodeW: number
): Record<string, Position> {
  if (phases.length === 0) return rawPositions;

  // Build nodeId → phaseId lookup
  const nodeToPhaseId = new Map<string, string>();
  phases.forEach((ph) => ph.nodeIds.forEach((nid) => nodeToPhaseId.set(nid, ph.id)));

  // Compute each phase's x-range from its own assigned nodes' raw positions
  const sorted = [...phases].sort((a, b) => a.sequence - b.sequence);
  const phaseRanges: { id: string; minX: number; maxX: number }[] = [];
  sorted.forEach((ph) => {
    const pts = ph.nodeIds.map((nid) => rawPositions[nid]).filter((p): p is Position => !!p);
    if (pts.length === 0) return;
    const minX = Math.min(...pts.map((p) => p.x)) - PHASE_PAD_X;
    const maxX = Math.max(...pts.map((p) => p.x + nodeW)) + PHASE_PAD_X;
    phaseRanges.push({ id: ph.id, minX, maxX });
  });

  if (phaseRanges.length === 0) return rawPositions;

  const rightEdge = Math.max(...phaseRanges.map((r) => r.maxX));

  // Find unphased nodes whose x overlaps any phase band
  const violators: { nodeId: string; origX: number }[] = [];
  Object.entries(rawPositions).forEach(([nodeId, pos]) => {
    if (nodeToPhaseId.has(nodeId)) return; // phased node — never moved
    const inside = phaseRanges.some((r) => pos.x + nodeW > r.minX && pos.x < r.maxX);
    if (inside) violators.push({ nodeId, origX: pos.x });
  });

  if (violators.length === 0) return rawPositions;

  // Sort violators by original x and assign new x values starting after all phases.
  // Nodes that shared the same original x column keep the same new x (column preserved).
  violators.sort((a, b) => a.origX - b.origX);
  const oldXToNewX = new Map<number, number>();
  let nextX = rightEdge + GAP_X;
  violators.forEach(({ origX }) => {
    if (!oldXToNewX.has(origX)) {
      oldXToNewX.set(origX, nextX);
      nextX += nodeW + GAP_X;
    }
  });

  const adjusted = { ...rawPositions };
  violators.forEach(({ nodeId, origX }) => {
    adjusted[nodeId] = { ...adjusted[nodeId], x: oldXToNewX.get(origX)! };
  });
  return adjusted;
}

/**
 * pushNodesOutOfPhaseBand — displaces unphased nodes that overlap a newly created phase band.
 *
 * Called immediately after createPhase() so that nodes already on the canvas
 * don't visually sit inside the new phase band. Each violating node is pushed
 * toward its nearest exit: nodes whose center is left of the band center go left,
 * others go right. Both directions skip over any other existing phase bands.
 *
 * @param positions          - Current stored positions (not mutated)
 * @param allPhasesAfterCreate - Full phase list including the new phase
 * @param newPhaseId         - ID of the phase just created
 * @param nodeW              - NODE_W constant
 */
export function pushNodesOutOfPhaseBand(
  positions: Record<string, Position>,
  allPhasesAfterCreate: GraphPhase[],
  newPhaseId: string,
  nodeW: number
): Record<string, Position> {
  const newPhase = allPhasesAfterCreate.find((p) => p.id === newPhaseId);
  if (!newPhase) return positions;

  // Compute the new phase band boundaries from its assigned nodes
  const assignedPts = newPhase.nodeIds.map((nid) => positions[nid]).filter((p): p is Position => !!p);
  if (assignedPts.length === 0) return positions;

  const bandMinX = Math.min(...assignedPts.map((p) => p.x)) - PHASE_PAD_X;
  const bandMaxX = Math.max(...assignedPts.map((p) => p.x + nodeW)) + PHASE_PAD_X;
  const bandCenterX = (bandMinX + bandMaxX) / 2;

  // Build set of ALL phased node IDs
  const phasedNodeIds = new Set<string>();
  allPhasesAfterCreate.forEach((ph) => ph.nodeIds.forEach((nid) => phasedNodeIds.add(nid)));

  // Compute all other phase bands (for collision avoidance when placing displaced nodes)
  const otherPhaseRanges: { minX: number; maxX: number }[] = [];
  allPhasesAfterCreate.forEach((ph) => {
    if (ph.id === newPhaseId) return;
    const pts = ph.nodeIds.map((nid) => positions[nid]).filter((p): p is Position => !!p);
    if (pts.length === 0) return;
    const minX = Math.min(...pts.map((p) => p.x)) - PHASE_PAD_X;
    const maxX = Math.max(...pts.map((p) => p.x + nodeW)) + PHASE_PAD_X;
    otherPhaseRanges.push({ minX, maxX });
  });

  // Find violators: unphased nodes overlapping the new band
  const rightGroup: { nodeId: string; origX: number }[] = [];
  const leftGroup: { nodeId: string; origX: number }[] = [];

  Object.entries(positions).forEach(([nodeId, pos]) => {
    if (phasedNodeIds.has(nodeId)) return;
    const overlaps = pos.x < bandMaxX && pos.x + nodeW > bandMinX;
    if (!overlaps) return;
    const nodeCenterX = pos.x + nodeW / 2;
    if (nodeCenterX < bandCenterX) {
      leftGroup.push({ nodeId, origX: pos.x });
    } else {
      rightGroup.push({ nodeId, origX: pos.x });
    }
  });

  if (rightGroup.length === 0 && leftGroup.length === 0) return positions;

  const adjusted = { ...positions };

  // Helper: check if a candidate x-range overlaps any other phase band
  function overlapsOtherPhase(candidateX: number): boolean {
    return otherPhaseRanges.some(
      (r) => candidateX < r.maxX && candidateX + nodeW > r.minX
    );
  }

  // Push-right: sort by x ascending, place after bandMaxX, skip other phase bands
  if (rightGroup.length > 0) {
    rightGroup.sort((a, b) => a.origX - b.origX);
    const oldXToNewX = new Map<number, number>();
    let nextX = bandMaxX + GAP_X;
    rightGroup.forEach(({ origX }) => {
      if (!oldXToNewX.has(origX)) {
        while (overlapsOtherPhase(nextX)) {
          const blocking = otherPhaseRanges.find(
            (r) => nextX < r.maxX && nextX + nodeW > r.minX
          )!;
          nextX = blocking.maxX + GAP_X;
        }
        oldXToNewX.set(origX, nextX);
        nextX += nodeW + GAP_X;
      }
    });
    rightGroup.forEach(({ nodeId, origX }) => {
      adjusted[nodeId] = { ...adjusted[nodeId], x: oldXToNewX.get(origX)! };
    });
  }

  // Push-left: sort by x descending, place before bandMinX, skip other phase bands
  if (leftGroup.length > 0) {
    leftGroup.sort((a, b) => b.origX - a.origX);
    const oldXToNewX = new Map<number, number>();
    let nextX = bandMinX - GAP_X - nodeW;
    leftGroup.forEach(({ origX }) => {
      if (!oldXToNewX.has(origX)) {
        while (overlapsOtherPhase(nextX)) {
          const blocking = otherPhaseRanges.find(
            (r) => nextX < r.maxX && nextX + nodeW > r.minX
          )!;
          nextX = blocking.minX - GAP_X - nodeW;
        }
        oldXToNewX.set(origX, nextX);
        nextX -= nodeW + GAP_X;
      }
    });
    leftGroup.forEach(({ nodeId, origX }) => {
      adjusted[nodeId] = { ...adjusted[nodeId], x: oldXToNewX.get(origX)! };
    });
  }

  return adjusted;
}

/**
 * computePhaseAdjustedPositions — computes virtual x-offsets for phase collapse/expand.
 *
 * When one or more phases are collapsed, their bands shrink to COLLAPSED_W pixels wide.
 * All nodes (and groups) to the RIGHT of a collapsed band shift left to fill the freed space.
 * Nodes INSIDE a collapsed band are added to hiddenNodeIds (rendered invisible).
 *
 * This is a pure render-time transform — stored positions are never mutated.
 *
 * @param phases            - All phases
 * @param rawPositions      - Stored positions (not mutated)
 * @param collapsedPhaseIds - IDs of currently collapsed phases
 * @param nodeW             - NODE_W constant
 */
export function computePhaseAdjustedPositions(
  phases: GraphPhase[],
  rawPositions: Record<string, Position>,
  collapsedPhaseIds: string[],
  nodeW: number
): {
  adjustedPositions: Record<string, Position>;
  hiddenNodeIds: Set<string>;
} {
  if (collapsedPhaseIds.length === 0) {
    return { adjustedPositions: rawPositions, hiddenNodeIds: new Set() };
  }

  const collapsedSet = new Set(collapsedPhaseIds);

  // Compute each phase's x-range
  const phaseInfos: { id: string; minX: number; maxX: number; collapsed: boolean }[] = [];
  phases.forEach((ph) => {
    const pts = ph.nodeIds.map((nid) => rawPositions[nid]).filter((p): p is Position => !!p);
    if (pts.length === 0) return;
    const minX = Math.min(...pts.map((p) => p.x)) - PHASE_PAD_X;
    const maxX = Math.max(...pts.map((p) => p.x + nodeW)) + PHASE_PAD_X;
    phaseInfos.push({ id: ph.id, minX, maxX, collapsed: collapsedSet.has(ph.id) });
  });

  // Nodes inside collapsed phases are hidden
  const hiddenNodeIds = new Set<string>();
  phases.forEach((ph) => {
    if (collapsedSet.has(ph.id)) ph.nodeIds.forEach((nid) => hiddenNodeIds.add(nid));
  });

  const collapsedInfos = phaseInfos.filter((pi) => pi.collapsed);
  if (collapsedInfos.length === 0) return { adjustedPositions: rawPositions, hiddenNodeIds };

  // For each position entry (node or group), compute the x shift:
  // shift = sum of savings from every collapsed phase whose maxX <= this entry's x.
  // Condition "pos.x >= pi.maxX" ensures only nodes strictly to the right of a collapsed
  // band are shifted — nodes inside the band itself (hidden) are not shifted.
  const adjustedPositions: Record<string, Position> = {};
  Object.entries(rawPositions).forEach(([id, pos]) => {
    let shift = 0;
    collapsedInfos.forEach((pi) => {
      if (pos.x >= pi.maxX) {
        shift += (pi.maxX - pi.minX) - COLLAPSED_W;
      }
    });
    adjustedPositions[id] = shift === 0 ? pos : { ...pos, x: pos.x - shift };
  });

  return { adjustedPositions, hiddenNodeIds };
}

/**
 * rebuildEdgesFromNodes — derives the full edge list from node dependency arrays.
 *
 * Edges are always secondary to node data — the source of truth is each node's
 * `dependencies` array. This function converts that into a flat list of {from, to} pairs.
 *
 * Only creates edges where BOTH the source and target node exist in the provided array.
 * This prevents dangling edges if a dependency references a non-existent node.
 *
 * @param nodes - The complete list of nodes to derive edges from
 * @returns     - Array of directed edges
 */
export function rebuildEdgesFromNodes(nodes: GraphNode[]): GraphEdge[] {
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = [];

  nodes.forEach((node) => {
    node.dependencies.forEach((dependencyId) => {
      // Only create an edge if the referenced dependency node actually exists
      if (nodeIdSet.has(dependencyId)) {
        edges.push({ from: dependencyId, to: node.id });
      }
    });
  });

  return edges;
}
