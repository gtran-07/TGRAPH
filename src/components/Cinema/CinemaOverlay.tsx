/**
 * CinemaOverlay.tsx
 *
 * Exports:
 *   CinemaOverlay    — first-visit banner portalled into #canvas-wrap.
 *   CinemaTabContent — full cinema UI rendered as a sidebar tab body.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useGraphStore } from '../../store/graphStore';
import type { CinemaScene, CinemaSceneType } from '../../types/graph';
import { NODE_W, NODE_H } from '../../utils/layout';
import styles from './CinemaOverlay.module.css';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DWELL_WEIGHT = 1.0;
const CLICK_WEIGHT = 300;
const REVISIT_WEIGHT = 500;

const TYPE_LABELS: Record<CinemaSceneType, string> = {
  genesis: 'Origin',
  terminal: 'Output',
  fork: 'Fork',
  bottleneck: 'Bottleneck',
  convergence: 'Convergence',
  bridge: 'Phase Transition',
  reveal: 'Step',
  parallel: 'Parallel Group',
  prediction: 'Predict',
};

const TYPE_PILL_CLASS: Record<CinemaSceneType, string> = {
  genesis: styles.typeGenesis,
  terminal: styles.typeTerminal,
  fork: styles.typeFork,
  bottleneck: styles.typeBottleneck,
  convergence: styles.typeConvergence,
  bridge: styles.typeBridge,
  reveal: styles.typeReveal,
  parallel: styles.typeParallel,
  prediction: styles.typePrediction,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function computeRoleMap(
  scene: CinemaScene,
  visitedIds: Set<string>,
  allNodeIds: string[]
): Record<string, string> {
  const map: Record<string, string> = {};
  const focusSet = new Set(scene.nodeIds);
  const litSet = new Set<string>([
    ...(scene.parentIds ?? []),
    ...(scene.convergenceIds ?? []),
  ]);
  const isDanger = scene.type === 'bottleneck';
  for (const id of allNodeIds) {
    if (focusSet.has(id)) map[id] = isDanger ? 'danger' : 'focus';
    else if (visitedIds.has(id)) map[id] = 'visited';
    else if (litSet.has(id)) map[id] = 'lit';
    else map[id] = 'ghost';
  }
  return map;
}

const BANNER_KEY = 'flowgraph:cinema-banner-seen:';
function shouldShowBanner(f: string | null) { return !!f && !localStorage.getItem(BANNER_KEY + f); }
function dismissBanner(f: string | null) { if (f) localStorage.setItem(BANNER_KEY + f, '1'); }

function graphIsComplex(
  nodes: import('../../types/graph').GraphNode[],
  edges: import('../../types/graph').GraphEdge[],
  phases: import('../../types/graph').GraphPhase[]
): boolean {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const n of nodes) { inDeg.set(n.id, 0); outDeg.set(n.id, 0); }
  for (const e of edges) {
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
  }
  const assigned = new Set(phases.flatMap((p) => p.nodeIds)).size;
  return [...inDeg.values()].some((d) => d >= 2)
    || [...outDeg.values()].some((d) => d >= 2)
    || (phases.length >= 2 && nodes.length > 0 && assigned / nodes.length >= 0.3);
}

function timeRemainingLabel(scenes: CinemaScene[], from: number) {
  const secs = scenes.slice(from).reduce((s, sc) => s + sc.readingTimeSeconds, 0);
  const mins = Math.ceil(secs / 60);
  return mins < 1 ? '< 1 min' : `~${mins} min`;
}

// ─── BANNER ───────────────────────────────────────────────────────────────────
// Portalled into #canvas-wrap. Only shown when cinema is NOT active.

export function CinemaOverlay(): React.ReactElement | null {
  const { discoveryActive, allNodes, allEdges, phases, currentFileName } = useGraphStore();
  const [bannerVisible, setBannerVisible] = useState(false);

  useEffect(() => {
    if (!discoveryActive && graphIsComplex(allNodes, allEdges, phases)) {
      setBannerVisible(shouldShowBanner(currentFileName));
    }
  }, [discoveryActive, allNodes, allEdges, phases, currentFileName]);

  const canvasWrap = document.getElementById('canvas-wrap');
  if (!canvasWrap || discoveryActive || !bannerVisible) return null;

  return ReactDOM.createPortal(
    <div className={styles.overlay} data-cinema-overlay="">
      <div className={styles.banner}>
        <span className={styles.bannerText}>
          <strong>Process Cinema</strong> — discover the structure of this graph as a guided story.
        </span>
        <button className={styles.bannerBtn} onClick={() => { dismissBanner(currentFileName); setBannerVisible(false); }}>
          Got it
        </button>
        <button className={styles.bannerDismiss} onClick={() => { dismissBanner(currentFileName); setBannerVisible(false); }} aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>,
    canvasWrap
  );
}

// ─── TAB CONTENT ──────────────────────────────────────────────────────────────
// Rendered as a sidebar tab body. No portal, no absolute positioning.

export function CinemaTabContent(): React.ReactElement | null {
  const {
    discoveryActive, discoveryPhase, discoverySequence, discoverySceneIndex, discoveryVisited,
    allNodes, allEdges, phases, positions, transform,
    exitDiscovery, startHeatmap, exitCinemaExperience, completeDiscovery,
    advanceScene, retreatScene, visitNode, recordEngagement,
    setDiscoveryRoleMap, flyTo,
    startReconstruction, reconstructionAccuracy, selectedReconstructionChip,
    selectReconstructionChip, completeReconstruction, heatTiers,
    viewMode, setViewMode, focusMode, exitFocusMode, focusedOwner, exitOwnerFocus,
    pathHighlightNodeId, setPathHighlight,
  } = useGraphStore();

  const [showPreview, setShowPreview] = useState(true);
  const [answeredOptionId, setAnsweredOptionId] = useState<string | null>(null);
  const [smartFly, setSmartFly] = useState(true);
  const [shuffledChips, setShuffledChips] = useState<{ nodeId: string; name: string }[]>([]);
  const sceneStartRef = useRef<number>(Date.now());
  const clickCountRef = useRef<Record<string, number>>({});

  const isSceneVisible = useCallback((scene: CinemaScene): boolean => {
    const el = document.getElementById('canvas-wrap');
    if (!el) return false;
    const { width: W, height: H } = el.getBoundingClientRect();
    const { positions: pos, transform: tr } = useGraphStore.getState();
    const pts = scene.nodeIds.map((id) => pos[id]).filter(Boolean) as { x: number; y: number }[];
    if (!pts.length) return false;
    const { x: tx, y: ty, k } = tr;
    const MARGIN = 40;
    return pts.every((p) => {
      const sx = p.x * k + tx;
      const sy = p.y * k + ty;
      const ex = (p.x + NODE_W) * k + tx;
      const ey = (p.y + NODE_H) * k + ty;
      return sx >= MARGIN && ex <= W - MARGIN && sy >= MARGIN && ey <= H - MARGIN;
    });
  }, []);

  const flyToScene = useCallback((scene: CinemaScene, force = false) => {
    if (!force && smartFly && isSceneVisible(scene)) return;
    const el = document.getElementById('canvas-wrap');
    if (!el) return;
    const { width: W, height: H } = el.getBoundingClientRect();
    const { positions: pos, allEdges } = useGraphStore.getState();

    // Build the full set of relevant node IDs: focus + explicit lineage + immediate neighbors
    const focusSet = new Set(scene.nodeIds);
    const lineageIds = new Set<string>([
      ...scene.nodeIds,
      ...(scene.parentIds ?? []),
      ...(scene.convergenceIds ?? []),
    ]);
    // Add 1-hop neighbors (ancestors + descendants) of the focus nodes
    for (const edge of allEdges) {
      if (focusSet.has(edge.to)) lineageIds.add(edge.from);
      if (focusSet.has(edge.from)) lineageIds.add(edge.to);
    }

    const pts = [...lineageIds].map((id) => pos[id]).filter(Boolean) as { x: number; y: number }[];
    if (!pts.length) return;
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxX = Math.max(...pts.map((p) => p.x + NODE_W));
    const maxY = Math.max(...pts.map((p) => p.y + NODE_H));
    const PAD = 100;
    const k = Math.min(
      (W - PAD * 2) / (maxX - minX || 1),
      (H - PAD * 2) / (maxY - minY || 1),
      1.0,
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    flyTo({ x: W / 2 - cx * k, y: H / 2 - cy * k, k: Math.max(k, 0.3) });
  }, [smartFly, isSceneVisible, flyTo]);

  // Reset on cinema start
  useEffect(() => {
    if (discoveryPhase === 'cinema') {
      setShowPreview(true);
      setAnsweredOptionId(null);
      clickCountRef.current = {};
    }
  }, [discoveryPhase]);

  // Reset prediction on scene change
  useEffect(() => {
    setAnsweredOptionId(null);
    sceneStartRef.current = Date.now();
    clickCountRef.current = {};
  }, [discoverySceneIndex]);

  // Apply canvas staging
  const visitedSet = new Set(discoveryVisited);
  const allNodeIds = allNodes.map((n) => n.id);

  useEffect(() => {
    if (!discoveryActive || showPreview || !discoverySequence) return;
    const scene = discoverySequence.scenes[discoverySceneIndex];
    if (!scene) return;
    setDiscoveryRoleMap(computeRoleMap(scene, visitedSet, allNodeIds));
    scene.nodeIds.forEach((id) => visitNode(id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryActive, showPreview, discoverySceneIndex, discoverySequence]);

  // Canvas click tracking
  useEffect(() => {
    if (!discoveryActive) return;
    const handle = (e: MouseEvent) => {
      const g = (e.target as Element).closest('.node-group');
      if (!g) return;
      const id = g.getAttribute('data-id') ?? g.getAttribute('data-group-id');
      if (id) clickCountRef.current[id] = (clickCountRef.current[id] ?? 0) + 1;
    };
    document.getElementById('canvas-wrap')?.addEventListener('click', handle);
    return () => document.getElementById('canvas-wrap')?.removeEventListener('click', handle);
  }, [discoveryActive]);

  // Reconstruction: apply blank classes + initialize chip pool on phase entry
  useEffect(() => {
    if (discoveryPhase !== 'reconstruction') return;

    // Build shuffled chip pool from the nodes that appeared in focus
    const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
    const chips = discoveryVisited.map((id) => ({
      nodeId: id,
      name: nodeMap.get(id)?.name ?? id,
    }));
    // Fisher-Yates shuffle
    const arr = [...chips];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    setShuffledChips(arr);

    // Blank out every visited node on the canvas
    for (const id of discoveryVisited) {
      document.querySelector(`.node-group[data-id="${id}"]`)
        ?.classList.add('reconstruction-blank');
    }

    return () => {
      // Remove all reconstruction styling when leaving this phase
      for (const id of discoveryVisited) {
        document.querySelector(`.node-group[data-id="${id}"]`)
          ?.classList.remove('reconstruction-blank', 'reconstruction-correct', 'reconstruction-wrong');
      }
    };
  // discoveryVisited and allNodes are stable during reconstruction; dep on discoveryPhase only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryPhase]);

  // Heatmap tier classes are now applied via NodeCard's className prop (heatClass) so they
  // survive React re-renders. No imperative DOM writes needed here.
  // Cleanup of non-React-managed classes (reconstruction-*) still happens via the
  // reconstruction useEffect's cleanup above.

  // Reconstruction: auto-advance to Phase 3 when all nodes are placed
  const placedCount = discoveryVisited.filter((id) => reconstructionAccuracy[id] === true).length;
  const reconstructionTotal = discoveryVisited.length;
  const isReconstructionComplete = reconstructionTotal > 0 && placedCount === reconstructionTotal;
  const isPerfectReconstruction = isReconstructionComplete &&
    Object.values(reconstructionAccuracy).every((v) => v === true);

  useEffect(() => {
    if (!isReconstructionComplete) return;
    const timer = setTimeout(() => completeReconstruction(), 2000);
    return () => clearTimeout(timer);
  // completeReconstruction is a stable store reference; isReconstructionComplete is derived.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReconstructionComplete]);

  // Engagement scoring
  const commitEngagement = useCallback(() => {
    if (!discoverySequence) return;
    const scene = discoverySequence.scenes[discoverySceneIndex];
    if (!scene) return;
    const dwell = Date.now() - sceneStartRef.current;
    for (const id of scene.nodeIds) {
      const revisits = discoveryVisited.filter((v) => v === id).length;
      recordEngagement(id, dwell * DWELL_WEIGHT + (clickCountRef.current[id] ?? 0) * CLICK_WEIGHT + revisits * REVISIT_WEIGHT);
    }
  }, [discoverySequence, discoverySceneIndex, discoveryVisited, recordEngagement]);

  const resetToMainView = useCallback(() => {
    if (focusMode) exitFocusMode();
    if (focusedOwner) exitOwnerFocus();
    if (pathHighlightNodeId) setPathHighlight(null);
    if (viewMode !== 'dag') setViewMode('dag');
  }, [focusMode, exitFocusMode, focusedOwner, exitOwnerFocus, pathHighlightNodeId, setPathHighlight, viewMode, setViewMode]);

  const handleNext = useCallback(() => {
    commitEngagement();
    const scenes = discoverySequence?.scenes ?? [];
    if (discoverySceneIndex >= scenes.length - 1) {
      completeDiscovery();
      return;
    }
    resetToMainView();
    const next = scenes[discoverySceneIndex + 1];
    advanceScene();
    flyToScene(next, true);
  }, [commitEngagement, discoverySceneIndex, discoverySequence, completeDiscovery, resetToMainView, advanceScene, flyToScene]);

  const handleBack = useCallback(() => {
    commitEngagement();
    const scenes = discoverySequence?.scenes ?? [];
    const prev = scenes[discoverySceneIndex - 1];
    resetToMainView();
    retreatScene();
    if (prev) flyToScene(prev, true);
  }, [commitEngagement, retreatScene, discoverySequence, discoverySceneIndex, resetToMainView, flyToScene]);

  const handleExit = useCallback(() => { commitEngagement(); exitDiscovery(); }, [commitEngagement, exitDiscovery]);

  const handleBegin = useCallback(() => {
    setShowPreview(false);
    sceneStartRef.current = Date.now();
    const first = discoverySequence?.scenes[0];
    if (first) flyToScene(first, true);
  }, [flyToScene, discoverySequence]);

  if (!discoveryActive || !discoverySequence || !discoverySequence.scenes.length) return null;



  const scenes = discoverySequence.scenes;
  const scene = scenes[discoverySceneIndex];
  if (!scene) return null;

  const isPrediction = scene.type === 'prediction';
  const isAnswered = answeredOptionId !== null;
  const isLastScene = discoverySceneIndex >= scenes.length - 1;
  const nextBlocked = isPrediction && !isAnswered;
  const progressPct = ((discoverySceneIndex + 1) / scenes.length) * 100;

  let nextLabel = isLastScene ? 'Finish' : 'Next →';
  if (isPrediction && isAnswered) {
    const chosen = scene.prediction?.options.find((o) => o.id === answeredOptionId);
    nextLabel = chosen?.isCorrect ? 'I see it →' : 'Got it →';
  }

  const primaryNode = allNodes.find((n) => n.id === scene.nodeIds[0]);
  const phaseName = phases.find((p) => p.nodeIds.includes(scene.nodeIds[0]))?.name;
  const predCount = scenes.filter((s) => s.type === 'prediction').length;

  // ── Transition screen — shown when discoveryPhase === 'transition' ──────────
  // discoveryPhase is set atomically by completeDiscovery() in a single store
  // write, so this is guaranteed to render in the same React commit as the
  // roleMap clear. Both buttons call exitDiscovery() as Phase 2/3 placeholders.
  if (discoveryPhase === 'transition') {
    return (
      <div className={styles.tabWrap}>
        <div className={styles.cinemaHeader}>
          <span className={styles.cinemaTitle}>🎬 Process Cinema</span>
          <button className={styles.exitTourBtn} onClick={exitDiscovery}>
            ✕ Exit Tour
          </button>
        </div>
        <div className={styles.tabBody}>
          <div className={styles.transitionCheck}>✓</div>
          <div className={styles.transitionHeadline}>You've seen the full story</div>
          <p className={styles.transitionDesc}>
            Would you like to test your memory of this process, or jump straight to the engagement summary?
          </p>
          <div className={styles.transitionActions}>
            {/* Phase 2 — Reconstruction entry point */}
            <button className={styles.transitionBtnPrimary} onClick={startReconstruction}>
              Test memory
            </button>
            {/* Phase 3 — Heatmap entry point: startHeatmap sets discoveryPhase to 'heatmap' */}
            <button className={styles.transitionBtnSecondary} onClick={startHeatmap}>
              Skip to summary
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Reconstruction ────────────────────────────────────────────────────────
  if (discoveryPhase === 'reconstruction') {
    const hintVisible = Object.values(reconstructionAccuracy).some((v) => v === false);
    const visibleChips = shuffledChips.filter((c) => reconstructionAccuracy[c.nodeId] !== true);

    return (
      <div className={styles.tabWrap}>
        <div className={styles.cinemaHeader}>
          <span className={styles.cinemaTitle}>🎬 Process Cinema</span>
          <button className={styles.exitTourBtn} onClick={exitDiscovery}>
            ✕ Exit Tour
          </button>
        </div>

        <div className={styles.tabBody}>
          {isReconstructionComplete ? (
            <>
              <div className={styles.reconstructionCheck}>✓</div>
              <div className={styles.reconstructionDone}>You rebuilt the graph from memory.</div>
              {isPerfectReconstruction && (
                <div className={styles.reconstructionPerfect}>Perfect reconstruction.</div>
              )}
            </>
          ) : (
            <>
              <div className={styles.reconstructionHeadline}>Reconstruct the graph</div>
              <p className={styles.reconstructionDesc}>
                Select a label chip below, then click the blank node where it belongs.
              </p>

              <div className={styles.reconstructionProgress}>
                <span className={styles.reconstructionProgressCount}>
                  {placedCount} of {reconstructionTotal} placed
                </span>
                <button className={styles.reconstructionSkip} onClick={() => completeReconstruction()}>
                  Skip →
                </button>
              </div>

              <div className={styles.reconstructionBar}>
                <div
                  className={styles.reconstructionBarFill}
                  style={{ width: `${reconstructionTotal > 0 ? (placedCount / reconstructionTotal) * 100 : 0}%` }}
                />
              </div>

              {hintVisible && (
                <div className={styles.reconstructionHint}>
                  Think about where this node sat in the process flow.
                </div>
              )}

              <div className={styles.reconstructionChips}>
                {visibleChips.map((chip) => (
                  <button
                    key={chip.nodeId}
                    className={[
                      styles.reconstructionChip,
                      selectedReconstructionChip === chip.nodeId ? styles.reconstructionChipSelected : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => selectReconstructionChip(
                      selectedReconstructionChip === chip.nodeId ? null : chip.nodeId
                    )}
                  >
                    {chip.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Heatmap — Phase 3 ────────────────────────────────────────────────────
  if (discoveryPhase === 'heatmap') {
    const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

    // Build structural role map: for each node, use the first non-prediction scene
    // it appears in as the primary role label. Prediction scenes are used only as fallback.
    const nodeRoleMap: Record<string, string> = {};
    if (discoverySequence) {
      for (const s of discoverySequence.scenes) {
        for (const id of s.nodeIds) {
          if (!(id in nodeRoleMap) || (nodeRoleMap[id] === TYPE_LABELS.prediction && s.type !== 'prediction')) {
            nodeRoleMap[id] = TYPE_LABELS[s.type];
          }
        }
      }
    }

    const coldNodes = Object.entries(heatTiers)
      .filter(([, tier]) => tier === 'cold' || tier === 'ice')
      .map(([id, tier]) => ({
        id,
        tier: tier as 'cold' | 'ice',
        name: nodeMap.get(id)?.name ?? id,
        role: nodeRoleMap[id] ?? '—',
      }));

    const sceneCount = discoverySequence?.scenes.length ?? 0;
    const bottleneckCount = discoverySequence?.scenes.filter((s) => s.type === 'bottleneck').length ?? 0;
    const wasSkipped = Object.keys(reconstructionAccuracy).length === 0;
    const correctCount = Object.values(reconstructionAccuracy).filter(Boolean).length;

    return (
      <div className={styles.tabWrap}>
        <div className={styles.cinemaHeader}>
          <span className={styles.cinemaTitle}>🎬 Process Cinema</span>
          <button className={styles.exitTourBtn} onClick={exitCinemaExperience}>
            ✕ Exit Tour
          </button>
        </div>

        <div className={styles.tabBody}>
          <div className={styles.heatmapHeadline}>Your attention map</div>
          <p className={styles.heatmapDesc}>
            This shows where your focus went — not a score, a mirror.
          </p>

          {/* Legend */}
          <div className={styles.heatmapLegend}>
            <div className={styles.heatmapLegendRow}>
              <span className={`${styles.heatmapSwatch} ${styles.heatmapSwatchHot}`} />
              <span className={styles.heatmapLegendLabel}><strong>Hot</strong> — deeply engaged, dwelled and clicked</span>
            </div>
            <div className={styles.heatmapLegendRow}>
              <span className={`${styles.heatmapSwatch} ${styles.heatmapSwatchWarm}`} />
              <span className={styles.heatmapLegendLabel}><strong>Warm</strong> — solid attention, at or above average</span>
            </div>
            <div className={styles.heatmapLegendRow}>
              <span className={`${styles.heatmapSwatch} ${styles.heatmapSwatchCold}`} />
              <span className={styles.heatmapLegendLabel}><strong>Cold</strong> — seen but not lingered on</span>
            </div>
            <div className={styles.heatmapLegendRow}>
              <span className={`${styles.heatmapSwatch} ${styles.heatmapSwatchIce}`} />
              <span className={styles.heatmapLegendLabel}><strong>Ice</strong> — barely registered</span>
            </div>
          </div>

          {/* Cold node list */}
          {coldNodes.length > 0 && (
            <div className={styles.heatmapColdSection}>
              <div className={styles.heatmapSectionTitle}>Nodes you barely touched</div>
              <div className={styles.heatmapColdList}>
                {coldNodes.map((n) => (
                  <div key={n.id} className={styles.heatmapColdRow}>
                    <span className={`${styles.heatmapTierDot} ${n.tier === 'ice' ? styles.heatmapTierDotIce : styles.heatmapTierDotCold}`} />
                    <span className={styles.heatmapColdName}>{n.name}</span>
                    <span className={styles.heatmapColdRole}>{n.role.toLowerCase()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stats strip */}
          <div className={styles.heatmapStats}>
            <div className={styles.heatmapStat}>
              <span className={styles.heatmapStatValue}>{sceneCount}</span>
              <span className={styles.heatmapStatLabel}>Scenes absorbed</span>
            </div>
            <div className={styles.heatmapStat}>
              <span className={styles.heatmapStatValue}>{bottleneckCount}</span>
              <span className={styles.heatmapStatLabel}>Bottlenecks found</span>
            </div>
            <div className={styles.heatmapStat}>
              <span className={styles.heatmapStatValue}>
                {wasSkipped ? 'skipped' : `${correctCount}/${discoveryVisited.length}`}
              </span>
              <span className={styles.heatmapStatLabel}>Rebuilt correctly</span>
            </div>
            <div className={styles.heatmapStat}>
              <span className={styles.heatmapStatValue}>{coldNodes.length}</span>
              <span className={styles.heatmapStatLabel}>Cold nodes</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  if (showPreview) {
    const mins = discoverySequence.estimatedMinutes;
    const minLabel = mins < 1 ? '< 1 min' : mins === 0.5 ? '~30 sec' : `~${mins} min`;

    return (
      <div className={styles.tabWrap}>
        {/* Sticky header */}
        <div className={styles.cinemaHeader}>
          <span className={styles.cinemaTitle}>🎬 Process Cinema</span>
          <button className={styles.exitTourBtn} onClick={handleExit}>
            ✕ Exit Tour
          </button>
        </div>

        {/* Preview body */}
        <div className={styles.tabBody}>
          <div className={styles.previewMeta}>
            <span className={styles.previewTime}>{minLabel}</span>
            <span className={styles.previewDot}>·</span>
            <span className={styles.previewStat}>{scenes.length} scene{scenes.length !== 1 ? 's' : ''}</span>
            {predCount > 0 && (
              <>
                <span className={styles.previewDot}>·</span>
                <span className={styles.previewStat}>{predCount} prediction{predCount !== 1 ? 's' : ''}</span>
              </>
            )}
          </div>
          <p className={styles.previewDesc}>
            This tour covers the key structural moments — origins, forks, bottlenecks, and outputs.
          </p>
          <div className={styles.previewActions}>
            <button className={styles.skipBtn} onClick={handleExit}>Skip</button>
            <button className={styles.beginBtn} onClick={handleBegin}>Begin →</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Active scene ───────────────────────────────────────────────────────────
  return (
    <div className={styles.tabWrap}>

      {/* Sticky header: breadcrumbs + Exit Tour */}
      <div className={styles.cinemaHeader}>
        <div className={styles.breadcrumbs}>
          {scenes.map((s, idx) => {
            const isCurrent = idx === discoverySceneIndex;
            const isDone = idx < discoverySceneIndex;
            return (
              <div
                key={idx}
                className={[
                  styles.crumb,
                  s.type === 'prediction' ? styles.crumbPrediction : '',
                  isCurrent ? styles.crumbActive : '',
                  isDone ? styles.crumbDone : '',
                ].filter(Boolean).join(' ')}
                title={`Scene ${idx + 1}: ${s.headline}`}
                onClick={isDone ? () => {
                  commitEngagement();
                  for (let i = 0; i < discoverySceneIndex - idx; i++) retreatScene();
                  flyToScene(scenes[idx]);
                } : undefined}
              />
            );
          })}
        </div>
        <span className={styles.sceneCounter}>{discoverySceneIndex + 1}/{scenes.length}</span>
        <button className={styles.exitTourBtn} onClick={handleExit}>
          ✕ Exit Tour
        </button>
      </div>

      {/* Scrollable scene body */}
      <div className={styles.tabBody}>

        {/* Act + type */}
        <div className={styles.sceneHeader}>
          <span className={styles.actBadge}>Act {scene.act}</span>
          <span className={`${styles.typePill} ${TYPE_PILL_CLASS[scene.type]}`}>
            {TYPE_LABELS[scene.type]}
          </span>
        </div>

        {/* Headline */}
        <div className={styles.headline}>{scene.headline}</div>

        {/* Facts */}
        {scene.nodeIds.length === 1 && primaryNode && (
          <div className={styles.factsRow}>
            <span className={styles.fact}><strong>Owner:</strong> {primaryNode.owner}</span>
            {phaseName && <span className={styles.fact}><strong>Phase:</strong> {phaseName}</span>}
          </div>
        )}

        {/* Body */}
        {!isPrediction && <div className={styles.body}>{scene.body}</div>}

        {/* Prediction */}
        {isPrediction && scene.prediction && (
          <>
            <div className={styles.predQuestion}>{scene.prediction.question}</div>
            <div className={styles.predOptions}>
              {scene.prediction.options.map((opt) => {
                const chosen = answeredOptionId === opt.id;
                return (
                  <div key={opt.id}>
                    <button
                      className={[
                        styles.predOption,
                        isAnswered ? styles.predOptionLocked : '',
                        isAnswered && opt.isCorrect ? styles.predOptionCorrect : '',
                        isAnswered && chosen && !opt.isCorrect ? styles.predOptionWrong : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => { if (!isAnswered) setAnsweredOptionId(opt.id); }}
                    >
                      {opt.text}
                    </button>
                    {isAnswered && chosen && (
                      <div className={styles.predFeedback}>{opt.feedback}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Insight */}
        {scene.insight && !isPrediction && (
          <div className={`${styles.insight} ${scene.type === 'bottleneck' ? styles.insightDanger : ''}`}>
            {scene.insight}
          </div>
        )}

        {/* Smart-fly toggle */}
        <div className={styles.flyToggleRow}>
          <label className={styles.flyToggleLabel}>
            <input
              type="checkbox"
              checked={smartFly}
              onChange={(e) => setSmartFly(e.target.checked)}
              className={styles.flyToggleCheck}
            />
            Skip pan if node is visible
          </label>
        </div>

        {/* Nav controls — inside scroll area, always at bottom of content */}
        <div className={styles.navBar}>
          <button className={styles.navBtn} onClick={handleBack} disabled={discoverySceneIndex === 0}>
            ← Back
          </button>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
          </div>
          <span className={styles.timeLeft}>{timeRemainingLabel(scenes, discoverySceneIndex)}</span>
          <button
            className={`${styles.navBtn} ${styles.navBtnNext}`}
            onClick={handleNext}
            disabled={nextBlocked}
          >
            {nextLabel}
          </button>
        </div>

      </div>
    </div>
  );
}
