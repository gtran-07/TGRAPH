/**
 * components/Canvas/Canvas.tsx — The main SVG canvas where the graph is rendered.
 *
 * Responsibilities:
 *   - Renders the SVG element with pan/zoom transform applied to a root <g> element
 *   - Hosts EdgeLayer, NodeLayer, LaneLayer, MiniMap, zoom controls, banners
 *   - Handles canvas-level mouse events: pan, scroll-to-zoom, click-on-background
 *   - Shows the empty state when no data is loaded
 *   - Shows the Design Mode banner when design mode is active
 *   - Shows the Focus Mode banner when focus mode is active
 *
 * What does NOT belong here: individual node rendering (NodeCard), edge path calculation (layout.ts).
 */

import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useGraphStore } from '../../store/graphStore';
import type { Transform } from '../../types/graph';
import { NodeCard } from './NodeCard';
import { GroupCard } from './GroupCard';
import { EdgeLayer } from './EdgeLayer';
import { LaneLayer } from './LaneLayer';
import { MiniMap } from './MiniMap';
import { GhostEdge } from './GhostEdge';
import { PhaseLayer } from './PhaseLayer';
import { PhaseNavigator } from './PhaseNavigator';
import { PhaseCrowns } from './PhaseCrowns';
import { LaneCrowns } from './LaneCrowns';
import { PhaseHoverCard } from './PhaseHoverCard';
import type { CrownBand } from './PhaseCrowns';
import { NODE_W, LANE_LABEL_W, computePhaseAdjustedPositions } from '../../utils/layout';
import { DesignToolbar } from '../DesignMode/DesignToolbar';
import {
  computeGroupNestLevel,
  getAllDescendantNodeIds,
  getHiddenGroupIds,
  getCollapsedGroupForNode,
} from '../../utils/grouping';
import styles from './Canvas.module.css';

export function Canvas() {
  const {
    visibleNodes, visibleEdges, positions, transform,
    setTransform, saveLayoutToCache,
    focusMode, focusNodeId, exitFocusMode,
    designMode, designTool, connectSourceId, setConnectSource,
    addEdge, addNode, setSelectedNode,
    allNodes, allEdges, ownerColors, laneMetrics, viewMode,
    enterFocusMode, hoveredNodeId, fitToScreen, clearGraph,
    groups, toggleGroupCollapse, clearMultiSelect,
    phases, focusedPhaseId, selectedPhaseId, setFocusedPhaseId, setSelectedPhaseId,
    collapsedPhaseIds, togglePhaseCollapse, collapseAllPhases, expandAllPhases,
  } = useGraphStore();


  // ── Refs ──────────────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // ── Canvas height (SVG user-space) for PhaseLayer band height ─────────
  // We track the canvas pixel height and divide by the current zoom scale
  // so bands always span the full visible canvas regardless of zoom level.
  const [canvasPixelHeight, setCanvasPixelHeight] = useState(600);
  const [canvasPixelWidth, setCanvasPixelWidth] = useState(1200);
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setCanvasPixelHeight(rect.height);
        setCanvasPixelWidth(rect.width);
      }
    });
    obs.observe(el);
    const rect = el.getBoundingClientRect();
    setCanvasPixelHeight(rect.height);
    setCanvasPixelWidth(rect.width);
    return () => obs.disconnect();
  }, []);
  // Convert pixel height to SVG-space height accounting for pan offset
  const svgBandHeight = canvasPixelHeight / Math.max(transform.k, 0.01) + Math.abs(transform.y / Math.max(transform.k, 0.01)) + 200;

  // ── Nodes hidden by collapsed phases (works in all view modes) ──────────
  // Computed separately from position adjustment so it's always reliable.
  const hiddenNodeIds = useMemo(() => {
    if (collapsedPhaseIds.length === 0) return new Set<string>();
    const collapsedSet = new Set(collapsedPhaseIds);
    const hidden = new Set<string>();
    phases.forEach((ph) => {
      if (collapsedSet.has(ph.id)) ph.nodeIds.forEach((nid) => hidden.add(nid));
    });
    return hidden;
  }, [phases, collapsedPhaseIds]);

  // ── Phase-adjusted positions (visual x-shift for collapsed bands, dag only) ─
  // Nodes to the right of a collapsed band shift left to fill freed space.
  // Stored positions are never mutated.
  const adjustedPositions = useMemo(() => {
    if (collapsedPhaseIds.length === 0) return positions;
    return computePhaseAdjustedPositions(phases, positions, collapsedPhaseIds, NODE_W, viewMode === 'lanes' ? LANE_LABEL_W : undefined).adjustedPositions;
  }, [phases, positions, collapsedPhaseIds, viewMode]);

  // ── Phase crown bands + viewport-presence set ─────────────────────────
  // Derived from phases + positions + transform. No store state needed.
  const PHASE_PAD_X_C = 30; // matches PhaseLayer constant
  const PHASE_HEADER_H = 48; // matches PhaseLayer HEADER_H
  const PHASE_PAD_Y_C  = 20; // matches PhaseLayer PHASE_PAD_Y
  const { crownBands, inViewportPhaseIds, globalBandTop } = useMemo(() => {
    const sorted = [...phases].sort((a, b) => a.sequence - b.sequence);
    const bands: CrownBand[] = [];
    const inViewport = new Set<string>();
    const { x: tx, y: _ty, k } = transform;
    const allBandMinYs: number[] = [];

    // Viewport rectangle in SVG space
    const vpLeft  = -tx / k;
    const vpRight = (canvasPixelWidth - tx) / k;
    const vpTop   = -transform.y / k;
    const vpBottom = (canvasPixelHeight - transform.y) / k;

    sorted.forEach((phase, idx) => {
      const nodePositions = phase.nodeIds
        .map((nid) => adjustedPositions[nid])
        .filter((p): p is { x: number; y: number } => !!p);
      const groupPositions = (phase.groupIds ?? [])
        .map((gid) => adjustedPositions[gid])
        .filter((p): p is { x: number; y: number } => !!p);
      const assignedPositions = [...nodePositions, ...groupPositions];
      if (assignedPositions.length === 0) return;

      const minX = Math.min(...assignedPositions.map((p) => p.x)) - PHASE_PAD_X_C;
      const maxX = Math.max(...assignedPositions.map((p) => p.x + NODE_W)) + PHASE_PAD_X_C;
      bands.push({ phase, idx: idx + 1, minX, maxX });

      const minY = Math.min(...assignedPositions.map((p) => p.y));
      allBandMinYs.push(minY);

      // Check if any member of this phase is inside the viewport
      const hasNodeInView = assignedPositions.some((p) => {
        return p.x + NODE_W > vpLeft && p.x < vpRight &&
               p.y > vpTop - 200 && p.y < vpBottom + 200;
      });
      if (hasNodeInView) inViewport.add(phase.id);
    });

    // globalBandTop mirrors PhaseLayer's calculation: the shared header top for all bands.
    const gbt = allBandMinYs.length > 0
      ? Math.min(...allBandMinYs) - PHASE_HEADER_H - PHASE_PAD_Y_C
      : 0;

    return { crownBands: bands, inViewportPhaseIds: inViewport, globalBandTop: gbt };
  }, [phases, adjustedPositions, transform, canvasPixelWidth, canvasPixelHeight]);

  // ── Pan state (local — doesn't need to be in global store) ────────────
  const panState = useRef<{ startX: number; startY: number; startTX: number; startTY: number } | null>(null);

  // ── Ghost edge mouse position (for drawing connections) ───────────────
  const [ghostTarget, setGhostTarget] = useState<{ x: number; y: number } | null>(null);

  // ── Collapsed phase hover card ─────────────────────────────────────────
  const [collapsedPhaseHover, setCollapsedPhaseHover] = useState<{
    phaseId: string;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [collapsedPhaseHiding, setCollapsedPhaseHiding] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasData = visibleNodes.length > 0 || allNodes.length > 0;

  // ── Cross-group boundary edges ────────────────────────────────────────
  // visibleEdges only contains edges where BOTH endpoints are visible nodes.
  // When a node is inside a collapsed group its edges to/from outside nodes
  // are dropped. We restore them here so they can be routed to the group proxy.
  const displayEdges = useMemo(() => {
    const hasCollapsed = groups.some((g) => g.collapsed);
    if (!hasCollapsed) return visibleEdges;

    // Build a node→outermost-collapsed-group map using the fixed getCollapsedGroupForNode
    // so nested groups are handled correctly (outermost wins).
    const nodeToGroup = new Map<string, string>();
    const allNodeIds = new Set(allEdges.flatMap((e) => [e.from, e.to]));
    allNodeIds.forEach((nid) => {
      const outermost = getCollapsedGroupForNode(nid, groups);
      if (outermost) nodeToGroup.set(nid, outermost.id);
    });

    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    const included = new Set(visibleEdges.map((e) => `${e.from}|${e.to}`));
    const extra: typeof visibleEdges = [];
    const extraKeys = new Set<string>();

    for (const edge of allEdges) {
      if (included.has(`${edge.from}|${edge.to}`)) continue;
      const fromGroup = nodeToGroup.get(edge.from);
      const toGroup   = nodeToGroup.get(edge.to);
      const fromVis   = visibleNodeIds.has(edge.from);
      const toVis     = visibleNodeIds.has(edge.to);
      const key = `${edge.from}|${edge.to}`;
      if (extraKeys.has(key)) continue;
      // Cross-boundary: one side visible node, other inside a collapsed group
      if ((fromVis && toGroup) || (toVis && fromGroup)) {
        extra.push(edge);
        extraKeys.add(key);
      // Both endpoints inside DIFFERENT collapsed groups
      } else if (fromGroup && toGroup && fromGroup !== toGroup) {
        extra.push(edge);
        extraKeys.add(key);
      }
    }

    return extra.length > 0 ? [...visibleEdges, ...extra] : visibleEdges;
  }, [visibleEdges, visibleNodes, allEdges, groups]);

  // ── Filter edges and groups hidden by collapsed phases ────────────────
  // Nodes inside collapsed phases are already skipped at render time via hiddenNodeIds.
  // Edges touching those nodes must also be removed (no proxy polygon to route them to).
  // Groups whose every descendant node is phase-hidden are suppressed entirely.
  const phaseFilteredEdges = useMemo(() => {
    if (hiddenNodeIds.size === 0) return displayEdges;
    return displayEdges.filter((e) => !hiddenNodeIds.has(e.from) && !hiddenNodeIds.has(e.to));
  }, [displayEdges, hiddenNodeIds]);

  const phaseHiddenGroupIds = useMemo(() => {
    if (hiddenNodeIds.size === 0) return new Set<string>();
    const hidden = new Set<string>();
    for (const group of groups) {
      const descendants = getAllDescendantNodeIds(group.id, groups);
      if (descendants.length > 0 && descendants.every((id) => hiddenNodeIds.has(id))) {
        hidden.add(group.id);
      }
    }
    return hidden;
  }, [groups, hiddenNodeIds]);

  const focusedNode = focusNodeId ? allNodes.find((n) => n.id === focusNodeId) : null;

  // ── Convert screen coordinates to SVG canvas coordinates ─────────────
  // Reads transformRef (not transform state) so this callback is stable and
  // never changes reference. A changing reference would re-render every NodeCard
  // and GroupCard on every zoom tick, causing the CSS transform transition to
  // fire on all nodes simultaneously — visible as flashing boxes during zoom.
  const screenToSvg = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const t = transformRef.current;
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k,
    };
  }, []); // stable — reads transformRef at call-time, no deps needed

  // ── Pan: start on mousedown on SVG background ─────────────────────────
  function handleSvgMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    // Only start panning if clicking directly on the SVG or graph root (not a node)
    const target = e.target as Element;
    if (target.closest('.node-group') || target.closest('.edge-hit') || target.closest('.group-overlay')) return;
    if (designMode && designTool === 'add') return; // Add tool uses click, not drag

    panState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTX: transform.x,
      startTY: transform.y,
    };
  }

  // ── Pan: update on mousemove ──────────────────────────────────────────
  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    // Update ghost edge target if connecting
    if (designMode && designTool === 'connect' && connectSourceId) {
      const pt = screenToSvg(e.clientX, e.clientY);
      setGhostTarget(pt);
    }

    if (!panState.current) return;
    const dx = e.clientX - panState.current.startX;
    const dy = e.clientY - panState.current.startY;
    setTransform({
      ...transform,
      x: panState.current.startTX + dx,
      y: panState.current.startTY + dy,
    });
  }

  // ── Pan: end on mouseup ───────────────────────────────────────────────
  function handleSvgMouseUp() {
    if (panState.current) {
      panState.current = null;
      saveLayoutToCache(); // Persist the new pan position
    }
  }

  const handleGroupToggle = useCallback((groupId: string) => {
    toggleGroupCollapse(groupId);
  }, [toggleGroupCollapse]);

  // ── Scroll to zoom (centered on cursor position) ──────────────────────
  // React 18 attaches onWheel as a PASSIVE listener, which means
  // e.preventDefault() is silently ignored and the browser may scroll the
  // page instead of zooming the canvas. The fix is to attach a native
  // (non-passive) wheel listener via useEffect.
  //
  // We store the current transform in a ref so the event handler always
  // reads the latest value without needing to re-register itself on every
  // zoom step (which would cause jank from rapid add/remove cycles).
  const transformRef = useRef<Transform>(transform);
  useEffect(() => { transformRef.current = transform; }, [transform]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = svgEl!.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const t = transformRef.current;
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      const newScale = Math.max(0.1, Math.min(3, t.k * delta));
      const newX = cursorX - (cursorX - t.x) * (newScale / t.k);
      const newY = cursorY - (cursorY - t.y) * (newScale / t.k);
      setTransform({ x: newX, y: newY, k: newScale });
    }

    svgEl.addEventListener('wheel', onWheel, { passive: false });
    return () => svgEl.removeEventListener('wheel', onWheel);
  // setTransform is stable (Zustand action), so this effect runs once only.
  }, [setTransform]);

  // ── Click on SVG background ───────────────────────────────────────────
  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    const target = e.target as Element;
    const clickedNode = target.closest('.node-group');
    const clickedEdge = target.closest('.edge-hit');
    const clickedGroup = target.closest('.group-overlay');

    if (designMode && designTool === 'add' && !clickedNode && !clickedGroup) {
      // Add mode: open the add-node modal at the click position
      const pt = screenToSvg(e.clientX, e.clientY);
      document.dispatchEvent(new CustomEvent('flowgraph:add-node', { detail: pt }));
      return;
    }

    if (designMode && designTool === 'connect') {
      if (!clickedNode && !clickedEdge && !clickedGroup) {
        // Clicked empty space in connect mode — cancel the connection
        setConnectSource(null);
        setGhostTarget(null);
      }
      return;
    }

    // Click on background or phase — deselect nodes/groups and clear multi-select.
    // Clicking a phase should still deselect nodes/groups; the phase click handler
    // selects the phase separately via onPhaseClick.
    const clickedPhase = target.closest('[data-phase-id]');
    if (!clickedNode && !clickedGroup) {
      setSelectedNode(null);
      clearMultiSelect();
      if (!clickedPhase) {
        setSelectedPhaseId(null);
      }
    }
  }

  // ── Double-click on SVG background — exit focus mode ─────────────────
  function handleSvgDblClick(e: React.MouseEvent<SVGSVGElement>) {
    const target = e.target as Element;
    if (target.closest('.node-group')) return; // Node dblclick handled in NodeCard
    if (target.closest('.group-overlay')) return; // Group dblclick handled in GroupCard
    if (focusMode) exitFocusMode();
  }

  // ── Keyboard: Escape cancels connect mode or exits focus ──────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (connectSourceId) {
          setConnectSource(null);
          setGhostTarget(null);
        } else if (focusMode) {
          exitFocusMode();
        }
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [connectSourceId, focusMode, exitFocusMode, setConnectSource]);

  // ── Hover highlight via direct DOM class manipulation ────────────────
  // Positive-only: only the hovered node and its direct neighbors get visual
  // treatment (.hovered / .neighbor classes). Non-hovered nodes are untouched.
  //
  // We deliberately do NOT dim non-hovered nodes. Any CSS change (opacity, fill,
  // stroke) applied to ~140 leaf elements simultaneously invalidates paint tiles
  // across the whole canvas. At high zoom those tiles are large and Chrome can't
  // repaint them all in one frame — visible as grey/white box flicker everywhere.
  useEffect(() => {
    const graphRoot = document.getElementById('graph-root');
    if (!graphRoot) return;

    // Clear all highlight classes whenever hovered target changes
    graphRoot.querySelectorAll('.hovered, .neighbor').forEach((el) => {
      el.classList.remove('hovered', 'neighbor');
    });

    if (!hoveredNodeId) return;

    // Determine neighbors — works for both node IDs and group IDs.
    // Use allEdges (not visibleEdges) so edges into/out of collapsed groups are included.
    // When a neighbor is inside a collapsed group, resolve to that group's ID instead.
    const hovGroup = groups.find((g) => g.id === hoveredNodeId);
    const directParents = new Set<string>();
    const directChildren = new Set<string>();

    function resolveToVisible(nodeId: string): string {
      const collapsed = getCollapsedGroupForNode(nodeId, groups);
      return collapsed ? collapsed.id : nodeId;
    }

    if (hovGroup) {
      const descendantIds = new Set(getAllDescendantNodeIds(hovGroup.id, groups));
      for (const edge of allEdges) {
        const fromIn = descendantIds.has(edge.from);
        const toIn   = descendantIds.has(edge.to);
        if (fromIn && !toIn)  directChildren.add(resolveToVisible(edge.to));
        if (toIn   && !fromIn) directParents.add(resolveToVisible(edge.from));
      }
    } else {
      const hovNode = allNodes.find((n) => n.id === hoveredNodeId);
      (hovNode?.dependencies ?? []).forEach((id) => directParents.add(resolveToVisible(id)));
      allEdges
        .filter((e) => e.from === hoveredNodeId)
        .forEach((e) => directChildren.add(resolveToVisible(e.to)));
    }

    // Apply .hovered / .neighbor — only to the handful of relevant elements
    graphRoot.querySelectorAll('.node-group, .group-overlay').forEach((el) => {
      const id = el.getAttribute('data-id') ?? el.getAttribute('data-group-id');
      if (id === hoveredNodeId) {
        el.classList.add('hovered');
      } else if (id && (directParents.has(id) || directChildren.has(id))) {
        el.classList.add('neighbor');
      }
    });
  }, [hoveredNodeId, allNodes, visibleEdges, groups]);

  // ── Stable focus-request handler (prevents NodeCard memo invalidation) ─
  const handleFocusRequest = useCallback((id: string) => {
    if (!designMode) {
      enterFocusMode(id);
      setTimeout(() => fitToScreen(), 50);
    }
  }, [designMode, enterFocusMode, fitToScreen]);

  // ── Collapsed phase hover card handlers ───────────────────────────────
  const handleCollapsedHover = useCallback((phaseId: string, cx: number, cy: number) => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setCollapsedPhaseHiding(false);
    setCollapsedPhaseHover({ phaseId, clientX: cx, clientY: cy });
  }, []);

  const handleCollapsedHoverEnd = useCallback(() => {
    setCollapsedPhaseHiding(true);
    hideTimerRef.current = setTimeout(() => {
      setCollapsedPhaseHover(null);
      setCollapsedPhaseHiding(false);
    }, 150);
  }, []);

  // ── Cursor style based on active tool ─────────────────────────────────
  const canvasCursor = designMode && designTool === 'add'
    ? 'cell'
    : designMode && designTool === 'connect'
      ? 'crosshair'
      : panState.current ? 'grabbing' : 'grab';

  return (
    <div
      id="canvas-wrap"
      ref={canvasWrapRef}
      className={`${styles.canvasWrap} ${designMode ? styles.designModeActive : ''}`}
    >
      {/* Empty state — shown when no JSON has been loaded yet */}
      {!hasData && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>⬡</div>
          <div className={styles.emptyTitle}>FlowGraph</div>
          <div className={styles.emptySub}>Visualize and edit dependency graphs</div>
          <div className={styles.emptyActions}>
            <button
              className={styles.emptyActionBtn}
              onClick={() => document.dispatchEvent(new CustomEvent('flowgraph:open-file-picker'))}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span className={styles.emptyActionLabel}>Open JSON File</span>
              <span className={styles.emptyActionHint}>Open an existing flowchart</span>
            </button>
            <div className={styles.emptyOr}>or</div>
            <button
              className={`${styles.emptyActionBtn} ${styles.emptyActionBtnDesign}`}
              onClick={() => clearGraph()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span className={styles.emptyActionLabel}>New Flowchart</span>
              <span className={styles.emptyActionHint}>Start from scratch in design mode</span>
            </button>
          </div>
          <div className={styles.emptyFootnote}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Chrome / Edge: opening a file links it — Save writes back to your file directly, no download needed.
            Other browsers: Save downloads a copy.
          </div>
          <div className={styles.emptyCredit}>
            Built with Claude Code · Authored by Giang Tran
          </div>
        </div>
      )}

      {/* Main SVG canvas */}
      <svg
        ref={svgRef}
        className={styles.svgCanvas}
        style={{ cursor: canvasCursor }}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onMouseLeave={handleSvgMouseUp}
        onClick={handleSvgClick}
        onDoubleClick={handleSvgDblClick}
      >
        <defs>
          {/* Default arrowhead marker for edges */}
          <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#2e3850" />
          </marker>
          {/* Highlighted arrowhead — blue, for hovered connected edges */}
          <marker id="arrow-highlight" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#4f9eff" />
          </marker>
          {/*
            Dynamic color arrowhead — inherits currentColor from the edge stroke.
            Used when hovering so the arrowhead matches the owner color of the source node.
          */}
          <marker id="arrow-dyn" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="currentColor" />
          </marker>
          {/* Design mode ghost edge arrowhead — purple dashed */}
          <marker id="arrow-ghost" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#a78bfa" />
          </marker>
        </defs>

        {/* Graph root — all pan/zoom transform is applied here */}
        <g id="graph-root" transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* Layer order: lanes background → edges → nodes (nodes always on top) */}
          {/* key causes React to remount when view/focus changes, replaying the CSS fade-in */}
          <g key={`${viewMode}-${focusMode ? focusNodeId : 'normal'}`} id="graph-content">
          {/* Phase bands — fills + borders only, rendered first behind everything */}
          <g id="phase-layer">
            <PhaseLayer
              phases={phases}
              nodes={visibleNodes}
              groups={groups}
              positions={adjustedPositions}
              focusedPhaseId={focusedPhaseId}
              selectedPhaseId={selectedPhaseId}
              canvasHeight={svgBandHeight}
              collapsedPhaseIds={collapsedPhaseIds}
              viewMode={viewMode}
              designMode={designMode}
              screenToSvg={screenToSvg}
              onPhaseClick={(id) => setSelectedPhaseId(id)}
              onPhaseDoubleClick={(id) => togglePhaseCollapse(id)}
              onToggleCollapse={togglePhaseCollapse}
              onCollapsedHover={handleCollapsedHover}
              onCollapsedHoverEnd={handleCollapsedHoverEnd}
              renderPart="background"
              transform={transform}
              canvasPixelHeight={canvasPixelHeight}
            />
          </g>
          <g id="lanes-layer">
            <LaneLayer
              nodes={visibleNodes}
              positions={adjustedPositions}
              laneMetrics={laneMetrics}
              ownerColors={ownerColors}
              viewMode={viewMode}
            />
          </g>

          {/* Expanded group overlays — drawn below edges so they appear as background.
              Sorted outer-first (highest nestLevel) so inner groups render last = on top,
              ensuring inner groups capture clicks before outer group overlays do. */}
          <g id="groups-expanded-layer">
            {(() => {
              const hiddenGroupIds = getHiddenGroupIds(groups);
              return groups
                .filter((g) => !g.collapsed && !hiddenGroupIds.has(g.id) && !phaseHiddenGroupIds.has(g.id))
                .sort((a, b) => computeGroupNestLevel(b.id, groups) - computeGroupNestLevel(a.id, groups));
            })().map((group) => {
              const childNodePositions = getAllDescendantNodeIds(group.id, groups)
                .map((nid) => adjustedPositions[nid])
                .filter(Boolean) as { x: number; y: number }[];
              const groupColor = ownerColors[group.owners[0]] ?? '#4f9eff';
              const nestLevel = computeGroupNestLevel(group.id, groups);
              const pos = adjustedPositions[group.id] ?? { x: 0, y: 0 };
              return (
                <GroupCard
                  key={group.id}
                  group={group}
                  position={pos}
                  color={groupColor}
                  childPositions={childNodePositions}
                  screenToSvg={screenToSvg}
                  nestLevel={nestLevel}
                  onToggleCollapse={handleGroupToggle}
                  laneMetrics={laneMetrics}
                  viewMode={viewMode}
                />
              );
            })}
          </g>

          <g id="edges-layer">
            <EdgeLayer
              edges={phaseFilteredEdges}
              positions={adjustedPositions}
              designMode={designMode}
              ownerColors={ownerColors}
              nodes={visibleNodes}
              groups={groups}
            />
            {/* Ghost edge shown while drawing a connection in design mode */}
            {designMode && connectSourceId && ghostTarget && (
              <GhostEdge
                sourcePosition={adjustedPositions[connectSourceId]}
                targetPoint={ghostTarget}
              />
            )}
          </g>
          <g id="nodes-layer">
            {visibleNodes.filter((node) => !hiddenNodeIds.has(node.id)).map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                position={adjustedPositions[node.id] ?? { x: 0, y: 0 }}
                color={ownerColors[node.owner] ?? '#4f9eff'}
                screenToSvg={screenToSvg}
                onFocusRequest={handleFocusRequest}
              />
            ))}
          </g>

          {/* Collapsed group polygons — drawn above nodes */}
          <g id="groups-collapsed-layer">
            {(() => {
              const hiddenGroupIds = getHiddenGroupIds(groups);
              return groups.filter((g) => g.collapsed && !hiddenGroupIds.has(g.id) && !phaseHiddenGroupIds.has(g.id));
            })().map((group) => {
              const groupColor = ownerColors[group.owners[0]] ?? '#4f9eff';
              const nestLevel = computeGroupNestLevel(group.id, groups);
              const pos = adjustedPositions[group.id] ?? { x: 0, y: 0 };
              return (
                <GroupCard
                  key={group.id}
                  group={group}
                  position={pos}
                  color={groupColor}
                  childPositions={[]}
                  screenToSvg={screenToSvg}
                  nestLevel={nestLevel}
                  onToggleCollapse={handleGroupToggle}
                  laneMetrics={laneMetrics}
                  viewMode={viewMode}
                />
              );
            })}
          </g>

          </g>{/* end graph-content */}
        </g>

        {/* Phase header strips — rendered as a sibling to #graph-root so they always
            paint above node compositing layers (will-change:opacity promotes NodeCards
            to GPU layers; anything inside #graph-root that isn't also promoted gets
            drawn into the background layer and covered). Applying the same transform
            keeps coordinates identical. */}
        <g
          id="phase-headers-overlay"
          transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
          style={{ willChange: 'transform' }}
        >
          <PhaseLayer
            phases={phases}
            nodes={visibleNodes}
            groups={groups}
            positions={adjustedPositions}
            focusedPhaseId={focusedPhaseId}
            selectedPhaseId={selectedPhaseId}
            canvasHeight={svgBandHeight}
            collapsedPhaseIds={collapsedPhaseIds}
            viewMode={viewMode}
            designMode={designMode}
            screenToSvg={screenToSvg}
            onPhaseClick={(id) => setSelectedPhaseId(id)}
            onPhaseDoubleClick={(id) => togglePhaseCollapse(id)}
            onToggleCollapse={togglePhaseCollapse}
            onCollapsedHover={(phaseId, cx, cy) => setCollapsedPhaseHover({ phaseId, clientX: cx, clientY: cy })}
            onCollapsedHoverEnd={() => setCollapsedPhaseHover(null)}
            renderPart="headers"
            transform={transform}
            canvasPixelHeight={canvasPixelHeight}
          />
        </g>
      </svg>

      {/* Design mode toolbar banner */}
      {designMode && <DesignToolbar />}

      {/* Focus mode banner */}
      {focusMode && focusedNode && (
        <div className={styles.focusBanner}>
          <span className={styles.focusBannerIcon}>🎯</span>
          <span className={styles.focusBannerText}>
            Focus: <strong>{focusedNode.name}</strong>
          </span>
          <span className={styles.focusBannerHint}>Esc or double-click background to exit</span>
          <button className={styles.focusBannerClose} onClick={exitFocusMode}>✕</button>
        </div>
      )}

      {/* Phase Crowns — sticky context bars at top edge when headers scroll out of view. */}
      {hasData && phases.length > 0 && (
        <PhaseCrowns
          bands={crownBands}
          transform={transform}
          canvasWidth={canvasPixelWidth}
          globalBandTop={globalBandTop}
        />
      )}

      {/* Lane Crowns — sticky owner labels on the left edge when lane labels scroll off-screen.
          Shown in lanes mode whenever the user pans right or zooms in past x=0. */}
      {hasData && viewMode === 'lanes' && (
        <LaneCrowns
          nodes={visibleNodes}
          laneMetrics={laneMetrics}
          ownerColors={ownerColors}
          transform={transform}
          canvasHeight={canvasPixelHeight}
        />
      )}

      {/* Phase Navigator — floating pill bar */}
      {hasData && (
        <PhaseNavigator
          phases={phases}
          focusedPhaseId={focusedPhaseId}
          designMode={designMode}
          inViewportPhaseIds={inViewportPhaseIds}
          collapsedPhaseIds={collapsedPhaseIds}
          onFocusPhase={setFocusedPhaseId}
          onCreatePhase={() => document.dispatchEvent(new CustomEvent('flowgraph:create-phase', { detail: {} }))}
          onToggleCollapse={togglePhaseCollapse}
          onCollapseAll={collapseAllPhases}
          onExpandAll={expandAllPhases}
        />
      )}

      {/* Collapsed phase hover card — shown while hovered or animating out */}
      {collapsedPhaseHover && canvasWrapRef.current && (collapsedPhaseIds.includes(collapsedPhaseHover.phaseId) || collapsedPhaseHiding) && (() => {
        const ph = phases.find((p) => p.id === collapsedPhaseHover.phaseId);
        if (!ph) return null;
        return (
          <PhaseHoverCard
            phase={ph}
            allNodes={allNodes}
            groups={groups}
            clientX={collapsedPhaseHover.clientX}
            clientY={collapsedPhaseHover.clientY}
            canvasRect={canvasWrapRef.current.getBoundingClientRect()}
            isHiding={collapsedPhaseHiding || !collapsedPhaseIds.includes(collapsedPhaseHover.phaseId)}
            onExpand={() => togglePhaseCollapse(collapsedPhaseHover.phaseId)}
          />
        );
      })()}

      {/* Minimap — bottom right corner overview */}
      <MiniMap
        nodes={visibleNodes.filter((n) => !hiddenNodeIds.has(n.id))}
        positions={adjustedPositions}
        transform={transform}
        ownerColors={ownerColors}
        canvasRef={canvasWrapRef}
      />

      {/* Zoom controls — bottom center */}
      <div className={styles.zoomControls}>
        <button
          className={styles.zoomBtn}
          onClick={() => {
            const newK = Math.min(3, transform.k * 1.2);
            const canvas = document.getElementById('canvas-wrap');
            if (!canvas) return;
            const { width: w, height: h } = canvas.getBoundingClientRect();
            setTransform({ x: w/2 - (w/2 - transform.x) * (newK/transform.k), y: h/2 - (h/2 - transform.y) * (newK/transform.k), k: newK });
          }}
          title="Zoom in"
        >+</button>
        <div className={styles.zoomLabel}>{Math.round(transform.k * 100)}%</div>
        <button
          className={styles.zoomBtn}
          onClick={() => {
            const newK = Math.max(0.1, transform.k * 0.83);
            const canvas = document.getElementById('canvas-wrap');
            if (!canvas) return;
            const { width: w, height: h } = canvas.getBoundingClientRect();
            setTransform({ x: w/2 - (w/2 - transform.x) * (newK/transform.k), y: h/2 - (h/2 - transform.y) * (newK/transform.k), k: newK });
          }}
          title="Zoom out"
        >−</button>
      </div>

      {/* Edge delete tooltip — shown when hovering an edge in design mode */}
      <div id="edge-delete-tip" className={styles.edgeDeleteTip} style={{ display: 'none' }}>
        🗑 Click to delete connection
      </div>

      {/* Persistent attribution — bottom-left corner */}
      <div className={styles.credit}>
        Built with Claude Code · Authored by Giang Tran
      </div>
    </div>
  );
}
