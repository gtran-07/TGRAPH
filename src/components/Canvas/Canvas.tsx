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
import { EdgeLayer } from './EdgeLayer';
import { LaneLayer } from './LaneLayer';
import { MiniMap } from './MiniMap';
import { GhostEdge } from './GhostEdge';
import { DesignToolbar } from '../DesignMode/DesignToolbar';
import styles from './Canvas.module.css';

export function Canvas() {
  const {
    visibleNodes, visibleEdges, positions, transform,
    setTransform, saveLayoutToCache,
    focusMode, focusNodeId, exitFocusMode,
    designMode, designTool, connectSourceId, setConnectSource,
    addEdge, addNode, setSelectedNode,
    allNodes, ownerColors, laneMetrics, viewMode,
    enterFocusMode, hoveredNodeId, fitToScreen, clearGraph,
  } = useGraphStore();

  // ── Refs ──────────────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // ── Pan state (local — doesn't need to be in global store) ────────────
  const panState = useRef<{ startX: number; startY: number; startTX: number; startTY: number } | null>(null);

  // ── Ghost edge mouse position (for drawing connections) ───────────────
  const [ghostTarget, setGhostTarget] = useState<{ x: number; y: number } | null>(null);

  const hasData = visibleNodes.length > 0 || allNodes.length > 0;
  const focusedNode = focusNodeId ? allNodes.find((n) => n.id === focusNodeId) : null;

  // ── Convert screen coordinates to SVG canvas coordinates ─────────────
  // This is needed because the canvas has a pan/zoom transform applied.
  // Without this conversion, click positions would be in screen space,
  // not in the SVG coordinate space where nodes live.
  const screenToSvg = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - transform.x) / transform.k,
      y: (clientY - rect.top - transform.y) / transform.k,
    };
  }, [transform]);

  // ── Pan: start on mousedown on SVG background ─────────────────────────
  function handleSvgMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    // Only start panning if clicking directly on the SVG or graph root (not a node)
    const target = e.target as Element;
    if (target.closest('.node-group') || target.closest('.edge-hit')) return;
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

    if (designMode && designTool === 'add' && !clickedNode) {
      // Add mode: open the add-node modal at the click position
      const pt = screenToSvg(e.clientX, e.clientY);
      document.dispatchEvent(new CustomEvent('flowgraph:add-node', { detail: pt }));
      return;
    }

    if (designMode && designTool === 'connect') {
      if (!clickedNode && !clickedEdge) {
        // Clicked empty space in connect mode — cancel the connection
        setConnectSource(null);
        setGhostTarget(null);
      }
      return;
    }

    // Click on background in any mode — deselect node
    if (!clickedNode) {
      setSelectedNode(null);
    }
  }

  // ── Double-click on SVG background — exit focus mode ─────────────────
  function handleSvgDblClick(e: React.MouseEvent<SVGSVGElement>) {
    const target = e.target as Element;
    if (target.closest('.node-group')) return; // Node dblclick handled in NodeCard
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

  // ── Hover dim/highlight via direct DOM class manipulation ─────────────
  // Bypasses React re-renders entirely: instead of setting store state that
  // triggers all NodeCards to re-render, we directly add/remove CSS classes
  // on the SVG elements. CSS transitions handle the visual smoothness.
  useEffect(() => {
    const graphRoot = document.getElementById('graph-root');
    if (!graphRoot) return;

    if (!hoveredNodeId) {
      graphRoot.removeAttribute('data-hovering');
      graphRoot.querySelectorAll('.node-group.hovered, .node-group.neighbor').forEach((el) => {
        el.classList.remove('hovered', 'neighbor');
      });
      return;
    }

    const hovNode = allNodes.find((n) => n.id === hoveredNodeId);
    const directParents = new Set(hovNode?.dependencies ?? []);
    const directChildren = new Set(
      visibleEdges.filter((e) => e.from === hoveredNodeId).map((e) => e.to)
    );

    graphRoot.setAttribute('data-hovering', '');
    graphRoot.querySelectorAll('.node-group').forEach((el) => {
      const id = el.getAttribute('data-id');
      el.classList.remove('hovered', 'neighbor');
      if (id === hoveredNodeId) {
        el.classList.add('hovered');
      } else if (id && (directParents.has(id) || directChildren.has(id))) {
        el.classList.add('neighbor');
      }
    });
  }, [hoveredNodeId, allNodes, visibleEdges]);

  // ── Stable focus-request handler (prevents NodeCard memo invalidation) ─
  const handleFocusRequest = useCallback((id: string) => {
    if (!designMode) {
      enterFocusMode(id);
      setTimeout(() => fitToScreen(), 50);
    }
  }, [designMode, enterFocusMode, fitToScreen]);

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
          <g id="lanes-layer">
            <LaneLayer
              nodes={visibleNodes}
              positions={positions}
              laneMetrics={laneMetrics}
              ownerColors={ownerColors}
              viewMode={viewMode}
            />
          </g>
          <g id="edges-layer">
            <EdgeLayer
              edges={visibleEdges}
              positions={positions}
              designMode={designMode}
              ownerColors={ownerColors}
              nodes={visibleNodes}
            />
            {/* Ghost edge shown while drawing a connection in design mode */}
            {designMode && connectSourceId && ghostTarget && (
              <GhostEdge
                sourcePosition={positions[connectSourceId]}
                targetPoint={ghostTarget}
              />
            )}
          </g>
          <g id="nodes-layer">
            {visibleNodes.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                position={positions[node.id] ?? { x: 0, y: 0 }}
                color={ownerColors[node.owner] ?? '#4f9eff'}
                screenToSvg={screenToSvg}
                onFocusRequest={handleFocusRequest}
              />
            ))}
          </g>
          </g>{/* end graph-content */}
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

      {/* Minimap — bottom right corner overview */}
      <MiniMap
        nodes={visibleNodes}
        positions={positions}
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
