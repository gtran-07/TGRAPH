/**
 * utils/criticalPath.ts — Extracts user-designated critical chains from edgePathTypes.
 *
 * Critical paths are chains of edges marked with PathType = 'critical' by the user
 * (via the edge-click popover, Inspector, or Trace Path batch tool).
 * This utility reads that data and produces ordered, structured chains for the
 * Critical Path Explorer panel.
 */

import type {
  GraphNode,
  GraphGroup,
  GraphPhase,
  GraphEdge,
  PathType,
  CriticalChain,
  BottleneckNode,
  CriticalChainResult,
} from '../types/graph';
import { CHAIN_PALETTE } from '../types/graph';
import { topologicalSort } from './cinema';
import { getAllDescendantNodeIds } from './grouping';

export function extractCriticalChains(
  nodes: GraphNode[],
  groups: GraphGroup[],
  edges: GraphEdge[],
  edgePathTypes: Record<string, PathType>,
  phases: GraphPhase[],
): CriticalChainResult {
  // 1. Filter critical edge keys
  const criticalEdgeKeys = new Set<string>();
  for (const [key, type] of Object.entries(edgePathTypes)) {
    if (type === 'critical') criticalEdgeKeys.add(key);
  }

  if (criticalEdgeKeys.size === 0) return { chains: [], bottlenecks: [] };

  // 2. Derive node IDs referenced by critical edges
  const criticalNodeIds = new Set<string>();
  for (const key of criticalEdgeKeys) {
    const colonIdx = key.indexOf(':');
    if (colonIdx < 0) continue;
    criticalNodeIds.add(key.slice(0, colonIdx));
    criticalNodeIds.add(key.slice(colonIdx + 1));
  }

  // 3. Build directed critical-edge subgraph
  const criticalEdges = edges.filter(e => criticalEdgeKeys.has(`${e.from}:${e.to}`));

  // 4. Union-Find to detect connected components (undirected connectivity)
  const parent = new Map<string, string>();
  for (const id of criticalNodeIds) parent.set(id, id);

  function find(id: string): string {
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
    return parent.get(id)!;
  }
  function union(a: string, b: string) {
    parent.set(find(a), find(b));
  }

  for (const key of criticalEdgeKeys) {
    const colonIdx = key.indexOf(':');
    if (colonIdx < 0) continue;
    const from = key.slice(0, colonIdx);
    const to = key.slice(colonIdx + 1);
    if (criticalNodeIds.has(from) && criticalNodeIds.has(to)) union(from, to);
  }

  // Group node IDs by component root
  const componentMap = new Map<string, string[]>();
  for (const id of criticalNodeIds) {
    const root = find(id);
    const arr = componentMap.get(root);
    if (arr) arr.push(id);
    else componentMap.set(root, [id]);
  }

  // 5. Build a chain per component (topologically sorted)
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const chains: CriticalChain[] = [];
  let chainIndex = 0;

  for (const [, componentNodeIds] of componentMap) {
    const nodeSet = new Set(componentNodeIds);
    const componentNodes = componentNodeIds
      .map(id => nodeMap.get(id))
      .filter((n): n is GraphNode => n !== undefined);
    const componentEdges = criticalEdges.filter(
      e => nodeSet.has(e.from) && nodeSet.has(e.to)
    );

    const { order, cycleDetected } = topologicalSort(componentNodes, componentEdges);
    if (cycleDetected) continue;

    // Derive owner and phase metadata
    const ownerSet = new Set<string>();
    for (const id of order) {
      const node = nodeMap.get(id);
      if (node?.owner) ownerSet.add(node.owner);
    }

    const phaseSet = new Set<string>();
    for (const phase of phases) {
      for (const nid of phase.nodeIds) {
        if (nodeSet.has(nid)) { phaseSet.add(phase.name); break; }
      }
    }

    // Edge keys for just this chain's edges
    const chainEdgeKeys = new Set<string>();
    for (const e of componentEdges) chainEdgeKeys.add(`${e.from}:${e.to}`);

    // Group parity: groups whose ALL descendant nodes are covered by this chain
    const groupIds: string[] = [];
    for (const group of groups) {
      const descendants = getAllDescendantNodeIds(group.id, groups);
      if (descendants.length > 0 && descendants.every(id => nodeSet.has(id))) {
        groupIds.push(group.id);
      }
    }

    chains.push({
      id: `chain-${chainIndex}`,
      color: CHAIN_PALETTE[chainIndex % CHAIN_PALETTE.length],
      nodeIds: order,
      groupIds,
      edgeKeys: chainEdgeKeys,
      ownerSet,
      phaseSet,
    });
    chainIndex++;
  }

  // 6. Bottleneck detection: nodes shared by ≥2 chains
  const nodeChainCount = new Map<string, string[]>();
  for (const chain of chains) {
    for (const nodeId of chain.nodeIds) {
      const arr = nodeChainCount.get(nodeId);
      if (arr) arr.push(chain.id);
      else nodeChainCount.set(nodeId, [chain.id]);
    }
  }

  const bottlenecks: BottleneckNode[] = [];
  for (const [nodeId, chainIds] of nodeChainCount) {
    if (chainIds.length >= 2) bottlenecks.push({ nodeId, chainIds });
  }

  return { chains, bottlenecks };
}
