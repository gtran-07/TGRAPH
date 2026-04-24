/**
 * utils/pathTracing.ts — Finds all directed paths between two nodes in the graph.
 *
 * Used by the Trace Path design tool to let users select a path through the DAG
 * and assign a PathType to all edges on that path in one undo snapshot.
 *
 * Why a separate utility (not extending cinema.ts): computeCriticalPath() in
 * cinema.ts returns node IDs only via topological slack analysis — it doesn't
 * enumerate concrete edge sequences between user-chosen endpoints. This file
 * provides a general-purpose DFS that returns ordered edge arrays.
 */

import type { GraphEdge } from '../types/graph';

/**
 * findAllPaths — find all directed paths from `fromId` to `toId` through the edge list.
 *
 * Algorithm: iterative DFS with a per-branch visited set to allow diamonds
 * (nodes with multiple incoming edges) while preventing cycles.
 *
 * @param fromId   Source node ID
 * @param toId     Target node ID
 * @param edges    Full edge list to search
 * @param maxPaths Safety cap — stops after this many paths to avoid hangs on dense graphs
 * @returns        Array of paths; each path is an ordered array of GraphEdge objects
 */
export function findAllPaths(
  fromId: string,
  toId: string,
  edges: GraphEdge[],
  maxPaths = 10,
): GraphEdge[][] {
  if (fromId === toId) return [];

  // Build adjacency: nodeId → outgoing edges
  const adj = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from)!.push(edge);
  }

  const results: GraphEdge[][] = [];

  // Stack entries: [current node id, edges taken so far, visited set for this branch]
  type Frame = { nodeId: string; path: GraphEdge[]; visited: Set<string> };
  const stack: Frame[] = [{ nodeId: fromId, path: [], visited: new Set([fromId]) }];

  while (stack.length > 0 && results.length < maxPaths) {
    const { nodeId, path, visited } = stack.pop()!;

    const outgoing = adj.get(nodeId) ?? [];
    for (const edge of outgoing) {
      if (visited.has(edge.to)) continue; // cycle guard

      const newPath = [...path, edge];

      if (edge.to === toId) {
        results.push(newPath);
        if (results.length >= maxPaths) break;
      } else {
        stack.push({
          nodeId: edge.to,
          path: newPath,
          visited: new Set([...visited, edge.to]),
        });
      }
    }
  }

  return results;
}

/**
 * pathToEdgeKeys — convert a found path to the composite edge key strings
 * used by the edgePathTypes store map.
 */
export function pathToEdgeKeys(path: GraphEdge[]): string[] {
  return path.map((e) => `${e.from}:${e.to}`);
}
