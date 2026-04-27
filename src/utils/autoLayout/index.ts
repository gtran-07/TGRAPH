import type { GraphNode, GraphEdge, GraphGroup, Position } from '../../types/graph';
import { NODE_W, NODE_H, COMPONENT_GAP, computeLayout, computeLaneLayout } from '../layout';

export interface AutoLayoutInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups?: GraphGroup[];
  mode: 'dag' | 'lanes';
  /** If set, only lay out nodes with these IDs; fit result into their bounding box */
  selectedOnly?: Set<string>;
  /** Progress callback — called with phase name as each phase completes */
  onProgress?: (phase: string) => void;
}

export type AutoLayoutOutput = Record<string, Position>;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function boundingBox(positions: Map<string, Position> | Record<string, Position>): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  const entries = positions instanceof Map ? [...positions.values()] : Object.values(positions);
  if (entries.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const xs = entries.map((p) => p.x);
  const ys = entries.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs) + NODE_W,
    maxY: Math.max(...ys) + NODE_H,
  };
}

function fitIntoBoundingBox(
  result: Map<string, Position>,
  targetBox: { minX: number; minY: number; maxX: number; maxY: number }
): Map<string, Position> {
  const srcBox = boundingBox(result);
  const scaleX = (targetBox.maxX - targetBox.minX) / Math.max(1, srcBox.maxX - srcBox.minX);
  const scaleY = (targetBox.maxY - targetBox.minY) / Math.max(1, srcBox.maxY - srcBox.minY);
  const scale = Math.min(scaleX, scaleY, 1);

  const out = new Map<string, Position>();
  result.forEach((pos, id) => {
    out.set(id, {
      x: targetBox.minX + (pos.x - srcBox.minX) * scale,
      y: targetBox.minY + (pos.y - srcBox.minY) * scale,
    });
  });
  return out;
}

function tileSideBySide(components: Map<string, Position>[]): Map<string, Position> {
  const out = new Map<string, Position>();
  let offsetX = 0;
  components.forEach((comp) => {
    const box = boundingBox(comp);
    comp.forEach((pos, id) => {
      out.set(id, { x: pos.x - box.minX + offsetX, y: pos.y });
    });
    offsetX += (box.maxX - box.minX) + COMPONENT_GAP;
  });
  return out;
}

// ─── SINGLE-COMPONENT PIPELINE ───────────────────────────────────────────────

function runPipeline(
  nodes: GraphNode[],
  edges: GraphEdge[],
  groups: GraphGroup[],
  mode: 'dag' | 'lanes',
  onProgress?: (phase: string) => void
): Map<string, Position> {
  if (nodes.length === 0) return new Map();

  onProgress?.('analyze');

  let record: Record<string, Position>;

  if (mode === 'lanes') {
    onProgress?.('assignCoordinates');
    const allOwners = new Set(nodes.map((n) => n.owner));
    const { positions } = computeLaneLayout(nodes, edges, allOwners, nodes);
    record = positions;
  } else {
    onProgress?.('assignRanks');
    onProgress?.('minimizeCrossings');
    onProgress?.('assignCoordinates');
    record = computeLayout(nodes, edges, undefined, groups);
  }

  onProgress?.('postprocess');

  const result = new Map<string, Position>();
  Object.entries(record).forEach(([id, pos]) => result.set(id, pos));
  return result;
}

// ─── GROUP HANDLING ──────────────────────────────────────────────────────────

function getAllDescendantNodeIds(groupId: string, groups: GraphGroup[]): Set<string> {
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

function runWithGroups(
  nodes: GraphNode[],
  edges: GraphEdge[],
  groups: GraphGroup[],
  mode: 'dag' | 'lanes',
  onProgress?: (phase: string) => void
): Map<string, Position> {
  const allCollapsed = groups.every((g) => g.collapsed);
  const topGroups = groups.filter((g) => {
    return !groups.some((other) => other.childGroupIds.includes(g.id));
  });

  if (allCollapsed || topGroups.length === 0) {
    return runPipeline(nodes, edges, groups, mode, onProgress);
  }

  const superNodes: GraphNode[] = [];
  const superEdges: GraphEdge[] = [];
  const nodeInGroup = new Map<string, string>();

  topGroups.forEach((g) => {
    if (g.collapsed) return;
    const descendants = getAllDescendantNodeIds(g.id, groups);
    descendants.forEach((nid) => nodeInGroup.set(nid, g.id));
  });

  const standaloneNodes = nodes.filter((n) => !nodeInGroup.has(n.id));

  const addedGroups = new Set<string>();
  nodes.forEach((n) => {
    const gid = nodeInGroup.get(n.id);
    if (gid && !addedGroups.has(gid)) {
      addedGroups.add(gid);
      const g = groups.find((gr) => gr.id === gid)!;
      superNodes.push({
        id: gid,
        name: g.name,
        owner: n.owner,
        description: '',
        dependencies: [],
      });
    }
  });

  const allLayoutNodes = [...standaloneNodes, ...superNodes];

  const resolve = (id: string) => nodeInGroup.get(id) ?? id;
  const edgeSet = new Set<string>();
  edges.forEach((e) => {
    const f = resolve(e.from);
    const t = resolve(e.to);
    if (f === t) return;
    const key = `${f}:${t}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      superEdges.push({ from: f, to: t });
    }
  });

  const outerPositions = runPipeline(allLayoutNodes, superEdges, [], mode, onProgress);

  const result = new Map<string, Position>();
  outerPositions.forEach((pos, id) => {
    const g = groups.find((gr) => gr.id === id && !gr.collapsed);
    if (!g) {
      result.set(id, pos);
      return;
    }
    const memberIds = getAllDescendantNodeIds(id, groups);
    const memberNodes = nodes.filter((n) => memberIds.has(n.id));
    const memberEdges = edges.filter((e) => memberIds.has(e.from) && memberIds.has(e.to));
    const innerPos = runPipeline(memberNodes, memberEdges, groups, mode, onProgress);
    innerPos.forEach((ipos, nid) => {
      result.set(nid, { x: pos.x + ipos.x, y: pos.y + ipos.y });
    });
  });

  return result;
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export function autoLayout(input: AutoLayoutInput): AutoLayoutOutput {
  const { nodes, edges, groups = [], mode, selectedOnly, onProgress } = input;

  let workNodes = nodes;
  let workEdges = edges;
  let savedBox: ReturnType<typeof boundingBox> | null = null;

  if (selectedOnly && selectedOnly.size > 0) {
    workNodes = nodes.filter((n) => selectedOnly.has(n.id));
    workEdges = edges.filter((e) => selectedOnly.has(e.from) && selectedOnly.has(e.to));
    savedBox = null;
  }

  const nodeSet = new Set(workNodes.map((n) => n.id));
  const outAdj = new Map<string, string[]>();
  const inAdj = new Map<string, string[]>();
  workNodes.forEach((n) => { outAdj.set(n.id, []); inAdj.set(n.id, []); });
  workEdges.forEach((e) => {
    if (nodeSet.has(e.from) && nodeSet.has(e.to)) {
      outAdj.get(e.from)?.push(e.to);
      inAdj.get(e.to)?.push(e.from);
    }
  });

  // Union-find connected components
  const parent = new Map<string, string>();
  workNodes.forEach((n) => parent.set(n.id, n.id));
  function find(x: string): string {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }
  workEdges.forEach((e) => {
    if (nodeSet.has(e.from) && nodeSet.has(e.to)) {
      const ra = find(e.from);
      const rb = find(e.to);
      if (ra !== rb) parent.set(ra, rb);
    }
  });

  const compMap = new Map<string, string[]>();
  workNodes.forEach((n) => {
    const root = find(n.id);
    if (!compMap.has(root)) compMap.set(root, []);
    compMap.get(root)!.push(n.id);
  });

  const componentIdSets = [...compMap.values()];

  if (componentIdSets.length > 1) {
    componentIdSets.sort((a, b) => b.length - a.length);

    const compPositions = componentIdSets.map((ids) => {
      const idSet = new Set(ids);
      const compNodes = workNodes.filter((n) => idSet.has(n.id));
      const compEdges = workEdges.filter((e) => idSet.has(e.from) && idSet.has(e.to));
      return runWithGroups(compNodes, compEdges, groups, mode, onProgress);
    });

    const tiled = tileSideBySide(compPositions);

    if (savedBox) {
      const fitted = fitIntoBoundingBox(tiled, savedBox);
      const out: AutoLayoutOutput = {};
      fitted.forEach((pos, id) => { out[id] = pos; });
      return out;
    }

    const out: AutoLayoutOutput = {};
    tiled.forEach((pos, id) => { out[id] = pos; });
    return out;
  }

  const result = runWithGroups(workNodes, workEdges, groups, mode, onProgress);

  if (savedBox) {
    const fitted = fitIntoBoundingBox(result, savedBox);
    const out: AutoLayoutOutput = {};
    fitted.forEach((pos, id) => { out[id] = pos; });
    return out;
  }

  const out: AutoLayoutOutput = {};
  result.forEach((pos, id) => { out[id] = pos; });
  return out;
}
