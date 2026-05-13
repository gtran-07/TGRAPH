/**
 * utils/grouping.ts — Pure utility functions for the group feature.
 *
 * Responsibilities:
 *   - Connectivity validation (are all selected nodes reachable from each other?)
 *   - Polygon geometry (compute SVG polygon point strings)
 *   - Group hierarchy queries (nest level, membership, owner derivation)
 *   - ID generation for groups
 *
 * Everything here is side-effect-free and React/DOM-free.
 */

import type { GraphEdge, GraphGroup, GraphNode, GraphPhase } from '../types/graph';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/**
 * GROUP_R — the circumscribed radius of the group polygon in SVG user-space units.
 * The polygon fits inside a circle of this radius centered on the group's position.
 */
export const GROUP_R = 80;

/** Approximate bounding box of a group polygon (used for layout spacing). */
export const GROUP_W = GROUP_R * 2;
export const GROUP_H = GROUP_R * 2;

// ─── ID GENERATION ────────────────────────────────────────────────────────────

/** Generate a unique GROUP-XX id that does not conflict with existing groups. */
export function generateGroupId(existingGroups: GraphGroup[]): string {
  const existing = new Set(existingGroups.map((g) => g.id));
  let n = existingGroups.length + 1;
  while (existing.has(`GROUP-${String(n).padStart(2, '0')}`)) n++;
  return `GROUP-${String(n).padStart(2, '0')}`;
}

// ─── CONNECTIVITY ─────────────────────────────────────────────────────────────

/**
 * validateGroupConnectivity — checks that all given node IDs form a connected
 * sub-graph (undirected) using only the edges between them.
 *
 * Returns `valid = true` when all nodes can be reached from any starting node
 * in the selection.  Disconnected node IDs are listed in `disconnectedIds`.
 */
export function validateGroupConnectivity(
  nodeIds: string[],
  edges: GraphEdge[]
): { valid: boolean; disconnectedIds: string[] } {
  if (nodeIds.length <= 1) return { valid: true, disconnectedIds: [] };

  const nodeSet = new Set(nodeIds);

  // Build undirected adjacency restricted to the selected set
  const adj = new Map<string, Set<string>>();
  for (const id of nodeIds) adj.set(id, new Set());

  for (const edge of edges) {
    if (nodeSet.has(edge.from) && nodeSet.has(edge.to)) {
      adj.get(edge.from)!.add(edge.to);
      adj.get(edge.to)!.add(edge.from);
    }
  }

  // BFS from the first node
  const visited = new Set<string>();
  const queue = [nodeIds[0]];
  while (queue.length) {
    const curr = queue.shift()!;
    if (visited.has(curr)) continue;
    visited.add(curr);
    adj.get(curr)!.forEach((nbr) => { if (!visited.has(nbr)) queue.push(nbr); });
  }

  const disconnectedIds = nodeIds.filter((id) => !visited.has(id));
  return { valid: disconnectedIds.length === 0, disconnectedIds };
}

// ─── HIERARCHY QUERIES ────────────────────────────────────────────────────────

/**
 * computeGroupNestLevel — returns how many layers of groups exist beneath groupId.
 *
 *   - A group containing only nodes     → level 1  (pentagon,  5 sides)
 *   - A group containing a level-1 group → level 2  (hexagon,   6 sides)
 *   - …
 *
 * Polygon sides = 4 + nestLevel.
 */
export function computeGroupNestLevel(groupId: string, groups: GraphGroup[]): number {
  const group = groups.find((g) => g.id === groupId);
  if (!group || group.childGroupIds.length === 0) return 1;
  const childLevels = group.childGroupIds.map((id) => computeGroupNestLevel(id, groups));
  return 1 + Math.max(...childLevels);
}

/**
 * isNodeInGroup — returns true when nodeId is a direct or transitive descendant
 * of the group identified by groupId.
 */
export function isNodeInGroup(nodeId: string, groupId: string, groups: GraphGroup[]): boolean {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return false;
  if (group.childNodeIds.includes(nodeId)) return true;
  return group.childGroupIds.some((cgId) => isNodeInGroup(nodeId, cgId, groups));
}

/**
 * getCollapsedGroupForNode — finds the OUTERMOST *collapsed* group that contains
 * the given node, or null when no collapsed ancestor exists.
 *
 * Outermost = the collapsed ancestor that is not itself inside another collapsed ancestor.
 * This is the correct proxy for routing edges: an edge to a node deep inside two
 * nested collapsed groups should route to the outermost group polygon, not the inner one.
 */
export function getCollapsedGroupForNode(
  nodeId: string,
  groups: GraphGroup[]
): GraphGroup | null {
  // Collect all collapsed groups that (transitively) contain this node
  const containers = groups.filter(
    (g) => g.collapsed && isNodeInGroup(nodeId, g.id, groups)
  );
  if (containers.length === 0) return null;
  if (containers.length === 1) return containers[0];
  // The outermost container is the one that is NOT a descendant of any other container
  const outermost = containers.find(
    (g) => !containers.some(
      (other) => other.id !== g.id && getAllDescendantGroupIds(other.id, groups).includes(g.id)
    )
  );
  return outermost ?? containers[0];
}

/**
 * getAllDescendantNodeIds — returns every node ID that is a direct or transitive
 * child of the given group (recursing into sub-groups).
 */
export function getAllDescendantNodeIds(groupId: string, groups: GraphGroup[]): string[] {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return [];
  const result = [...group.childNodeIds];
  for (const cgId of group.childGroupIds) {
    result.push(...getAllDescendantNodeIds(cgId, groups));
  }
  return result;
}

/**
 * getHiddenNodeIds — returns the set of all node IDs that should be hidden
 * because they reside inside at least one collapsed group.
 */
export function getHiddenNodeIds(groups: GraphGroup[]): Set<string> {
  const hidden = new Set<string>();
  for (const group of groups) {
    if (group.collapsed) {
      getAllDescendantNodeIds(group.id, groups).forEach((id) => hidden.add(id));
    }
  }
  return hidden;
}

/**
 * getHiddenGroupIds — returns the set of group IDs that should be hidden
 * because they reside inside at least one collapsed ancestor group.
 * Used to suppress rendering sub-groups when their parent is collapsed.
 */
export function getHiddenGroupIds(groups: GraphGroup[]): Set<string> {
  const hidden = new Set<string>();
  for (const group of groups) {
    if (group.collapsed) {
      getAllDescendantGroupIds(group.id, groups).forEach((id) => hidden.add(id));
    }
  }
  return hidden;
}

/** Returns node IDs that a group directly and transitively owns, expanded. */
export function getAllDescendantGroupIds(groupId: string, groups: GraphGroup[]): string[] {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return [];
  const result = [...group.childGroupIds];
  for (const cgId of group.childGroupIds) {
    result.push(...getAllDescendantGroupIds(cgId, groups));
  }
  return result;
}

// ─── PHASE VALIDATION ─────────────────────────────────────────────────────────

/**
 * validateGroupPhase — checks that all given node IDs belong to the same phase
 * (or that none of them belong to any phase).
 *
 * Returns `valid = true` when all nodes share one phase or all have no phase.
 * `conflictingPhaseNames` lists the distinct phase names found when invalid.
 */
export function validateGroupPhase(
  nodeIds: string[],
  phases: GraphPhase[]
): { valid: boolean; conflictingPhaseNames: string[] } {
  if (nodeIds.length <= 1) return { valid: true, conflictingPhaseNames: [] };

  const getPhaseFor = (nodeId: string): string | null => {
    for (const phase of phases) {
      if (phase.nodeIds.includes(nodeId)) return phase.id;
    }
    return null;
  };

  const phaseIds = nodeIds.map(getPhaseFor);
  const phaseSet = new Set(phaseIds);

  if (phaseSet.size <= 1) return { valid: true, conflictingPhaseNames: [] };

  const conflictingPhaseNames = [...phaseSet].map((id) => {
    if (id === null) return '(no phase)';
    return phases.find((p) => p.id === id)?.name ?? id;
  });

  return { valid: false, conflictingPhaseNames };
}

// ─── OWNER DERIVATION ─────────────────────────────────────────────────────────

/**
 * deriveGroupOwners — computes the unique owner list for a group based on the
 * owners of its immediate child nodes and the owners of its child sub-groups.
 */
export function deriveGroupOwners(
  childNodeIds: string[],
  childGroupIds: string[],
  nodes: GraphNode[],
  groups: GraphGroup[]
): string[] {
  const owners = new Set<string>();
  for (const id of childNodeIds) {
    const node = nodes.find((n) => n.id === id);
    if (node) owners.add(node.owner);
  }
  for (const gid of childGroupIds) {
    const group = groups.find((g) => g.id === gid);
    if (group) group.owners.forEach((o) => owners.add(o));
  }
  return [...owners];
}

// ─── POLYGON GEOMETRY ─────────────────────────────────────────────────────────

/**
 * computePolygonPoints — builds the SVG `points` attribute string for a regular
 * N-sided polygon centered at (cx, cy) with circumradius r.
 *
 * The first vertex is placed at the top (angle = -90° = -π/2).
 */
export function computePolygonPoints(
  cx: number,
  cy: number,
  r: number,
  sides: number
): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/**
 * computeBoundingPolygonPoints — builds a padded convex bounding polygon around
 * a set of positions.  Used to draw the expanded-group overlay.
 *
 * Returns an SVG `points` string for a rectangle with rounded corners
 * (approximated as an octagon) padded by `pad` on each side.
 */
export function computeBoundingBox(
  positions: { x: number; y: number }[],
  nodeW: number,
  nodeH: number,
  pad: number
): { x: number; y: number; w: number; h: number } {
  if (positions.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...positions.map((p) => p.x)) - pad;
  const maxX = Math.max(...positions.map((p) => p.x)) + nodeW + pad;
  const minY = Math.min(...positions.map((p) => p.y)) - pad;
  const maxY = Math.max(...positions.map((p) => p.y)) + nodeH + pad;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
