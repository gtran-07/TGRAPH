import { useMemo } from 'react';
import { useGraphStore } from '../../store/graphStore';

export interface FilteredNode {
  id: string;
  label: string;
  owner: string;
  color: string;
  badge: 'likely' | 'upstream' | 'downstream' | null;
  connected: boolean;
  position: { x: number; y: number } | null;
}

export interface OwnerGroup {
  owner: string;
  color: string;
  nodes: FilteredNode[];
}

export interface SummonData {
  ownerGroups: OwnerGroup[];
  totalCount: number;
  filteredCount: number;
  ghostRingNodes: FilteredNode[];
  showRingButton: boolean;
  connectToSource: (targetId: string) => void;
}

function badgePriority(b: FilteredNode['badge']): number {
  if (b === 'likely') return 0;
  if (b === 'upstream') return 1;
  if (b === 'downstream') return 2;
  return 3;
}

export function useSummonMode(): SummonData {
  const allNodes = useGraphStore(s => s.allNodes);
  const allEdges = useGraphStore(s => s.allEdges);
  const ownerColors = useGraphStore(s => s.ownerColors);
  const positions = useGraphStore(s => s.positions);
  const summonActive = useGraphStore(s => s.summonActive);
  const summonSourceId = useGraphStore(s => s.summonSourceId);
  const summonSourceIds = useGraphStore(s => s.summonSourceIds);
  const summonFilter = useGraphStore(s => s.summonFilter);
  const summonShowRing = useGraphStore(s => s.summonShowRing);
  const summonConnected = useGraphStore(s => s.summonConnected);
  const addEdge = useGraphStore(s => s.addEdge);
  const addSummonConnected = useGraphStore(s => s.addSummonConnected);

  return useMemo(() => {
    const noop = () => {};

    if (!summonActive || !summonSourceId) {
      return {
        ownerGroups: [],
        totalCount: 0,
        filteredCount: 0,
        ghostRingNodes: [],
        showRingButton: false,
        connectToSource: noop,
      };
    }

    const sourceSet = new Set(summonSourceIds);
    const primaryNode = allNodes.find(n => n.id === summonSourceId);
    if (!primaryNode) {
      return {
        ownerGroups: [],
        totalCount: 0,
        filteredCount: 0,
        ghostRingNodes: [],
        showRingButton: false,
        connectToSource: noop,
      };
    }

    // Union of tags across all source nodes for badge inference
    const sourceTags = new Set(
      summonSourceIds.flatMap(id => {
        const n = allNodes.find(x => x.id === id);
        return (n?.tags ?? []).map(t => t.label);
      })
    );
    const edgeSet = new Set(allEdges.map(e => `${e.from}:${e.to}`));

    const candidates = allNodes.filter(n => !sourceSet.has(n.id));
    const totalCount = candidates.length;

    const filterLower = summonFilter.toLowerCase();
    const filtered = filterLower
      ? candidates.filter(n => n.name.toLowerCase().includes(filterLower))
      : candidates;
    const filteredCount = filtered.length;

    const mapped: FilteredNode[] = filtered.map(n => {
      // Connected if any source→target or target→source edge exists for any source
      const hasEdgeToAnySource = summonSourceIds.some(sid => edgeSet.has(`${n.id}:${sid}`));
      const hasEdgeFromAnySource = summonSourceIds.some(sid => edgeSet.has(`${sid}:${n.id}`));
      const connected = hasEdgeToAnySource || hasEdgeFromAnySource || summonConnected.has(n.id);

      let badge: FilteredNode['badge'] = null;
      if (hasEdgeToAnySource) badge = 'upstream';
      else if (hasEdgeFromAnySource) badge = 'downstream';
      else if (!connected && (n.tags ?? []).some(t => sourceTags.has(t.label))) badge = 'likely';

      return {
        id: n.id,
        label: n.name,
        owner: n.owner || 'Unassigned',
        color: ownerColors[n.owner] ?? 'var(--accent)',
        badge,
        connected,
        position: positions[n.id] ?? null,
      };
    });

    mapped.sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? 1 : -1;
      const pa = badgePriority(a.badge);
      const pb = badgePriority(b.badge);
      if (pa !== pb) return pa - pb;
      return a.label.localeCompare(b.label);
    });

    const groupMap = new Map<string, FilteredNode[]>();
    for (const node of mapped) {
      const arr = groupMap.get(node.owner);
      if (arr) arr.push(node);
      else groupMap.set(node.owner, [node]);
    }

    const ownerGroups: OwnerGroup[] = Array.from(groupMap.entries()).map(([owner, nodes]) => ({
      owner,
      color: ownerColors[owner] ?? 'var(--accent)',
      nodes,
    }));

    const ghostRingNodes = summonShowRing && filteredCount <= 12 ? mapped : [];
    const showRingButton = filteredCount <= 12 && filteredCount > 0 && !summonShowRing;

    // Create edges from ALL source nodes to the chosen target
    const connectToSource = (targetId: string) => {
      summonSourceIds.forEach(sid => addEdge(sid, targetId));
      addSummonConnected(targetId);
    };

    return { ownerGroups, totalCount, filteredCount, ghostRingNodes, showRingButton, connectToSource };
  }, [
    allNodes, allEdges, ownerColors, positions,
    summonActive, summonSourceId, summonSourceIds, summonFilter, summonShowRing, summonConnected,
    addEdge, addSummonConnected,
  ]);
}
