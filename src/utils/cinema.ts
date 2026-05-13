/**
 * utils/cinema.ts — Pure auto-generation pipeline for Process Cinema.
 *
 * buildTourSequence() takes raw graph data and returns a complete CinemaSequence.
 * No React, no Zustand, no DOM, no side effects.
 * Safe to call on every Discover click without worrying about cleanup.
 */

import type {
  GraphNode,
  GraphEdge,
  GraphPhase,
  GraphGroup,
  CinemaScene,
  CinemaSceneType,
  CinemaSequence,
  CinemaPredictionOption,
  CinemaEngagementMap,
  HeatTier,
} from '../types/graph';

// ─── READING TIME WEIGHTS (seconds per scene type) ────────────────────────────
// Derived from expected cognitive load per scene type.
// genesis/terminal/bridge: orientation scenes — quick to parse.
// fork/convergence: structural concepts — need a moment to understand.
// bottleneck: highest complexity — parallel inputs, critical path implications.
// prediction gate: interactive — user must answer before advancing.
const READING_TIME_WEIGHTS: Record<CinemaSceneType, number> = {
  genesis: 20,
  terminal: 20,
  bridge: 20,
  reveal: 25,
  fork: 35,
  convergence: 35,
  parallel: 30,
  bottleneck: 45,
  prediction: 60,
};

// ─── PHASE COVERAGE THRESHOLD ────────────────────────────────────────────────
// Phase-based act assignment only activates when at least this fraction of nodes
// are assigned to a phase. Below this threshold, topological depth thirds are used
// because phase data is too sparse to drive meaningful act boundaries.
// 0.30 = 30%
const PHASE_COVERAGE_THRESHOLD = 0.30;

// ─── STEP 1: TOPOLOGICAL SORT (Kahn's algorithm) ──────────────────────────────

export interface TopoResult {
  order: string[];       // nodeIds in topological order
  cycleDetected: boolean;
}

export function topologicalSort(nodes: GraphNode[], edges: GraphEdge[]): TopoResult {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>(); // from → [to]

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adjList.set(n.id, []);
  }

  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    adjList.get(e.from)?.push(e.to);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  // Sort roots deterministically for reproducible output
  queue.sort();

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const neighbor of (adjList.get(current) ?? [])) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        queue.push(neighbor);
        queue.sort(); // keep deterministic
      }
    }
  }

  const cycleDetected = order.length !== nodes.length;
  if (cycleDetected) {
    console.warn('[Cinema] Cycle detected in graph — returning empty sequence.');
  }

  return { order, cycleDetected };
}

// ─── STEP 2: STRUCTURAL FINGERPRINTING ────────────────────────────────────────

interface NodeFingerprint {
  id: string;
  inDegree: number;
  outDegree: number;
  topoDepth: number; // longest path from any root
}

function buildFingerprints(
  nodes: GraphNode[],
  edges: GraphEdge[],
  topoOrder: string[]
): Map<string, NodeFingerprint> {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const n of nodes) { inDeg.set(n.id, 0); outDeg.set(n.id, 0); }
  for (const e of edges) {
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
  }

  // Longest-path depth via forward pass in topo order
  const depth = new Map<string, number>();
  for (const id of topoOrder) depth.set(id, 0);
  for (const id of topoOrder) {
    const d = depth.get(id) ?? 0;
    for (const e of edges) {
      if (e.from === id) {
        const cur = depth.get(e.to) ?? 0;
        if (d + 1 > cur) depth.set(e.to, d + 1);
      }
    }
  }

  const map = new Map<string, NodeFingerprint>();
  for (const n of nodes) {
    map.set(n.id, {
      id: n.id,
      inDegree: inDeg.get(n.id) ?? 0,
      outDegree: outDeg.get(n.id) ?? 0,
      topoDepth: depth.get(n.id) ?? 0,
    });
  }
  return map;
}

// ─── STEP 3: CRITICAL PATH ────────────────────────────────────────────────────

function computeCriticalPath(
  fingerprints: Map<string, NodeFingerprint>,
  edges: GraphEdge[],
  topoOrder: string[]
): Set<string> {
  // Forward pass: earliest depth (already in fingerprints as topoDepth)
  const earliest = new Map<string, number>();
  for (const [id, fp] of fingerprints) earliest.set(id, fp.topoDepth);

  // Compute max depth
  let maxDepth = 0;
  for (const d of earliest.values()) if (d > maxDepth) maxDepth = d;

  // Backward pass: latest depth
  const latest = new Map<string, number>();
  for (const id of topoOrder) latest.set(id, maxDepth);

  // Process in reverse topo order
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i];
    const successors = edges.filter((e) => e.from === id).map((e) => e.to);
    if (successors.length === 0) {
      latest.set(id, maxDepth);
    } else {
      const minSuccessorLatest = Math.min(...successors.map((s) => (latest.get(s) ?? maxDepth) - 1));
      latest.set(id, minSuccessorLatest);
    }
  }

  // On critical path: earliest === latest
  const criticalPath = new Set<string>();
  for (const id of topoOrder) {
    if ((earliest.get(id) ?? 0) === (latest.get(id) ?? 0)) {
      criticalPath.add(id);
    }
  }
  return criticalPath;
}

// ─── STEP 4: ACT ASSIGNMENT ───────────────────────────────────────────────────

interface ActAssignment {
  actOf: Map<string, 1 | 2 | 3>;
  usedPhaseOverride: boolean;
  act2Start: number; // depth boundary
  act3Start: number;
}

function assignActs(
  fingerprints: Map<string, NodeFingerprint>,
  phases: GraphPhase[],
  nodes: GraphNode[]
): ActAssignment {
  const actOf = new Map<string, 1 | 2 | 3>();

  // Check phase coverage
  const assignedToPhase = new Set<string>();
  for (const p of phases) for (const nid of p.nodeIds) assignedToPhase.add(nid);
  const phaseCoverage = nodes.length > 0 ? assignedToPhase.size / nodes.length : 0;
  const usePhaseOverride = phases.length >= 2 && phaseCoverage >= PHASE_COVERAGE_THRESHOLD;

  let act2Start = 0;
  let act3Start = 0;

  if (usePhaseOverride) {
    const sorted = [...phases].sort((a, b) => a.sequence - b.sequence);
    const firstPhaseId = sorted[0].id;
    const lastPhaseId = sorted[sorted.length - 1].id;
    for (const phase of sorted) {
      let act: 1 | 2 | 3;
      if (phase.id === firstPhaseId) act = 1;
      else if (phase.id === lastPhaseId) act = 3;
      else act = 2;
      for (const nid of phase.nodeIds) actOf.set(nid, act);
    }
    // Unassigned nodes get act based on depth
    const depths = [...fingerprints.values()].map((fp) => fp.topoDepth);
    const minD = Math.min(...depths);
    const maxD = Math.max(...depths);
    const range = maxD - minD || 1;
    act2Start = minD + Math.floor(range / 3);
    act3Start = minD + Math.floor((2 * range) / 3);
    for (const [id, fp] of fingerprints) {
      if (!actOf.has(id)) {
        if (fp.topoDepth <= act2Start) actOf.set(id, 1);
        else if (fp.topoDepth <= act3Start) actOf.set(id, 2);
        else actOf.set(id, 3);
      }
    }
    return { actOf, usedPhaseOverride: true, act2Start, act3Start };
  }

  // Default: topological depth thirds
  const depths = [...fingerprints.values()].map((fp) => fp.topoDepth);
  const minD = Math.min(...depths);
  const maxD = Math.max(...depths);
  const range = maxD - minD || 1;
  act2Start = minD + Math.floor(range / 3);
  act3Start = minD + Math.floor((2 * range) / 3);

  for (const [id, fp] of fingerprints) {
    if (fp.topoDepth <= act2Start) actOf.set(id, 1);
    else if (fp.topoDepth <= act3Start) actOf.set(id, 2);
    else actOf.set(id, 3);
  }
  return { actOf, usedPhaseOverride: false, act2Start, act3Start };
}

// ─── STEP 5: SCENE TYPE CLASSIFICATION ────────────────────────────────────────

function classifySceneType(
  node: GraphNode,
  fp: NodeFingerprint,
  criticalPath: Set<string>,
  allRootIds: Set<string>,
  allSinkIds: Set<string>,
  usePhaseOverride: boolean,
  phases: GraphPhase[],
  prevPhaseId: string | null // the phase of the previous node in topo order
): CinemaSceneType {
  // Author overrides take priority
  if (node.cinemaBottleneck) return 'bottleneck';

  // Structural classification
  if (allRootIds.has(node.id)) return 'genesis';
  if (allSinkIds.has(node.id)) return 'terminal';

  if (fp.outDegree >= 2) return 'fork';

  if (fp.inDegree >= 2) {
    return criticalPath.has(node.id) ? 'bottleneck' : 'convergence';
  }

  if (usePhaseOverride) {
    const nodePhase = phases.find((p) => p.nodeIds.includes(node.id));
    if (nodePhase && nodePhase.id !== prevPhaseId) return 'bridge';
  }

  return 'reveal';
}

// ─── STEP 6: COMPRESSION ─────────────────────────────────────────────────────

interface RawScene {
  type: CinemaSceneType;
  act: 1 | 2 | 3;
  nodeIds: string[];
  parentIds?: string[];
  convergenceIds?: string[];
}

function compressScenes(
  topoOrder: string[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  fingerprints: Map<string, NodeFingerprint>,
  criticalPath: Set<string>,
  actOf: Map<string, 1 | 2 | 3>,
  allRootIds: Set<string>,
  allSinkIds: Set<string>,
  usePhaseOverride: boolean,
  phases: GraphPhase[]
): RawScene[] {
  const nodeMap = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));

  // Group all roots into a single genesis scene
  const roots = topoOrder.filter((id) => allRootIds.has(id));
  const sinks = topoOrder.filter((id) => allSinkIds.has(id));
  const middle = topoOrder.filter((id) => !allRootIds.has(id) && !allSinkIds.has(id));

  const scenes: RawScene[] = [];

  // Genesis — all roots together
  if (roots.length > 0) {
    scenes.push({ type: 'genesis', act: 1, nodeIds: roots });
  }

  // Middle nodes — sibling compression + pruning
  // Track which structural concepts have appeared per act
  const conceptsSeenInAct: Record<number, Set<CinemaSceneType>> = { 1: new Set(), 2: new Set(), 3: new Set() };

  // Compute parent sets for sibling detection
  const parentsOf = new Map<string, Set<string>>();
  for (const n of nodes) parentsOf.set(n.id, new Set());
  for (const e of edges) parentsOf.get(e.to)?.add(e.from);

  // Find convergence targets for parallel groups
  const childrenOf = new Map<string, Set<string>>();
  for (const n of nodes) childrenOf.set(n.id, new Set());
  for (const e of edges) childrenOf.get(e.from)?.add(e.to);

  let prevPhaseId: string | null = null;
  const processed = new Set<string>();

  for (const id of middle) {
    if (processed.has(id)) continue;
    const node = nodeMap.get(id);
    if (!node || node.cinemaSkip) { processed.add(id); continue; }

    const fp = fingerprints.get(id)!;
    const act = actOf.get(id) ?? 1;
    const sceneType = classifySceneType(node, fp, criticalPath, allRootIds, allSinkIds, usePhaseOverride, phases, prevPhaseId);

    // Update prevPhaseId for bridge detection
    if (usePhaseOverride) {
      const nodePhase = phases.find((p) => p.nodeIds.includes(id));
      if (nodePhase) prevPhaseId = nodePhase.id;
    }

    // Try sibling compression: same depth, same parents, same scene type, no cross-edges
    const siblings = middle.filter((otherId) => {
      if (otherId === id || processed.has(otherId)) return false;
      const other = nodeMap.get(otherId);
      if (!other || other.cinemaSkip) return false;
      const otherFp = fingerprints.get(otherId)!;
      if (otherFp.topoDepth !== fp.topoDepth) return false;
      if (actOf.get(otherId) !== act) return false;
      // Same parents
      const myParents = parentsOf.get(id)!;
      const otherParents = parentsOf.get(otherId)!;
      if (myParents.size !== otherParents.size) return false;
      for (const p of myParents) if (!otherParents.has(p)) return false;
      // Same scene type
      const otherType = classifySceneType(other, otherFp, criticalPath, allRootIds, allSinkIds, usePhaseOverride, phases, prevPhaseId);
      if (otherType !== sceneType) return false;
      // No cross-edges among the group
      for (const candidate of [id, otherId]) {
        for (const other2 of [id, otherId]) {
          if (candidate === other2) continue;
          if (edges.some((e) => e.from === candidate && e.to === other2)) return false;
        }
      }
      return true;
    });

    if (siblings.length >= 1) {
      const groupIds = [id, ...siblings];
      const sharedParents = [...(parentsOf.get(id) ?? [])];
      // Find convergence points — nodes that all members feed into
      const convergenceIds = [...(childrenOf.get(id) ?? [])].filter((child) =>
        groupIds.every((gid) => childrenOf.get(gid)?.has(child))
      );
      scenes.push({
        type: 'parallel',
        act,
        nodeIds: groupIds,
        parentIds: sharedParents,
        convergenceIds,
      });
      groupIds.forEach((gid) => processed.add(gid));
      conceptsSeenInAct[act].add('parallel');
      continue;
    }

    // Off-critical-path pruning: prune only 'reveal' scenes that are redundant
    const isOnCriticalPath = criticalPath.has(id);
    const isBottleneck = sceneType === 'bottleneck';
    const isRoot = allRootIds.has(id);
    const isSink = allSinkIds.has(id);

    if (
      sceneType === 'reveal' &&
      !isOnCriticalPath && !isBottleneck && !isRoot && !isSink &&
      conceptsSeenInAct[act].has('reveal')
    ) {
      processed.add(id);
      continue;
    }

    scenes.push({ type: sceneType, act, nodeIds: [id] });
    processed.add(id);
    conceptsSeenInAct[act].add(sceneType);
  }

  // Terminal — all sinks together
  if (sinks.length > 0) {
    const sinkAct = actOf.get(sinks[0]) ?? 3;
    scenes.push({ type: 'terminal', act: sinkAct, nodeIds: sinks });
  }

  return scenes;
}

// ─── STEP 7: NARRATIVE SYNTHESIS ─────────────────────────────────────────────

function joinNames(names: string[], max = 3): string {
  if (names.length === 0) return 'unknown';
  if (names.length <= max) {
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  return names.slice(0, max).join(', ') + ` and ${names.length - max} others`;
}

function getPhaseNameFor(nodeId: string, phases: GraphPhase[]): string | null {
  return phases.find((p) => p.nodeIds.includes(nodeId))?.name ?? null;
}

function getPredecessorNames(nodeId: string, edges: GraphEdge[], nodeMap: Map<string, GraphNode>): string[] {
  return edges
    .filter((e) => e.to === nodeId)
    .map((e) => nodeMap.get(e.from)?.name ?? e.from);
}

function getSuccessorNames(nodeId: string, edges: GraphEdge[], nodeMap: Map<string, GraphNode>): string[] {
  return edges
    .filter((e) => e.from === nodeId)
    .map((e) => nodeMap.get(e.to)?.name ?? e.to);
}

function synthesizeScene(
  raw: RawScene,
  nodeMap: Map<string, GraphNode>,
  fingerprints: Map<string, NodeFingerprint>,
  criticalPath: Set<string>,
  edges: GraphEdge[],
  phases: GraphPhase[],
  actMaxOutDegree: Record<number, number>
): CinemaScene {
  const primaryId = raw.nodeIds[0];
  const primaryNode = nodeMap.get(primaryId);
  const fp = fingerprints.get(primaryId);
  const readingTime = READING_TIME_WEIGHTS[raw.type];

  // ── Genesis ──────────────────────────────────────────────────────────────
  if (raw.type === 'genesis') {
    if (raw.nodeIds.length === 1) {
      const node = primaryNode!;
      return {
        type: 'genesis', act: raw.act, nodeIds: raw.nodeIds,
        headline: `${node.name} — where everything begins`,
        body: `${node.name} is owned by ${node.owner}. Nothing in this process exists without it.`,
        insight: 'Single root processes have one point of total failure. Reliability here is reliability everywhere.',
        readingTimeSeconds: readingTime,
      };
    }
    const rootNames = raw.nodeIds.map((id) => nodeMap.get(id)?.name ?? id);
    const n = raw.nodeIds.length;
    return {
      type: 'genesis', act: raw.act, nodeIds: raw.nodeIds,
      headline: `This process has ${n} independent starting points`,
      body: `${joinNames(rootNames)} each begin independently. No single trigger starts this process — ${n} separate inputs can initiate work.`,
      insight: `Multiple roots mean multiple failure modes. If any input stops firing, its downstream work stops silently.`,
      readingTimeSeconds: readingTime,
    };
  }

  // ── Terminal ──────────────────────────────────────────────────────────────
  if (raw.type === 'terminal') {
    if (raw.nodeIds.length === 1) {
      const node = primaryNode!;
      return {
        type: 'terminal', act: raw.act, nodeIds: raw.nodeIds,
        headline: `${node.name} — the final output`,
        body: `${node.name} is the last step in this process. Everything upstream feeds into it.`,
        insight: 'A single sink means this process has one goal. That clarity is valuable.',
        readingTimeSeconds: readingTime,
      };
    }
    const sinkNames = raw.nodeIds.map((id) => nodeMap.get(id)?.name ?? id);
    const n = raw.nodeIds.length;
    return {
      type: 'terminal', act: raw.act, nodeIds: raw.nodeIds,
      headline: `This process produces ${n} independent outputs`,
      body: `${joinNames(sinkNames)} are the final deliverables. Each represents a completed thread of work.`,
      insight: `Multiple sinks mean this process serves multiple purposes simultaneously. Each sink should have an explicit owner responsible for its completion.`,
      readingTimeSeconds: readingTime,
    };
  }

  // ── Fork ──────────────────────────────────────────────────────────────────
  if (raw.type === 'fork' && primaryNode && fp) {
    const successorNames = getSuccessorNames(primaryId, edges, nodeMap);
    const n = successorNames.length;
    return {
      type: 'fork', act: raw.act, nodeIds: raw.nodeIds,
      headline: `The process splits into ${n} parallel paths`,
      body: primaryNode.cinemaScript ??
        (primaryNode.description.length >= 20 ? primaryNode.description
          : `${primaryNode.name} feeds ${joinNames(successorNames)} simultaneously. These paths share no dependency on each other.`),
      insight: `This parallelism compresses ${n} steps into the time it takes to do one. Finding latent parallelism is usually the fastest source of cycle time improvement.`,
      readingTimeSeconds: readingTime,
    };
  }

  // ── Bottleneck ────────────────────────────────────────────────────────────
  if (raw.type === 'bottleneck' && primaryNode && fp) {
    const predecessorNames = getPredecessorNames(primaryId, edges, nodeMap);
    const successorNames = getSuccessorNames(primaryId, edges, nodeMap);
    return {
      type: 'bottleneck', act: raw.act, nodeIds: raw.nodeIds,
      headline: `${primaryNode.name} — convergence point and risk concentrator`,
      body: primaryNode.cinemaScript ??
        (primaryNode.description.length >= 20 ? primaryNode.description
          : `${primaryNode.name} cannot begin until ${joinNames(predecessorNames)} have all completed. Owned by ${primaryNode.owner}. ${successorNames.length} downstream steps wait behind it.`),
      insight: 'High fan-in on the critical path means maximum blast radius. One delayed input stalls everything. This node needs an owner, an SLA, and an escalation path.',
      readingTimeSeconds: readingTime,
    };
  }

  // ── Convergence ───────────────────────────────────────────────────────────
  if (raw.type === 'convergence' && primaryNode) {
    const predecessorNames = getPredecessorNames(primaryId, edges, nodeMap);
    return {
      type: 'convergence', act: raw.act, nodeIds: raw.nodeIds,
      headline: `${primaryNode.name} — paths merge here`,
      body: primaryNode.cinemaScript ??
        (primaryNode.description.length >= 20 ? primaryNode.description
          : `${primaryNode.name} waits for ${joinNames(predecessorNames)}. It is not on the critical path — it has some slack to absorb delays.`),
      insight: 'Not every merge point is a bottleneck. This one has slack — delays here have limited downstream impact compared to the critical path.',
      readingTimeSeconds: readingTime,
    };
  }

  // ── Bridge ────────────────────────────────────────────────────────────────
  if (raw.type === 'bridge' && primaryNode) {
    const phaseName = getPhaseNameFor(primaryId, phases) ?? 'the next phase';
    return {
      type: 'bridge', act: raw.act, nodeIds: raw.nodeIds,
      headline: `Entering ${phaseName}`,
      body: primaryNode.cinemaScript ??
        (primaryNode.description.length >= 20 ? primaryNode.description
          : `${primaryNode.name} marks the transition into ${phaseName}. Owned by ${primaryNode.owner}.`),
      readingTimeSeconds: readingTime,
    };
  }

  // ── Parallel group ────────────────────────────────────────────────────────
  if (raw.type === 'parallel') {
    const n = raw.nodeIds.length;
    const parentNames = (raw.parentIds ?? []).map((pid) => nodeMap.get(pid)?.name ?? pid);
    const convergenceNames = (raw.convergenceIds ?? []).map((cid) => nodeMap.get(cid)?.name ?? cid);
    const ownerSet = new Set(raw.nodeIds.map((id) => nodeMap.get(id)?.owner ?? '').filter(Boolean));
    const ownerList = [...ownerSet];
    return {
      type: 'parallel', act: raw.act, nodeIds: raw.nodeIds,
      parentIds: raw.parentIds,
      convergenceIds: raw.convergenceIds,
      headline: `${n} steps run simultaneously`,
      body: `These ${n} nodes all depend on ${joinNames(parentNames)} and have no dependency on each other. Owned by ${joinNames(ownerList)}. ${convergenceNames.length > 0 ? `All must complete before ${joinNames(convergenceNames)}.` : ''}`,
      insight: `Parallel groups like this are where process efficiency is built. They are also where accountability diffuses — ${n} owners, but often no single coordinator.`,
      readingTimeSeconds: readingTime,
    };
  }

  // ── Reveal (default) ─────────────────────────────────────────────────────
  if (primaryNode && fp) {
    const predecessorNames = getPredecessorNames(primaryId, edges, nodeMap);
    const successorNames = getSuccessorNames(primaryId, edges, nodeMap);
    const isOnCP = criticalPath.has(primaryId);
    const isHighOutDegree = fp.outDegree === actMaxOutDegree[raw.act] && fp.outDegree > 1;
    const body = primaryNode.cinemaScript ??
      (primaryNode.description.length >= 20 ? primaryNode.description
        : `${primaryNode.name} is owned by ${primaryNode.owner}. Depends on ${predecessorNames.length > 0 ? joinNames(predecessorNames) : 'nothing'}. Feeds ${successorNames.length > 0 ? joinNames(successorNames) : 'nothing'}.`);
    const insight = (isOnCP || isHighOutDegree)
      ? (isOnCP
        ? `${primaryNode.name} is on the critical path — delays here extend the total process duration.`
        : `${primaryNode.name} fans out to ${fp.outDegree} successors — one of the highest in this act.`)
      : undefined;
    return {
      type: 'reveal', act: raw.act, nodeIds: raw.nodeIds,
      headline: primaryNode.name,
      body,
      insight,
      readingTimeSeconds: readingTime,
    };
  }

  // Fallback (should not reach)
  return {
    type: 'reveal', act: raw.act, nodeIds: raw.nodeIds,
    headline: primaryId,
    body: primaryId,
    readingTimeSeconds: readingTime,
  };
}

// ─── STEP 8: PREDICTION GATE INSERTION ────────────────────────────────────────

function insertPredictionGates(scenes: CinemaScene[], nodeMap: Map<string, GraphNode>): CinemaScene[] {
  const result: CinemaScene[] = [];
  const conceptsSeen = new Set<string>();

  // Track which concept pairs we've gated on (no repetition)
  // Gate keys: "fork→parallel", "bottleneck→convergence"
  const GATE_TRIGGERS: Record<string, string> = {
    fork: 'after-fork',
    bottleneck: 'after-bottleneck',
  };

  for (let i = 0; i < scenes.length; i++) {
    result.push(scenes[i]);
    const scene = scenes[i];

    if (!(scene.type in GATE_TRIGGERS)) continue;
    const gateKey = GATE_TRIGGERS[scene.type];
    if (conceptsSeen.has(gateKey)) continue;

    const nextScene = scenes[i + 1];
    if (!nextScene) continue;

    // Only insert if the next concept would not be obvious to a DAG newcomer
    const nextType = nextScene.type;
    if (nextType === 'genesis' || nextType === 'reveal') continue;

    conceptsSeen.add(gateKey);

    const gate = buildPredictionGate(scene, nextScene, scenes, nodeMap);
    if (gate) result.push(gate);
  }
  return result;
}

function buildPredictionGate(
  triggerScene: CinemaScene,
  nextScene: CinemaScene,
  allScenes: CinemaScene[],
  nodeMap: Map<string, GraphNode>
): CinemaScene | null {
  const nextId = nextScene.nodeIds[0];
  const nextNode = nodeMap.get(nextId);
  if (!nextNode) return null;

  let question = '';
  let correctAnswer = '';
  let wrongA = '';
  let wrongAFeedback = '';
  let wrongBId = '';

  if (triggerScene.type === 'fork') {
    question = `${triggerScene.headline}. What happens to those parallel paths next?`;
    correctAnswer = `They run independently and all must complete before their outputs are used`;
    wrongA = `They merge immediately — one path finishes first and the others are cancelled`;
    wrongAFeedback = `Parallel paths in a DAG run to completion independently. They are not races — there is no cancellation.`;
  } else if (triggerScene.type === 'bottleneck') {
    question = `${nextNode.name} collects multiple inputs. What does that mean for the process?`;
    correctAnswer = `Every input must arrive before ${nextNode.name} can start — any delay cascades`;
    wrongA = `${nextNode.name} starts as soon as the first input arrives — the others catch up later`;
    wrongAFeedback = `An AND-join requires ALL predecessors to complete before the node can start. This is a convergence, not an OR-join.`;
  } else {
    return null;
  }

  // Wrong B: a node from this graph that shares at least 2 properties with the correct answer
  // Property matching: same owner, same act, or same inDegree/outDegree profile
  // Pick a node not in the trigger or next scene, from a different structural role
  const candidatesForWrongB = allScenes
    .filter((s) => s !== triggerScene && s !== nextScene && s.nodeIds.length === 1 && s.type !== 'genesis' && s.type !== 'terminal')
    .map((s) => nodeMap.get(s.nodeIds[0]))
    .filter((n): n is GraphNode => !!n && n.id !== nextId);

  const wrongBNode = candidatesForWrongB.find(
    (n) => n.owner === nextNode.owner || n.id !== triggerScene.nodeIds[0]
  ) ?? candidatesForWrongB[0];

  wrongBId = wrongBNode?.name ?? 'another step in this process';
  const wrongBFeedback = wrongBNode
    ? `${wrongBNode.name} is in this graph but plays a different structural role — it does not have the convergence characteristic of ${nextNode.name}.`
    : `That step exists in the graph but doesn't match the convergence pattern here.`;

  const options: CinemaPredictionOption[] = shuffle([
    { id: 'correct', text: correctAnswer, isCorrect: true, feedback: `Correct. In a DAG, all predecessors must complete before a node starts. ${nextNode.name} is an AND-join.` },
    { id: 'wrong-a', text: wrongA, isCorrect: false, feedback: wrongAFeedback },
    { id: 'wrong-b', text: wrongBId, isCorrect: false, feedback: wrongBFeedback },
  ]);

  return {
    type: 'prediction',
    act: nextScene.act,
    nodeIds: nextScene.nodeIds,
    headline: question,
    body: '',
    prediction: { question, options },
    readingTimeSeconds: READING_TIME_WEIGHTS['prediction'],
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── STEP 9: READING TIME ESTIMATE ────────────────────────────────────────────

function computeEstimatedMinutes(scenes: CinemaScene[]): number {
  const totalSeconds = scenes.reduce((sum, s) => sum + s.readingTimeSeconds, 0);
  // Round to nearest 0.5 min
  return Math.round((totalSeconds / 60) * 2) / 2;
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * buildTourSequence — the full 9-step cinema pipeline.
 *
 * @param nodes - All nodes in the graph (not just visible)
 * @param edges - All edges derived from node dependencies
 * @param phases - Phase bands (may be empty)
 * @param groups - Groups (used for future node-group parity; not yet driving scene types)
 * @param priorEngagement - Engagement scores from a previous cinema session.
 *   Accepted now for API stability; cold-node prioritization will be implemented here
 *   in the second-visit cinema (Phase 2). Currently unused.
 */
export function buildTourSequence(
  nodes: GraphNode[],
  edges: GraphEdge[],
  phases: GraphPhase[],
  _groups: GraphGroup[],
  _priorEngagement?: CinemaEngagementMap
): CinemaSequence {
  // Filter out cinemaSkip nodes before any processing
  const activeNodes = nodes.filter((n) => !n.cinemaSkip);
  const activeNodeIds = new Set(activeNodes.map((n) => n.id));
  const activeEdges = edges.filter((e) => activeNodeIds.has(e.from) && activeNodeIds.has(e.to));

  if (activeNodes.length === 0) {
    return { scenes: [], estimatedMinutes: 0, actBoundaries: { act2Start: 0, act3Start: 0 }, usedPhaseOverride: false };
  }

  // Step 1: Topological sort
  const { order, cycleDetected } = topologicalSort(activeNodes, activeEdges);
  if (cycleDetected) {
    return { scenes: [], estimatedMinutes: 0, actBoundaries: { act2Start: 0, act3Start: 0 }, usedPhaseOverride: false };
  }

  // Step 2: Structural fingerprints
  const fingerprints = buildFingerprints(activeNodes, activeEdges, order);

  // Step 3: Critical path
  const criticalPath = computeCriticalPath(fingerprints, activeEdges, order);

  // Roots and sinks
  const allRootIds = new Set(order.filter((id) => (fingerprints.get(id)?.inDegree ?? 0) === 0));
  const allSinkIds = new Set(order.filter((id) => (fingerprints.get(id)?.outDegree ?? 0) === 0));

  // Step 4: Act assignment
  const { actOf, usedPhaseOverride, act2Start, act3Start } = assignActs(fingerprints, phases, activeNodes);

  // Compute max outDegree per act for reveal insight threshold
  const actMaxOutDegree: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const [id, fp] of fingerprints) {
    const act = actOf.get(id) ?? 1;
    if (fp.outDegree > (actMaxOutDegree[act] ?? 0)) actMaxOutDegree[act] = fp.outDegree;
  }

  // Step 5 + 6: Compression (classification embedded)
  const rawScenes = compressScenes(
    order, activeNodes, activeEdges, fingerprints, criticalPath,
    actOf, allRootIds, allSinkIds, usedPhaseOverride, phases
  );

  const nodeMap = new Map<string, GraphNode>(activeNodes.map((n) => [n.id, n]));

  // Step 7: Narrative synthesis
  const narratedScenes: CinemaScene[] = rawScenes.map((raw) =>
    synthesizeScene(raw, nodeMap, fingerprints, criticalPath, activeEdges, phases, actMaxOutDegree)
  );

  // Step 8: Prediction gate insertion
  const withGates = insertPredictionGates(narratedScenes, nodeMap);

  // Compute act boundary scene indices from the final scene list
  let act2SceneStart = withGates.length;
  let act3SceneStart = withGates.length;
  for (let i = 0; i < withGates.length; i++) {
    if (withGates[i].act >= 2 && act2SceneStart === withGates.length) act2SceneStart = i;
    if (withGates[i].act >= 3 && act3SceneStart === withGates.length) act3SceneStart = i;
  }

  // Step 9: Reading time
  const estimatedMinutes = computeEstimatedMinutes(withGates);

  return {
    scenes: withGates,
    estimatedMinutes,
    actBoundaries: { act2Start: act2SceneStart, act3Start: act3SceneStart },
    usedPhaseOverride,
  };
}

// ─── NORMALIZATION UTILITIES (used by startHeatmap in graphStore) ──────────────

/**
 * computeNormalizedEngagement — converts raw accumulated scores to normalized ratios.
 *
 * Baseline = mean raw score across all nodes that appeared in focus during the run.
 * Normalized score per node = raw score / baseline.
 *
 * Called at tier-assignment time (startHeatmap), never at accumulation time.
 * This ensures two users with identical relative attention patterns get identical
 * tier assignments regardless of how long each spent in the cinema.
 */
export function computeNormalizedEngagement(
  raw: CinemaEngagementMap,
  visitedNodeIds: string[]
): CinemaEngagementMap {
  if (visitedNodeIds.length === 0) return {};
  const total = visitedNodeIds.reduce((sum, id) => sum + (raw[id] ?? 0), 0);
  const baseline = total / visitedNodeIds.length;
  if (baseline === 0) return {};
  const normalized: CinemaEngagementMap = {};
  for (const id of visitedNodeIds) {
    normalized[id] = (raw[id] ?? 0) / baseline;
  }
  return normalized;
}

/**
 * assignHeatTier — maps a normalized engagement score to a display tier.
 *
 * Thresholds are relative to the per-run baseline (1.0 = exactly average):
 *   hot  >= 2.0  — user spent 2x+ the average on this node
 *   warm >= 1.0  — at or above average
 *   cold  < 1.0  — below average (seen but not dwelled on)
 *   ice       0 or absent (never in cinema, or zero raw score)
 */
export function assignHeatTier(score: number | undefined): HeatTier {
  if (!score) return 'ice';
  if (score >= 2.0) return 'hot';
  if (score >= 1.0) return 'warm';
  return 'cold';
}
