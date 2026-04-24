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

import type { GraphNode, GraphEdge, GraphPhase, GraphGroup, Position, LaneMetrics } from '../types/graph';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

/** Width of each node rectangle in SVG user-space units */
export const NODE_W = 200;
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
/** Minimum horizontal gap enforced between node/group edges for legibility */
export const LEGIBILITY_PAD_X = 24;
/** Minimum vertical gap enforced between node/group edges for legibility */
export const LEGIBILITY_PAD_Y = 16;
/** Extra horizontal spacing injected at each phase boundary for clear visual column separation */
export const PHASE_INTER_GAP = 80;
/** Vertical gap between independently laid-out connected components when stacking them */
export const COMPONENT_GAP = 120;

// ─── INTERNAL TYPES (not exported — only used within this file) ──────────────

/** Maps node id → its layer index (0 = leftmost column, increases rightward) */
type LayerMap = Record<string, number>;

/** Maps layer index → list of node ids in that layer */
type LayerGroups = Record<number, string[]>;

/** Maps node id → list of adjacent node ids (either in-edges or out-edges) */
type AdjacencyMap = Record<string, string[]>;

// ─── DAG LAYOUT ─────────────────────────────────────────────────────────────

/**
 * computeLayout — Phase-stratified Sugiyama-style layered DAG layout.
 *
 * Produces an x/y position for every node such that:
 *   - Nodes are arranged left-to-right by dependency depth (layer 0 = no dependencies)
 *   - Disconnected sub-graphs are laid out independently and stacked vertically
 *     (largest first) — they no longer pile on top of each other at y=0
 *   - When phases are provided, phase sequence order is enforced in layer space so each
 *     phase appears as a clear left-to-right column — no post-hoc zone enforcement needed
 *   - Group members are kept vertically adjacent within each layer via cohesion sorting
 *   - Edge crossings are minimized using the barycenter heuristic (3 passes)
 *   - Y positions use gravity-pull centering: each layer anchors around the mean Y of
 *     its predecessors' centers so connected nodes align naturally rather than all
 *     snapping to y=0, eliminating wild long-diagonal edges in unbalanced graphs
 *   - A PHASE_INTER_GAP offset is added at each phase boundary for visual breathing room
 *
 * Algorithm steps:
 *   1. Build adjacency structures
 *   1.5. Detect connected components; recursively lay out each, then stack vertically
 *   2. Assign layers via longest-path BFS (Kahn's algorithm)
 *   2.5. Phase-stratified floor pass: lift phase nodes to enforce sequence order,
 *        propagating forward through topology to preserve all dependency constraints
 *   3. Group nodes by layer
 *   4. Minimize edge crossings (barycenter, 3 passes) with group-cohesion secondary sort
 *   5. Assign (x, y) — x includes phase-boundary gap offsets; y uses gravity-pull centering
 *
 * @param nodes  - The nodes to lay out (only nodes in this list are positioned)
 * @param edges  - The edges connecting those nodes
 * @param phases - Optional phases; when provided, phase sequence drives layer ordering
 * @param groups - Optional groups; when provided, group members cluster within each layer
 * @returns      - A map of node id → {x, y}. Nodes not in the input return no entry.
 */
export function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  phases?: GraphPhase[],
  groups?: GraphGroup[]
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

  // ── Step 1.5: Detect and separate disconnected components ───────────────
  // Without this, nodes from separate sub-graphs (no edges between them) all receive
  // layers starting from 0 and stack at y≈0, causing them to pile up and overlap.
  // Each component is laid out independently then stacked vertically, largest first
  // so the primary flow appears at the top of the canvas.
  const components = detectComponents(nodeIds, outAdjacency, inAdjacency);
  if (components.length > 1) {
    components.sort((a, b) => b.length - a.length); // largest component first
    const compPositions = components.map((compIds) => {
      const compSet = new Set(compIds);
      const compNodes = nodes.filter((n) => compSet.has(n.id));
      const compEdges = edges.filter((e) => compSet.has(e.from) && compSet.has(e.to));
      return computeLayout(compNodes, compEdges, phases, groups);
    });
    return stackComponentsVertically(compPositions, COMPONENT_GAP);
  }

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

  // ── Step 2.5: Phase-stratified layer floors ──────────────────────────────
  // Enforce phase sequence order in layer space: each phase's nodes must occupy
  // layers strictly greater than all nodes in earlier phases. This makes phase columns
  // appear naturally left-to-right without any post-hoc zone pushing.
  //
  // Algorithm: single forward pass over sorted phases. For each phase, lift member nodes
  // to at least `layerFloor`, then propagate the lift forward via BFS so all downstream
  // nodes maintain the topological invariant (child layer > parent layer). Only increases
  // layers — never decreases — so no existing dependency constraint is ever broken.
  if (phases && phases.length > 0) {
    const sortedPhases = [...phases].sort((a, b) => a.sequence - b.sequence);
    let layerFloor = 0;

    sortedPhases.forEach((phase) => {
      const phaseNodeIds = phase.nodeIds.filter((id) => nodeIdSet.has(id));
      if (phaseNodeIds.length === 0) return;

      phaseNodeIds.forEach((id) => {
        if ((layer[id] ?? 0) < layerFloor) {
          layer[id] = layerFloor;
          // BFS: push all downstream nodes forward to preserve topological order
          const propagateQueue = [id];
          while (propagateQueue.length > 0) {
            const curr = propagateQueue.shift()!;
            (outAdjacency[curr] ?? []).forEach((child) => {
              const required = (layer[curr] ?? 0) + 1;
              if ((layer[child] ?? 0) < required) {
                layer[child] = required;
                propagateQueue.push(child);
              }
            });
          }
        }
      });

      // Next phase must start strictly after this phase's highest layer
      const phaseMaxLayer = Math.max(...phaseNodeIds.map((id) => layer[id] ?? 0));
      layerFloor = phaseMaxLayer + 1;
    });
  }

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
  // Group cohesion: nodes in the same group are sorted as a contiguous block using the
  // group's average barycenter as the block's sort key. This keeps group members adjacent
  // vertically within each column without any rendering changes.
  const sortedLayerIndices = Object.keys(layerGroups).map(Number).sort((a, b) => a - b);

  // Build node → direct parent group ID map (secondary sort key for cohesion)
  const nodeToGroupId = new Map<string, string>();
  if (groups) {
    groups.forEach((g) => {
      g.childNodeIds.forEach((nid) => {
        if (nodeIdSet.has(nid) && !nodeToGroupId.has(nid)) nodeToGroupId.set(nid, g.id);
      });
    });
  }

  for (let pass = 0; pass < 3; pass++) {
    // Forward sweep: sort each layer based on positions of nodes in the PREVIOUS layer
    sortedLayerIndices.forEach((layerIndex, positionInSortedList) => {
      if (positionInSortedList === 0) return; // No previous layer to reference
      const barycenters = new Map<string, number>();
      layerGroups[layerIndex].forEach((nodeId) => {
        barycenters.set(nodeId, computeBarycenter(nodeId, inAdjacency, layerGroups, layer, sortedLayerIndices, positionInSortedList));
      });
      layerGroups[layerIndex] = sortWithGroupCohesion(layerGroups[layerIndex], barycenters, nodeToGroupId);
    });

    // Backward sweep: sort each layer based on positions of nodes in the NEXT layer
    for (let positionInSortedList = sortedLayerIndices.length - 2; positionInSortedList >= 0; positionInSortedList--) {
      const layerIndex = sortedLayerIndices[positionInSortedList];
      const barycenters = new Map<string, number>();
      layerGroups[layerIndex].forEach((nodeId) => {
        barycenters.set(nodeId, computeBarycenter(nodeId, outAdjacency, layerGroups, layer, sortedLayerIndices, positionInSortedList, true));
      });
      layerGroups[layerIndex] = sortWithGroupCohesion(layerGroups[layerIndex], barycenters, nodeToGroupId);
    }
  }

  // ── Step 5: Assign final (x, y) coordinates ─────────────────────────────
  // X = layer × (NODE_W + GAP_X) + phase-gap offset.
  //     The phase-gap offset adds PHASE_INTER_GAP extra pixels for every phase boundary
  //     crossed before this layer — clear visual column separation between phases.
  //
  // Y = gravity-pull centering.
  //     Instead of centering every layer independently at y=0, each layer anchors around
  //     the mean center-Y of its predecessors' positions (already computed in prior layers).
  //     This naturally aligns connected nodes vertically: a node that feeds one child will
  //     sit at roughly the same Y as that child. Layers with no predecessors default to y=0.
  //     The result is that edges travel mostly horizontally, not diagonally, giving a
  //     much cleaner visual flow.

  // Compute how many phase boundaries precede each layer (for X gap offsets).
  const phaseGapOffsets = new Map<number, number>(); // layerIndex → extra x from phase gaps
  if (phases && phases.length > 0) {
    const sortedPhases = [...phases].sort((a, b) => a.sequence - b.sequence);
    const phaseMaxLayers: number[] = sortedPhases
      .map((ph) => {
        const ids = ph.nodeIds.filter((id) => nodeIdSet.has(id));
        if (ids.length === 0) return -1;
        return Math.max(...ids.map((id) => layer[id] ?? 0));
      })
      .filter((l) => l >= 0);

    sortedLayerIndices.forEach((layerIndex) => {
      const gapsBefore = phaseMaxLayers.filter((maxL) => maxL < layerIndex).length;
      phaseGapOffsets.set(layerIndex, gapsBefore * PHASE_INTER_GAP);
    });
  }

  const positions: Record<string, Position> = {};
  const STEP = NODE_H + GAP_Y;

  sortedLayerIndices.forEach((layerIndex) => {
    const nodesInLayer = layerGroups[layerIndex];
    const xOffset = phaseGapOffsets.get(layerIndex) ?? 0;

    // Gravity center: collect the center-Y of every predecessor that is already placed.
    // We gather from ALL nodes in this layer (not per-node) to get one stable anchor for
    // the whole column — competing per-node pulls would scatter the layer unpredictably.
    const gravitySamples: number[] = [];
    nodesInLayer.forEach((id) => {
      (inAdjacency[id] ?? []).forEach((pid) => {
        if (positions[pid] !== undefined) {
          gravitySamples.push(positions[pid].y + NODE_H / 2);
        }
      });
    });
    const gravityCenterY = gravitySamples.length > 0
      ? gravitySamples.reduce((a, b) => a + b, 0) / gravitySamples.length
      : 0; // no predecessors yet (first layer): center at canvas origin

    // Place nodes evenly spaced, centered around the gravity anchor.
    // Formula: startY positions the midpoint of all node centers at gravityCenterY.
    const startY = gravityCenterY - NODE_H / 2 - (nodesInLayer.length - 1) * STEP / 2;

    nodesInLayer.forEach((nodeId, indexWithinLayer) => {
      positions[nodeId] = {
        x: layerIndex * (NODE_W + GAP_X) + xOffset,
        y: startY + indexWithinLayer * STEP,
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

/**
 * sortWithGroupCohesion — sorts nodes within a layer by barycenter, keeping group members adjacent.
 *
 * Primary sort key: barycenter score (average position of neighbors in the adjacent layer).
 * Secondary key: group membership — nodes in the same group are treated as a single sort
 * block whose key is the average barycenter of all its members in this layer.
 *
 * This ensures group members always cluster together vertically in each column, making groups
 * visually coherent without any rendering changes. Groups with only one member in this layer
 * are treated as ordinary nodes (no block needed).
 *
 * @param nodes        - Node IDs in this layer (returned in new sorted order)
 * @param barycenters  - Pre-computed barycenter score for each node
 * @param nodeToGroupId - Map from nodeId → direct parent group ID (empty if no groups)
 * @returns            - Sorted array of node IDs
 */
function sortWithGroupCohesion(
  nodes: string[],
  barycenters: Map<string, number>,
  nodeToGroupId: Map<string, string>
): string[] {
  // No group context — fall back to simple barycenter sort (identical to old behaviour)
  if (nodeToGroupId.size === 0) {
    return [...nodes].sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
  }

  // Count group members present in THIS layer
  const groupMemberLists = new Map<string, string[]>();
  nodes.forEach((nid) => {
    const gid = nodeToGroupId.get(nid);
    if (gid) {
      if (!groupMemberLists.has(gid)) groupMemberLists.set(gid, []);
      groupMemberLists.get(gid)!.push(nid);
    }
  });

  // Only apply cohesion to groups with ≥2 members here — a lone member sorts normally
  const cohesiveGroups = new Map<string, string[]>();
  groupMemberLists.forEach((members, gid) => {
    if (members.length >= 2) cohesiveGroups.set(gid, members);
  });

  if (cohesiveGroups.size === 0) {
    return [...nodes].sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
  }

  // Build sort items: each is either a single node or a group block.
  // Process nodes in barycenter order so group blocks land in a stable position.
  type SortItem = { sortKey: number; nodes: string[] };
  const items: SortItem[] = [];
  const consumed = new Set<string>();
  const sortedNodes = [...nodes].sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));

  sortedNodes.forEach((nid) => {
    if (consumed.has(nid)) return;
    const gid = nodeToGroupId.get(nid);
    const blockKey = gid ? gid + '_emitted' : null;
    if (gid && cohesiveGroups.has(gid) && blockKey && !consumed.has(blockKey)) {
      // Emit all group members as one contiguous block, sorted internally by barycenter
      const members = [...cohesiveGroups.get(gid)!].sort(
        (a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0)
      );
      const avgKey = members.reduce((sum, m) => sum + (barycenters.get(m) ?? 0), 0) / members.length;
      members.forEach((m) => consumed.add(m));
      consumed.add(blockKey);
      items.push({ sortKey: avgKey, nodes: members });
    } else if (!consumed.has(nid)) {
      consumed.add(nid);
      items.push({ sortKey: barycenters.get(nid) ?? 0, nodes: [nid] });
    }
  });

  items.sort((a, b) => a.sortKey - b.sortKey);
  return items.flatMap((item) => item.nodes);
}

/**
 * detectComponents — finds all connected components via undirected DFS.
 *
 * Treats every directed edge as bidirectional so that clusters of nodes with no
 * edges between them are identified as distinct groups. Returns one array of node
 * IDs per component, in the order they were discovered.
 */
function detectComponents(
  nodeIds: string[],
  outAdjacency: AdjacencyMap,
  inAdjacency: AdjacencyMap
): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  nodeIds.forEach((startId) => {
    if (visited.has(startId)) return;
    const component: string[] = [];
    const stack = [startId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      component.push(id);
      // Undirected traversal: follow edges in both directions
      [...(outAdjacency[id] ?? []), ...(inAdjacency[id] ?? [])].forEach((nb) => {
        if (!visited.has(nb)) stack.push(nb);
      });
    }
    components.push(component);
  });

  return components;
}

/**
 * stackComponentsVertically — merges independently laid-out components into one map.
 *
 * Places each component directly below the previous one with `gap` pixels of clear space
 * between them, then shifts the entire result so it is centered around y=0.
 *
 * @param componentPositions - One position map per connected component (largest first)
 * @param gap                - Clear vertical space between adjacent components
 */
function stackComponentsVertically(
  componentPositions: Record<string, Position>[],
  gap: number
): Record<string, Position> {
  const merged: Record<string, Position> = {};
  let currentTop = 0;

  componentPositions.forEach((compPos) => {
    const ys = Object.values(compPos).map((p) => p.y);
    if (ys.length === 0) return;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + NODE_H;
    const shift = currentTop - minY; // align this component's top to currentTop

    Object.entries(compPos).forEach(([id, pos]) => {
      merged[id] = { ...pos, y: pos.y + shift };
    });

    currentTop += (maxY - minY) + gap;
  });

  // Center the combined layout around y=0 so fitToScreen works correctly
  const allYs = Object.values(merged).map((p) => p.y);
  if (allYs.length === 0) return merged;
  const totalMin = Math.min(...allYs);
  const totalMax = Math.max(...allYs) + NODE_H;
  const centerShift = -(totalMin + (totalMax - totalMin) / 2);
  Object.keys(merged).forEach((id) => {
    merged[id] = { ...merged[id], y: merged[id].y + centerShift };
  });

  return merged;
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
  // Start below y=0 to reserve space for phase header strips (48px = HEADER_H in PhaseLayer).
  const laneMetrics: Record<string, LaneMetrics> = {};
  let currentY = 48;

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
 * Only runs in DAG view (caller responsibility). Phase-owned nodes/groups are never moved.
 *
 * @param rawPositions - Output from computeLayout()
 * @param phases       - All phases (any order)
 * @param nodeW        - NODE_W constant (passed to avoid circular deps)
 * @param groupR       - Optional GROUP_R (radius of collapsed group polygon)
 */
export function enforcePhaseZones(
  rawPositions: Record<string, Position>,
  phases: GraphPhase[],
  nodeW: number,
  groupR: number = 0
): Record<string, Position> {
  if (phases.length === 0) return rawPositions;

  // Build nodeId/groupId → phaseId lookup for all phase members
  const memberToPhaseId = new Map<string, string>();
  phases.forEach((ph) => {
    ph.nodeIds.forEach((nid) => memberToPhaseId.set(nid, ph.id));
    (ph.groupIds ?? []).forEach((gid) => memberToPhaseId.set(gid, ph.id));
  });

  // Compute each phase's x-range from its assigned nodes AND groups
  const sorted = [...phases].sort((a, b) => a.sequence - b.sequence);
  const phaseRanges: { id: string; minX: number; maxX: number }[] = [];
  sorted.forEach((ph) => {
    const nodePts = ph.nodeIds.map((nid) => rawPositions[nid]).filter((p): p is Position => !!p);
    const groupPts = (ph.groupIds ?? []).map((gid) => rawPositions[gid]).filter((p): p is Position => !!p);
    if (nodePts.length === 0 && groupPts.length === 0) return;
    const xs: number[] = [
      ...nodePts.map((p) => p.x),
      ...groupPts.map((p) => p.x - groupR),
    ];
    const xMaxes: number[] = [
      ...nodePts.map((p) => p.x + nodeW),
      ...groupPts.map((p) => p.x + groupR),
    ];
    const minX = Math.min(...xs) - PHASE_PAD_X;
    const maxX = Math.max(...xMaxes) + PHASE_PAD_X;
    phaseRanges.push({ id: ph.id, minX, maxX });
  });

  if (phaseRanges.length === 0) return rawPositions;

  const rightEdge = Math.max(...phaseRanges.map((r) => r.maxX));

  // Find unphased elements whose x overlaps any phase band
  const violators: { nodeId: string; origX: number }[] = [];
  Object.entries(rawPositions).forEach(([nodeId, pos]) => {
    if (memberToPhaseId.has(nodeId)) return; // phase member — never moved
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
 * pushNodesOutOfPhaseBand — displaces unphased nodes (and collapsed groups) that overlap a phase band.
 *
 * Called after createPhase(), assignNodesToPhase(), or a phase-drag completes so that
 * non-member elements don't visually sit inside the band. Each violator is pushed toward
 * its nearest exit (left or right) and both directions skip over any other existing phase
 * bands to prevent cascading collisions.
 *
 * @param positions  - Current stored positions (not mutated)
 * @param allPhases  - Full phase list including the triggering phase
 * @param phaseId    - ID of the phase that triggered the push
 * @param nodeW      - NODE_W constant
 * @param groups     - Optional: all graph groups (enables collapsed-group push)
 * @param groupR     - Optional: GROUP_R constant (radius of a collapsed group polygon)
 */
export function pushNodesOutOfPhaseBand(
  positions: Record<string, Position>,
  allPhases: GraphPhase[],
  phaseId: string,
  nodeW: number,
  groups: GraphGroup[] = [],
  groupR: number = 0,
  minX?: number
): Record<string, Position> {
  const targetPhase = allPhases.find((p) => p.id === phaseId);
  if (!targetPhase) return positions;

  // Compute the phase band boundaries from its assigned nodes AND groups
  const assignedNodePts = targetPhase.nodeIds.map((nid) => positions[nid]).filter((p): p is Position => !!p);
  const assignedGroupPts = (targetPhase.groupIds ?? []).map((gid) => positions[gid]).filter((p): p is Position => !!p);
  if (assignedNodePts.length === 0 && assignedGroupPts.length === 0) return positions;

  const allMemberXMins = [
    ...assignedNodePts.map((p) => p.x),
    ...assignedGroupPts.map((p) => p.x - groupR),
  ];
  const allMemberXMaxes = [
    ...assignedNodePts.map((p) => p.x + nodeW),
    ...assignedGroupPts.map((p) => p.x + groupR),
  ];
  const bandMinX = Math.min(...allMemberXMins) - PHASE_PAD_X;
  const bandMaxX = Math.max(...allMemberXMaxes) + PHASE_PAD_X;
  const bandCenterX = (bandMinX + bandMaxX) / 2;

  // Build sets of ALL phased node IDs and group IDs
  const phasedNodeIds = new Set<string>();
  const phasedGroupIds = new Set<string>();
  allPhases.forEach((ph) => {
    ph.nodeIds.forEach((nid) => phasedNodeIds.add(nid));
    (ph.groupIds ?? []).forEach((gid) => phasedGroupIds.add(gid));
  });

  // Compute all other phase bands (for collision avoidance when placing displaced elements)
  const otherPhaseRanges: { minX: number; maxX: number }[] = [];
  allPhases.forEach((ph) => {
    if (ph.id === phaseId) return;
    const nodePts = ph.nodeIds.map((nid) => positions[nid]).filter((p): p is Position => !!p);
    const grpPts = (ph.groupIds ?? []).map((gid) => positions[gid]).filter((p): p is Position => !!p);
    if (nodePts.length === 0 && grpPts.length === 0) return;
    const xs = [...nodePts.map((p) => p.x), ...grpPts.map((p) => p.x - groupR)];
    const xMaxes = [...nodePts.map((p) => p.x + nodeW), ...grpPts.map((p) => p.x + groupR)];
    const minX = Math.min(...xs) - PHASE_PAD_X;
    const maxX = Math.max(...xMaxes) + PHASE_PAD_X;
    otherPhaseRanges.push({ minX, maxX });
  });

  // Helper: check if a candidate x-range (width = nodeW) overlaps any other phase band.
  // Declared as let so it can be redefined after allFinalBands is built (post-cascade),
  // ensuring non-member placement uses accurate band positions rather than stale otherPhaseRanges.
  let overlapsOtherPhase = (candidateX: number, width: number = nodeW): boolean => {
    return otherPhaseRanges.some(
      (r) => candidateX < r.maxX && candidateX + width > r.minX
    );
  };

  const adjusted = { ...positions };

  // ── Phase-on-phase: cascade push via worklist ────────────────────────────
  // Each worklist entry is the band of the "pusher" phase and which phase it belongs to.
  // Seeded with the dragged band; any phase that gets displaced is enqueued as the next pusher.
  const resolved = new Set<string>(); // "pusherPhaseId|victimPhaseId" pairs already handled
  const worklist: { pusherPhaseId: string; pusherMinX: number; pusherMaxX: number }[] = [
    { pusherPhaseId: phaseId, pusherMinX: bandMinX, pusherMaxX: bandMaxX },
  ];
  const maxIter = allPhases.length * allPhases.length + 1;
  let iter = 0;

  while (worklist.length > 0 && iter++ < maxIter) {
    const { pusherPhaseId, pusherMinX, pusherMaxX } = worklist.shift()!;
    const pusherCenterX = (pusherMinX + pusherMaxX) / 2;

    allPhases.forEach((victim) => {
      if (victim.id === pusherPhaseId) return;
      const key = `${pusherPhaseId}|${victim.id}`;
      if (resolved.has(key)) return;

      const pts = victim.nodeIds.map((nid) => adjusted[nid]).filter((p): p is Position => !!p);
      const grpPts = (victim.groupIds ?? []).map((gid) => adjusted[gid]).filter((p): p is Position => !!p);
      if (pts.length === 0 && grpPts.length === 0) return;
      const victimXMins = [...pts.map((p) => p.x), ...grpPts.map((p) => p.x - groupR)];
      const victimXMaxes = [...pts.map((p) => p.x + nodeW), ...grpPts.map((p) => p.x + groupR)];
      const victimMinX = Math.min(...victimXMins) - PHASE_PAD_X;
      const victimMaxX = Math.max(...victimXMaxes) + PHASE_PAD_X;
      if (victimMinX >= pusherMaxX || victimMaxX <= pusherMinX) return;

      resolved.add(key);

      // Push direction: victim center relative to pusher center
      const victimCenterX = (victimMinX + victimMaxX) / 2;
      let pushRight = victimCenterX >= pusherCenterX;
      const minNodeX = pts.length > 0 ? Math.min(...pts.map((p) => p.x)) : Math.min(...grpPts.map((p) => p.x - groupR));
      const maxNodeRightX = pts.length > 0 ? Math.max(...pts.map((p) => p.x + nodeW)) : Math.max(...grpPts.map((p) => p.x + groupR));

      // In lanes view, check if pushing left would place the leftmost victim node past the
      // boundary. Left-push lands the leftmost node at: pusherMinX - GAP_X - maxNodeRightX + minNodeX.
      if (!pushRight && minX !== undefined &&
          pusherMinX - GAP_X - maxNodeRightX + minNodeX < minX) {
        pushRight = true;
      }

      victim.nodeIds.forEach((nid) => {
        const pos = adjusted[nid];
        if (!pos) return;
        if (pushRight) {
          adjusted[nid] = { ...pos, x: pusherMaxX + GAP_X + (pos.x - minNodeX) };
        } else {
          adjusted[nid] = { ...pos, x: pusherMinX - GAP_X - nodeW - (maxNodeRightX - nodeW - pos.x) };
        }
      });
      // Also move grouped members of the victim phase
      (victim.groupIds ?? []).forEach((gid) => {
        const pos = adjusted[gid];
        if (!pos) return;
        if (pushRight) {
          adjusted[gid] = { ...pos, x: pusherMaxX + GAP_X + groupR + (pos.x - groupR - minNodeX) };
        } else {
          adjusted[gid] = { ...pos, x: pusherMinX - GAP_X - groupR - (maxNodeRightX - groupR - pos.x) };
        }
      });

      // Compute new band after displacement and enqueue as next pusher
      const newNodePts = victim.nodeIds.map((nid) => adjusted[nid]).filter((p): p is Position => !!p);
      const newGrpPts = (victim.groupIds ?? []).map((gid) => adjusted[gid]).filter((p): p is Position => !!p);
      if (newNodePts.length === 0 && newGrpPts.length === 0) return;
      const newMinXCalc = Math.min(...newNodePts.map((p) => p.x), ...newGrpPts.map((p) => p.x - groupR));
      const newMaxXCalc = Math.max(...newNodePts.map((p) => p.x + nodeW), ...newGrpPts.map((p) => p.x + groupR));
      const newMinX = newMinXCalc - PHASE_PAD_X;
      const newMaxX = newMaxXCalc + PHASE_PAD_X;
      worklist.push({ pusherPhaseId: victim.id, pusherMinX: newMinX, pusherMaxX: newMaxX });

      // Keep otherPhaseRanges in sync for non-member push below
      const rangeIdx = otherPhaseRanges.findIndex((r) => r.minX === victimMinX && r.maxX === victimMaxX);
      if (rangeIdx !== -1) {
        otherPhaseRanges[rangeIdx] = { minX: newMinX, maxX: newMaxX };
      }
    });
  }

  // ── Build final band bounds for all phases (dragged + cascaded) ──────────
  const allFinalBands: { minX: number; maxX: number; centerX: number }[] = [];
  allPhases.forEach((ph) => {
    const pts = ph.nodeIds.map((nid) => adjusted[nid]).filter((p): p is Position => !!p);
    const gPts = (ph.groupIds ?? []).map((gid) => adjusted[gid]).filter((p): p is Position => !!p);
    if (pts.length === 0 && gPts.length === 0) return;
    const xs = [...pts.map((p) => p.x), ...gPts.map((p) => p.x - groupR)];
    const xMaxes = [...pts.map((p) => p.x + nodeW), ...gPts.map((p) => p.x + groupR)];
    const minX = Math.min(...xs) - PHASE_PAD_X;
    const maxX = Math.max(...xMaxes) + PHASE_PAD_X;
    allFinalBands.push({ minX, maxX, centerX: (minX + maxX) / 2 });
  });

  // Redefine overlapsOtherPhase to use the authoritative post-cascade band positions.
  // The earlier definition used otherPhaseRanges which can go stale during multi-step
  // cascades, causing displaced non-members to land inside a different phase band.
  overlapsOtherPhase = (candidateX: number, width: number = nodeW): boolean => {
    return allFinalBands.some((b) => candidateX < b.maxX && candidateX + width > b.minX);
  };

  // ── Node violators ────────────────────────────────────────────────────────
  const rightNodes: { nodeId: string; origX: number }[] = [];
  const leftNodes: { nodeId: string; origX: number }[] = [];

  Object.entries(adjusted).forEach(([nodeId, pos]) => {
    if (phasedNodeIds.has(nodeId)) return;
    // Skip collapsed groups entirely — handled in the group-violators section below
    if (groups.length > 0 && groups.some((g) => g.id === nodeId && g.collapsed)) return;
    // Skip groups that are direct phase members
    if (phasedGroupIds.has(nodeId)) return;
    const band = allFinalBands.find((b) => pos.x < b.maxX && pos.x + nodeW > b.minX);
    if (!band) return;
    const nodeCenterX = pos.x + nodeW / 2;
    if (nodeCenterX < band.centerX) {
      leftNodes.push({ nodeId, origX: pos.x });
    } else {
      rightNodes.push({ nodeId, origX: pos.x });
    }
  });

  // Push-left nodes; any that can't fit left of the lane boundary overflow to right-push.
  const leftOverflow: { nodeId: string; origX: number }[] = [];
  if (leftNodes.length > 0) {
    leftNodes.sort((a, b) => b.origX - a.origX);
    const oldXToNewX = new Map<number, number>();
    let nextX = bandMinX - GAP_X - nodeW;
    leftNodes.forEach(({ nodeId, origX }) => {
      if (!oldXToNewX.has(origX)) {
        while (overlapsOtherPhase(nextX)) {
          const blocking = otherPhaseRanges.find((r) => nextX < r.maxX && nextX + nodeW > r.minX)!;
          nextX = blocking.minX - GAP_X - nodeW;
        }
        // No room to the left — send to right-push instead.
        if (minX !== undefined && nextX < minX) {
          leftOverflow.push({ nodeId, origX });
          return;
        }
        oldXToNewX.set(origX, nextX);
        nextX -= nodeW + GAP_X;
      }
    });
    leftNodes.forEach(({ nodeId, origX }) => {
      const newX = oldXToNewX.get(origX);
      if (newX !== undefined) {
        adjusted[nodeId] = { ...adjusted[nodeId], x: newX };
      }
    });
  }

  // Push-right nodes (including any left-push overflow).
  const allRightNodes = [...rightNodes, ...leftOverflow];
  if (allRightNodes.length > 0) {
    allRightNodes.sort((a, b) => a.origX - b.origX);
    const oldXToNewX = new Map<number, number>();
    let nextX = bandMaxX + GAP_X;
    allRightNodes.forEach(({ origX }) => {
      if (!oldXToNewX.has(origX)) {
        while (overlapsOtherPhase(nextX)) {
          const blocking = otherPhaseRanges.find((r) => nextX < r.maxX && nextX + nodeW > r.minX)!;
          nextX = blocking.maxX + GAP_X;
        }
        oldXToNewX.set(origX, nextX);
        nextX += nodeW + GAP_X;
      }
    });
    allRightNodes.forEach(({ nodeId, origX }) => {
      adjusted[nodeId] = { ...adjusted[nodeId], x: oldXToNewX.get(origX)! };
    });
  }

  // ── Collapsed group violators ─────────────────────────────────────────────
  if (groups.length > 0 && groupR > 0) {
    // Helper to get all descendant node IDs of a group (direct children + nested)
    function getDescendantNodeIds(groupId: string): Set<string> {
      const result = new Set<string>();
      const stack = [groupId];
      while (stack.length > 0) {
        const gid = stack.pop()!;
        const g = groups.find((gr) => gr.id === gid);
        if (!g) continue;
        g.childNodeIds.forEach((nid) => result.add(nid));
        g.childGroupIds.forEach((cid) => stack.push(cid));
      }
      return result;
    }

    // A group belongs to a phase if it is directly in phase.groupIds,
    // OR if any of its descendant nodes belong to the phase.
    const phaseNodeSet = new Set(targetPhase.nodeIds);
    const phaseGroupSet = new Set(targetPhase.groupIds ?? []);

    const rightGroups: { groupId: string; origX: number }[] = [];
    const leftGroups: { groupId: string; origX: number }[] = [];

    groups.forEach((g) => {
      if (!g.collapsed) return;
      const pos = adjusted[g.id];
      if (!pos) return;
      // Skip if directly assigned to the target phase
      if (phaseGroupSet.has(g.id)) return;
      // Skip if it's a member of any phase (direct group membership in any phase)
      if (phasedGroupIds.has(g.id)) return;
      // Skip if it contains descendant nodes that belong to any phased node set
      const descendants = getDescendantNodeIds(g.id);
      if ([...descendants].some((nid) => phaseNodeSet.has(nid))) return;
      const gLeft = pos.x - groupR;
      const gRight = pos.x + groupR;
      const band = allFinalBands.find((b) => gRight > b.minX && gLeft < b.maxX);
      if (!band) return;
      if (pos.x < band.centerX) {
        leftGroups.push({ groupId: g.id, origX: pos.x });
      } else {
        rightGroups.push({ groupId: g.id, origX: pos.x });
      }
    });

    // In lanes view, if there's no room to the left for even one group, reclassify all
    // left-groups as right-groups so they don't get pushed behind the lane title.
    if (minX !== undefined && bandMinX - groupR - GAP_X - groupR < minX) {
      rightGroups.push(...leftGroups);
      leftGroups.length = 0;
    }

    // Push-right collapsed groups
    rightGroups.sort((a, b) => a.origX - b.origX);
    rightGroups.forEach(({ groupId, origX: _ }) => {
      let targetX = bandMaxX + groupR + GAP_X;
      while (overlapsOtherPhase(targetX - groupR, groupR * 2)) {
        const blocking = otherPhaseRanges.find(
          (r) => targetX - groupR < r.maxX && targetX + groupR > r.minX
        )!;
        targetX = blocking.maxX + groupR + GAP_X;
      }
      adjusted[groupId] = { ...adjusted[groupId], x: targetX };
    });

    // Push-left collapsed groups
    leftGroups.sort((a, b) => b.origX - a.origX);
    leftGroups.forEach(({ groupId, origX: _ }) => {
      let targetX = bandMinX - groupR - GAP_X;
      while (overlapsOtherPhase(targetX - groupR, groupR * 2)) {
        const blocking = otherPhaseRanges.find(
          (r) => targetX - groupR < r.maxX && targetX + groupR > r.minX
        )!;
        targetX = blocking.minX - groupR - GAP_X;
      }
      adjusted[groupId] = { ...adjusted[groupId], x: targetX };
    });
  }

  return adjusted;
}

/**
 * enforceAllPhaseBoundaries — applies the full lanes phase-enforcement pipeline to a position map.
 *
 * Used when restoring saved or cached positions into lanes view, where positions may have been
 * computed under different rules (or in DAG view) and need to be brought into compliance.
 *
 * Steps (in order):
 *  1. Clamp every position to x >= minX so nothing sits behind the lane label area.
 *  2. Run pushNodesOutOfPhaseBand for each phase in sequence order, feeding the result of
 *     each call into the next. This resolves inter-phase conflicts and non-member violations
 *     using the same algorithm that runs during interactive drag.
 *
 * @param positions - Current stored positions (not mutated)
 * @param phases    - All phases
 * @param groups    - All graph groups (for collapsed-group push)
 * @param groupR    - GROUP_R constant
 * @param minX      - Left boundary (LANE_LABEL_W)
 */
export function enforceAllPhaseBoundaries(
  positions: Record<string, Position>,
  phases: GraphPhase[],
  groups: GraphGroup[],
  groupR: number,
  minX: number
): Record<string, Position> {
  // Step 1: floor every x at the lane label boundary
  let result: Record<string, Position> = {};
  Object.entries(positions).forEach(([id, pos]) => {
    result[id] = pos.x >= minX ? pos : { ...pos, x: minX };
  });

  // Step 2: push non-members out of each phase band in sequence order
  const sorted = [...phases].sort((a, b) => a.sequence - b.sequence);
  sorted.forEach((phase) => {
    const hasMembersWithPositions = phase.nodeIds.some((nid) => result[nid]);
    if (!hasMembersWithPositions) return;
    result = pushNodesOutOfPhaseBand(result, phases, phase.id, NODE_W, groups, groupR, minX);
  });

  return result;
}

/**
 * clampXOutOfPhaseBands — deflects a candidate X position away from all phase
 * bands the node is not a member of.
 *
 * Used during drag in DAG view to give live wall feedback, mirroring the live
 * Y-clamp swim lanes apply in LANE view. Runs multiple passes so adjacent
 * bands are handled without cascades.
 *
 * @param candidateX - Proposed new X for the dragged node (top-left origin)
 * @param nodeId     - ID of the node being dragged
 * @param phases     - All phases
 * @param positions  - Current stored positions (read-only)
 * @param nodeW      - NODE_W constant
 * @param excludeIds - IDs of co-dragged items to exclude from band calculations
 *                     (they move as a unit, so they don't define a "wall")
 */
export function clampXOutOfPhaseBands(
  candidateX: number,
  nodeId: string,
  phases: GraphPhase[],
  positions: Record<string, Position>,
  nodeW: number,
  excludeIds: Set<string> = new Set()
): number {
  const myPhase = phases.find((ph) => ph.nodeIds.includes(nodeId));

  let x = candidateX;

  // Multiple passes resolve cascading adjacent bands (same node can be deflected
  // right into a second band; next pass catches that).
  for (let pass = 0; pass < phases.length; pass++) {
    let moved = false;

    for (const phase of phases) {
      if (myPhase && phase.id === myPhase.id) continue; // own phase — skip

      // Band bounds from members that are not co-dragged (they define the wall)
      const memberPositions = phase.nodeIds
        .filter((nid) => nid !== nodeId && !excludeIds.has(nid))
        .map((nid) => positions[nid])
        .filter((p): p is Position => !!p);

      if (memberPositions.length === 0) continue; // no anchor members → no band

      const bandMinX = Math.min(...memberPositions.map((p) => p.x)) - PHASE_PAD_X;
      const bandMaxX = Math.max(...memberPositions.map((p) => p.x + nodeW)) + PHASE_PAD_X;

      if (x + nodeW > bandMinX && x < bandMaxX) {
        // Overlap — push to whichever edge is closer
        const distToLeft  = x + nodeW - bandMinX; // penetration from left
        const distToRight = bandMaxX - x;          // penetration from right
        x = distToLeft <= distToRight ? bandMinX - nodeW : bandMaxX;
        moved = true;
      }
    }

    if (!moved) break; // stable — no further passes needed
  }

  return x;
}

/**
 * resolveNodeOverlaps — iteratively separates overlapping nodes and collapsed groups.
 *
 * Uses a force-based iterative algorithm: for each overlapping pair, push them apart
 * along the axis with the smaller penetration depth. Runs up to MAX_ITER passes or
 * until no overlaps remain.
 *
 * Nodes are treated as rectangles (NODE_W × NODE_H, top-left origin).
 * Collapsed groups are treated as squares centered on their position (2×groupR × 2×groupR).
 * Expanded groups are not in the positions map directly (their children are), so they
 * are skipped here.
 *
 * @param positions         - Current positions map (nodeId / collapsed groupId → {x, y})
 * @param collapsedGroupIds - Set of group IDs that are currently collapsed
 * @param groupR            - Radius of a collapsed group polygon (GROUP_R constant)
 * @param paddingX          - Minimum horizontal gap enforced between items
 * @param paddingY          - Minimum vertical gap enforced between items
 * @param anchorIds         - IDs that must not move (e.g. the just-dropped node). Others push away from them.
 */
export function resolveNodeOverlaps(
  positions: Record<string, Position>,
  collapsedGroupIds: Set<string>,
  groupR: number = 0,
  paddingX: number = LEGIBILITY_PAD_X,
  paddingY: number = LEGIBILITY_PAD_Y,
  anchorIds: Set<string> = new Set()
): Record<string, Position> {
  const ids = Object.keys(positions);
  if (ids.length < 2) return positions;

  const result: Record<string, Position> = {};
  ids.forEach((id) => { result[id] = { ...positions[id] }; });

  /** Return the bounding box for an element given its current position */
  const getBBox = (id: string) => {
    const pos = result[id];
    if (collapsedGroupIds.has(id) && groupR > 0) {
      return { cx: pos.x, cy: pos.y, x: pos.x - groupR, y: pos.y - groupR, w: groupR * 2, h: groupR * 2 };
    }
    return { cx: pos.x + NODE_W / 2, cy: pos.y + NODE_H / 2, x: pos.x, y: pos.y, w: NODE_W, h: NODE_H };
  };

  const MAX_ITER = 120;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let anyMoved = false;

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const idA = ids[i];
        const idB = ids[j];
        const bA = getBBox(idA);
        const bB = getBBox(idB);

        // Penetration depths on each axis (positive = overlapping)
        const xOverlap = Math.min(bA.x + bA.w, bB.x + bB.w) - Math.max(bA.x, bB.x);
        const yOverlap = Math.min(bA.y + bA.h, bB.y + bB.h) - Math.max(bA.y, bB.y);
        if (xOverlap <= 0 || yOverlap <= 0) continue; // no overlap

        // Amount to push apart (include desired padding gap)
        const sepX = xOverlap + paddingX;
        const sepY = yOverlap + paddingY;

        const posA = result[idA];
        const posB = result[idB];
        const aAnchored = anchorIds.has(idA);
        const bAnchored = anchorIds.has(idB);
        if (aAnchored && bAnchored) continue; // both pinned — skip

        if (sepX <= sepY) {
          // Cheaper to resolve horizontally
          // Anchored item absorbs nothing; free item takes the full separation
          const aShare = aAnchored ? 0 : bAnchored ? sepX : sepX / 2;
          const bShare = bAnchored ? 0 : aAnchored ? sepX : sepX / 2;
          if (bA.cx <= bB.cx) {
            if (!aAnchored) result[idA] = { ...posA, x: posA.x - aShare };
            if (!bAnchored) result[idB] = { ...posB, x: posB.x + bShare };
          } else {
            if (!aAnchored) result[idA] = { ...posA, x: posA.x + aShare };
            if (!bAnchored) result[idB] = { ...posB, x: posB.x - bShare };
          }
        } else {
          // Cheaper to resolve vertically
          const aShare = aAnchored ? 0 : bAnchored ? sepY : sepY / 2;
          const bShare = bAnchored ? 0 : aAnchored ? sepY : sepY / 2;
          if (bA.cy <= bB.cy) {
            if (!aAnchored) result[idA] = { ...posA, y: posA.y - aShare };
            if (!bAnchored) result[idB] = { ...posB, y: posB.y + bShare };
          } else {
            if (!aAnchored) result[idA] = { ...posA, y: posA.y + aShare };
            if (!bAnchored) result[idB] = { ...posB, y: posB.y - bShare };
          }
        }
        anyMoved = true;
      }
    }

    if (!anyMoved) break;
  }

  return result;
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
  nodeW: number,
  clampMinX?: number
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
  // clampMinX (e.g. LANE_LABEL_W in lanes mode) prevents shifting nodes behind the lane label.
  const adjustedPositions: Record<string, Position> = {};
  Object.entries(rawPositions).forEach(([id, pos]) => {
    let shift = 0;
    collapsedInfos.forEach((pi) => {
      if (pos.x >= pi.maxX) {
        shift += (pi.maxX - pi.minX) - COLLAPSED_W;
      }
    });
    const newX = pos.x - shift;
    adjustedPositions[id] = shift === 0 ? pos : { ...pos, x: clampMinX !== undefined ? Math.max(newX, clampMinX) : newX };
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
