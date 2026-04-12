/**
 * components/Canvas/PhaseLayer.tsx — SVG vertical band overlays for phases.
 *
 * Renders one translucent column per phase, sorted by phase.sequence.
 * Each band spans the full canvas height and is bounded horizontally by
 * the leftmost/rightmost nodes assigned to that phase.
 *
 * Phases are purely visual — they do not affect layout or node visibility.
 */

import React, { useState, useRef } from 'react';
import { useGraphStore } from '../../store/graphStore';
import type { GraphPhase, GraphNode, GraphGroup, Position, Transform } from '../../types/graph';
import { NODE_W, NODE_H, PHASE_PAD_X, COLLAPSED_W, LANE_LABEL_W } from '../../utils/layout';
import { GROUP_R } from '../../utils/grouping';

const PHASE_PAD_Y = 20;

const HEADER_H = 48;
const BADGE_R = 12;

interface PhaseLayerProps {
  phases: GraphPhase[];
  nodes: GraphNode[];
  groups: GraphGroup[];
  positions: Record<string, Position>;
  focusedPhaseId: string | null;
  selectedPhaseId: string | null;
  canvasHeight: number;
  collapsedPhaseIds: string[];
  viewMode: 'dag' | 'lanes';
  designMode: boolean;
  screenToSvg: (clientX: number, clientY: number) => Position;
  onPhaseClick: (id: string) => void;
  onPhaseDoubleClick: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onCollapsedHover?: (phaseId: string, clientX: number, clientY: number) => void;
  onCollapsedHoverEnd?: () => void;
  /** 'background': renders only band fills + borders (no header chrome).
   *  'headers': renders only header strips + badges + text + buttons.
   *  undefined (default): renders everything (legacy / single-pass use). */
  renderPart?: 'background' | 'headers';
  /** Current pan/zoom transform — used to keep collapsed-phase labels centered in the viewport. */
  transform?: Transform;
  /** Canvas pixel height — paired with transform to compute the visible SVG window. */
  canvasPixelHeight?: number;
}

interface BandData {
  phase: GraphPhase;
  idx: number;
  minX: number;
  maxX: number;
  minY: number; // minimum node/group y across all members — used to compute globalBandTop
}

export function PhaseLayer({
  phases,
  nodes,
  groups,
  positions,
  focusedPhaseId,
  selectedPhaseId,
  canvasHeight,
  collapsedPhaseIds,
  viewMode,
  designMode,
  screenToSvg,
  onPhaseClick,
  onPhaseDoubleClick,
  onToggleCollapse,
  onCollapsedHover,
  onCollapsedHoverEnd,
  renderPart,
  transform,
  canvasPixelHeight,
}: PhaseLayerProps) {
  const { saveLayoutToCache, settleAllPhases, reorderPhasesByPosition } = useGraphStore();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Folder tab dimensions for collapsed strips
  const TAB_H = 22;
  const MAX_TAB_CHARS = 18;

  const dragRef = useRef<{
    startSvgX: number;
    startSvgY: number;
    startPositions: Record<string, { x: number; y: number }>;
  } | null>(null);

  function handleHeaderMouseDown(e: React.MouseEvent, phase: GraphPhase) {
    e.stopPropagation();
    e.preventDefault();

    const state = useGraphStore.getState();
    const svgPt = screenToSvg(e.clientX, e.clientY);

    // Snapshot start positions of all nodes AND groups assigned to this phase
    const startPositions: Record<string, { x: number; y: number }> = {};
    phase.nodeIds.forEach((nid) => {
      const pos = state.positions[nid];
      if (pos) startPositions[nid] = { x: pos.x, y: pos.y };
    });
    (phase.groupIds ?? []).forEach((gid) => {
      const pos = state.positions[gid];
      if (pos) startPositions[gid] = { x: pos.x, y: pos.y };
    });

    dragRef.current = { startSvgX: svgPt.x, startSvgY: svgPt.y, startPositions };
    setDraggingId(phase.id);

    let lastPushTime = 0;

    function onMove(me: MouseEvent) {
      if (!dragRef.current) return;
      const cur = screenToSvg(me.clientX, me.clientY);
      let dx = cur.x - dragRef.current.startSvgX;
      const dy = cur.y - dragRef.current.startSvgY;

      // In lanes view, clamp dx so no member node slides behind the lane title.
      if (viewMode === 'lanes') {
        const minMemberX = Math.min(
          ...Object.values(dragRef.current.startPositions).map((p) => p.x)
        );
        dx = Math.max(dx, LANE_LABEL_W - minMemberX);
      }

      const updates: Record<string, { x: number; y: number }> = {};
      Object.entries(dragRef.current.startPositions).forEach(([nid, pos]) => {
        updates[nid] = { x: pos.x + dx, y: pos.y };
      });
      useGraphStore.setState((s) => ({ positions: { ...s.positions, ...updates } }));
      const now = Date.now();
      if (now - lastPushTime > 50) {
        lastPushTime = now;
        settleAllPhases();
      }
    }

    function onUp() {
      if (dragRef.current) {
        // Member node positions are already live in the store (written during onMove).
        // Settle all phase boundaries using the unified algorithm.
        settleAllPhases();
        reorderPhasesByPosition();
        saveLayoutToCache();
        dragRef.current = null;
      }
      setDraggingId(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  if (phases.length === 0) return null;

  const sorted = [...phases].sort((a, b) => a.sequence - b.sequence);
  const hasFocus = focusedPhaseId !== null;
  const bandH = Math.max(canvasHeight, 400);
  const collapsedSet = new Set(collapsedPhaseIds);

  // Build band data — skip phases with no positioned members (nodes or groups)
  const bands: BandData[] = [];
  sorted.forEach((phase, idx) => {
    const assignedNodePositions = phase.nodeIds
      .map((nid) => positions[nid])
      .filter((p): p is Position => !!p);
    const assignedGroupPositions = (phase.groupIds ?? [])
      .map((gid) => positions[gid])
      .filter((p): p is Position => !!p);

    if (assignedNodePositions.length === 0 && assignedGroupPositions.length === 0) return;

    const allXMins = [
      ...assignedNodePositions.map((p) => p.x),
      ...assignedGroupPositions.map((p) => p.x - GROUP_R),
    ];
    const allXMaxes = [
      ...assignedNodePositions.map((p) => p.x + NODE_W),
      ...assignedGroupPositions.map((p) => p.x + GROUP_R),
    ];

    const rawMinX = Math.min(...allXMins) - PHASE_PAD_X;
    const minX = viewMode === 'lanes' ? Math.max(LANE_LABEL_W, rawMinX) : rawMinX;
    const maxX = Math.max(...allXMaxes) + PHASE_PAD_X;

    const allPositions = [...assignedNodePositions, ...assignedGroupPositions];
    const minY = Math.min(...allPositions.map((p) => p.y));

    bands.push({ phase, idx, minX, maxX, minY });
  });

  if (bands.length === 0) return null;

  // All phase headers share one aligned top: the topmost member across ALL phases,
  // minus room for the header strip. Applies to both DAG and Lane views.
  const globalBandTop = Math.min(...bands.map((b) => b.minY)) - HEADER_H - PHASE_PAD_Y;

  return (
    <>
      {bands.map(({ phase, idx, minX, maxX, minY }) => {
        const isCollapsed = collapsedSet.has(phase.id);
        const isHovered = hoveredId === phase.id;
        const isFocused = focusedPhaseId === phase.id;
        const isSelected = selectedPhaseId === phase.id;
        const isGhosted = hasFocus && !isFocused;

        const fillOpacity = isGhosted ? 0.01 : isHovered ? 0.08 : isFocused ? 0.12 : 0.04;
        const headerOpacity = isGhosted ? 0.01 : isFocused ? 0.30 : isHovered ? 0.22 : 0.16;
        const strokeOpacity = isGhosted ? 0.02 : isSelected ? 0.6 : 0.2;

        // Both modes: full-height columns extending to the bottom of the canvas.
        // DAG mode: all headers share globalBandTop so they align at the same Y.
        // LANE mode: bandTop is per-band relative to the topmost member (unchanged).
        const bandTop = globalBandTop;
        const actualBandH = bandH - bandTop;

        if (isCollapsed) {
          // ── Collapsed strip variant ────────────────────────────────────────
          const stripCenterX = minX + COLLAPSED_W / 2;

          // Compute the center of the *visible* portion of the strip so the
          // rotated label always sits in the middle of the screen even when
          // panning or zooming. Falls back to band center when transform is unknown.
          let labelY = bandTop + actualBandH / 2;
          if (transform && canvasPixelHeight) {
            const k = transform.k;
            const vpTop    = -transform.y / k;
            const vpBottom = (canvasPixelHeight - transform.y) / k;
            const visTop   = Math.max(bandTop, vpTop);
            const visBot   = Math.min(bandTop + actualBandH, vpBottom);
            if (visBot > visTop) {
              const visCenter = (visTop + visBot) / 2;
              // Clamp so the text never overlaps the tab or gets clipped at the strip bottom
              labelY = Math.max(bandTop + 70, Math.min(bandTop + actualBandH - 40, visCenter));
            }
          }

          // Expand button + count badge track the top of the visible area so
          // they're always reachable without scrolling up.
          let expandBtnY = bandTop + 20;
          if (transform && canvasPixelHeight) {
            const k = transform.k;
            const vpTop  = -transform.y / k;
            const visTop = Math.max(bandTop, vpTop);
            expandBtnY = Math.min(visTop + 20, bandTop + actualBandH - 36);
          }

          const showFill    = renderPart !== 'headers';
          const showChrome  = renderPart !== 'background';

          // Folder tab sizing: proportional to name length, capped at MAX_TAB_CHARS
          const tabLabel = phase.name.length > MAX_TAB_CHARS
            ? phase.name.slice(0, MAX_TAB_CHARS - 1) + '…'
            : phase.name;
          const TAB_W = Math.max(COLLAPSED_W, Math.min(tabLabel.length * 7.5 + 20, 160));

          return (
            <g
              key={phase.id}
              data-phase-id={phase.id}
              style={{ cursor: 'pointer' }}
              onDoubleClick={() => onToggleCollapse(phase.id)}
              onMouseEnter={(e) => {
                setHoveredId(phase.id);
                onCollapsedHover?.(phase.id, e.clientX, e.clientY);
              }}
              onMouseLeave={() => {
                setHoveredId(null);
                onCollapsedHoverEnd?.();
              }}
              onClick={() => onPhaseClick(phase.id)}
            >
              {showFill && (
                <>
                  {/* Strip fill */}
                  <rect
                    x={minX}
                    y={bandTop}
                    width={COLLAPSED_W}
                    height={actualBandH}
                    rx={0}
                    fill={phase.color}
                    fillOpacity={isGhosted ? 0.01 : isHovered ? 0.12 : 0.06}
                  />
                  {/* Right border */}
                  <line
                    x1={minX + COLLAPSED_W}
                    y1={bandTop}
                    x2={minX + COLLAPSED_W}
                    y2={bandTop + actualBandH}
                    stroke={phase.color}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                  />
                </>
              )}
              {showChrome && (
                <>
                  {/* Transparent hit rect — covers strip + tab area so the <g> captures mouse events.
                      Without this the headers pass has no painted surface and onMouseEnter never fires. */}
                  <rect
                    x={minX}
                    y={bandTop - TAB_H}
                    width={Math.max(COLLAPSED_W, TAB_W)}
                    height={actualBandH + TAB_H}
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                  />

                  {/* Folder tab — horizontal label above the collapsed strip */}
                  <rect
                    x={minX}
                    y={bandTop - TAB_H}
                    width={TAB_W}
                    height={TAB_H}
                    rx={4}
                    fill={phase.color}
                    fillOpacity={isGhosted ? 0.05 : isHovered ? 0.85 : 0.65}
                    style={{ pointerEvents: 'none' }}
                  />
                  <text
                    x={minX + TAB_W / 2}
                    y={bandTop - TAB_H / 2 + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill="#fff"
                    fillOpacity={isGhosted ? 0.15 : 0.95}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {tabLabel}
                  </text>

                  {/* Rotated phase name inside strip (secondary, smaller) */}
                  <text
                    x={stripCenterX}
                    y={labelY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill={phase.color}
                    fillOpacity={isGhosted ? 0.1 : 0.85}
                    transform={`rotate(-90, ${stripCenterX}, ${labelY})`}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {phase.name}
                  </text>
                  {/* Expand button (▶) */}
                  <text
                    x={stripCenterX}
                    y={expandBtnY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={10}
                    fill={phase.color}
                    fillOpacity={isGhosted ? 0.1 : 0.8}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={(e) => { e.stopPropagation(); onToggleCollapse(phase.id); }}
                  >
                    ▶
                  </text>
                  {/* Node count badge */}
                  <text
                    x={stripCenterX}
                    y={expandBtnY + 18}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={9}
                    fill={phase.color}
                    fillOpacity={isGhosted ? 0.05 : 0.6}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {phase.nodeIds.length}
                  </text>
                </>
              )}
            </g>
          );
        }

        // ── Expanded band variant ──────────────────────────────────────────
        const bandW = maxX - minX;
        const badgeX = minX + 14 + BADGE_R;
        const badgeY = bandTop + HEADER_H / 2;

        const isDraggable = designMode;
        const dragCursor = draggingId === phase.id ? 'grabbing' : isDraggable ? 'grab' : 'pointer';

        const showFill   = renderPart !== 'headers';
        const showChrome = renderPart !== 'background';

        return (
          <g
            key={phase.id}
            data-phase-id={phase.id}
            style={{ cursor: 'pointer' }}
            onClick={() => onPhaseClick(phase.id)}
            onDoubleClick={() => onPhaseDoubleClick(phase.id)}
            onMouseEnter={() => setHoveredId(phase.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {showFill && (
              <>
                {/* Main band fill — full-height column, no rounded corners (same in both modes) */}
                <rect
                  x={minX} y={bandTop} width={bandW} height={actualBandH}
                  fill={phase.color} fillOpacity={fillOpacity}
                />

                {/* Right-side dashed border delineates where this phase ends */}
                <line
                  x1={maxX} y1={bandTop} x2={maxX} y2={bandTop + actualBandH}
                  stroke={phase.color} strokeOpacity={strokeOpacity} strokeWidth={1.5} strokeDasharray="6 4"
                />
              </>
            )}

            {showChrome && (
              <>
                {/* Header strip — drag handle in design mode only */}
                <rect
                  x={minX} y={bandTop} width={bandW} height={HEADER_H}
                  fill={phase.color} fillOpacity={headerOpacity}
                  style={{ cursor: dragCursor }}
                  onMouseDown={isDraggable ? (e) => handleHeaderMouseDown(e, phase) : undefined}
                />

                {/* Number badge */}
                <circle cx={badgeX} cy={badgeY} r={BADGE_R} fill={phase.color} fillOpacity={isGhosted ? 0.05 : 0.85} />
                <text
                  x={badgeX} y={badgeY + 1}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={10} fontWeight={700} fill="#fff"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {idx + 1}
                </text>

                {/* Phase name */}
                <text
                  x={badgeX + BADGE_R + 6} y={badgeY + 1}
                  dominantBaseline="middle" fontSize={13} fontWeight={600}
                  fill={phase.color} fillOpacity={isGhosted ? 0.1 : 0.9}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {phase.name}
                </text>

                {/* Collapse button (◀) */}
                <text
                  x={maxX - 14} y={badgeY + 1}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={12} fill={phase.color} fillOpacity={isGhosted ? 0.1 : 0.7}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={(e) => { e.stopPropagation(); onToggleCollapse(phase.id); }}
                >
                  ◀
                </text>
              </>
            )}
          </g>
        );
      })}
    </>
  );
}
