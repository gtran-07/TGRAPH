/**
 * components/Canvas/EdgeLayer.tsx — Renders all directed edges as SVG paths.
 *
 * Each edge is rendered as a group containing:
 *   1. A wide invisible "hit area" path (12px stroke-width) for easy mouse targeting
 *   2. An etch body (.edge-groove) — very dark channel, width per tier
 *   3. A top-rim highlight (.edge-rim) — 1px faint white at the top edge of the groove
 *
 * On mount, all edges fade in together (opacity 0→1) after nodes have appeared.
 * V-Groove tiers control groove width and rim opacity only.
 *
 * In design mode, hovering an edge turns it red and shows a delete tooltip.
 */

import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { computeEdgePath, NODE_W, NODE_H, GAP_X } from '../../utils/layout';
import type { GraphEdge, GraphGroup, Position, GraphNode } from '../../types/graph';
import { useGraphStore } from '../../store/graphStore';
import { getCollapsedGroupForNode, getAllDescendantNodeIds } from '../../utils/grouping';

// Etch tiers — groove width and top-rim highlight opacity per path type.
const VGROOVE_TIERS: Record<string, { grooveW: number; hlOpacity: number }> = {
  optional:  { grooveW: 2,  hlOpacity: 0.16 },
  standard:  { grooveW: 4,  hlOpacity: 0.18 },
  priority:  { grooveW: 7,  hlOpacity: 0.20 },
  critical:  { grooveW: 11, hlOpacity: 0.22 },
};

// Laser stroke width per path type — wider beam for higher energy tiers.
const LASER_STROKE_W: Record<string, number> = {
  optional: 1.5,
  standard: 2,
  priority: 2.5,
  critical: 3,
};

interface EdgeLayerProps {
  edges: GraphEdge[];
  positions: Record<string, Position>;
  designMode: boolean;
  ownerColors: Record<string, string>;
  nodes: GraphNode[];
  groups: GraphGroup[];
  ownerFocusSets?: { ownedIds: Set<string>; upstreamIds: Set<string>; downstreamIds: Set<string> } | null;
  focusedOwner?: string | null;
  suppressEntranceAnimation?: boolean;
  /** Called when user clicks an edge in select tool — triggers PathTypePopover in Canvas */
  onEdgeSelectPathType?: (edge: GraphEdge, clientX: number, clientY: number) => void;
}

export function EdgeLayer({ edges, positions, designMode, ownerColors, nodes, groups, ownerFocusSets, focusedOwner, suppressEntranceAnimation, onEdgeSelectPathType }: EdgeLayerProps) {
  const { hoveredNodeId, deleteEdge, viewMode, designTool, multiSelectIds, selectedNodeId, selectedGroupId, discoveryActive, discoveryPhase, discoveryRoleMap, tracePathResults, tracePathSelectedIndex, criticalPathActive, criticalChains, criticalSelectedIds, criticalFocusActive } = useGraphStore();

  const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const containerRef = useRef<SVGGElement>(null);

  // On mount, fade in all edges together after nodes have appeared.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || rm || suppressEntranceAnimation) return;

    container.style.opacity = '0';
    const anim = container.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 400, delay: 250, fill: 'forwards', easing: 'ease-out' },
    );
    anim.finished.then(() => { container.style.opacity = ''; }).catch(() => {});

    return () => {
      anim.cancel();
      container.style.opacity = '';
    };
  }, []); // empty deps — mount only; graph-content remounts on view/focus switches

  /**
   * Resolve the effective position for an edge endpoint.
   * If the node is inside a collapsed group, route the edge to/from that group's position.
   * Group positions are CENTER-based; node positions are top-left-based.
   */
  function effectiveFromPos(nodeId: string): Position | null {
    const collapsed = getCollapsedGroupForNode(nodeId, groups);
    if (collapsed) {
      const gp = positions[collapsed.id];
      return gp ? { x: gp.x - NODE_W / 2, y: gp.y - NODE_H / 2 } : null;
    }
    return positions[nodeId] ?? null;
  }

  function effectiveToPos(nodeId: string): Position | null {
    const collapsed = getCollapsedGroupForNode(nodeId, groups);
    if (collapsed) {
      const gp = positions[collapsed.id];
      return gp ? { x: gp.x - NODE_W / 2, y: gp.y - NODE_H / 2 } : null;
    }
    return positions[nodeId] ?? null;
  }

  // Build a quick id→owner lookup for edge coloring
  const nodeOwnerMap: Record<string, string> = {};
  nodes.forEach((node) => { nodeOwnerMap[node.id] = node.owner; });

  // ── Port-spread offsets ───────────────────────────────────────────────────
  // Memoized on [edges, positions, groups] — stable across hover re-renders.
  // Assigns each edge a startDy and endDy so that multiple edges sharing the
  // same connector point fan out vertically instead of stacking on top of each other.
  const edgeOffsetMap = useMemo((): Map<string, { startDy: number; endDy: number }> => {
    type EdgeData = { fromEffId: string; toEffId: string; fromCX: number; fromCY: number; toCX: number; toCY: number };
    const dataMap = new Map<string, EdgeData>();

    for (const edge of edges) {
      const key = `${edge.from}:${edge.to}`;

      // Resolve collapsed-group endpoints inline (mirrors effectiveFromPos/effectiveToPos).
      const fromCollapsed = getCollapsedGroupForNode(edge.from, groups);
      const toCollapsed   = getCollapsedGroupForNode(edge.to,   groups);
      if (fromCollapsed && toCollapsed && fromCollapsed.id === toCollapsed.id) continue;

      const fromEffId = fromCollapsed?.id ?? edge.from;
      const toEffId   = toCollapsed?.id   ?? edge.to;

      const fromRaw = fromCollapsed
        ? (positions[fromCollapsed.id] ? { x: positions[fromCollapsed.id].x - NODE_W / 2, y: positions[fromCollapsed.id].y - NODE_H / 2 } : null)
        : (positions[edge.from] ?? null);
      const toRaw = toCollapsed
        ? (positions[toCollapsed.id] ? { x: positions[toCollapsed.id].x - NODE_W / 2, y: positions[toCollapsed.id].y - NODE_H / 2 } : null)
        : (positions[edge.to] ?? null);

      if (!fromRaw || !toRaw) continue;

      dataMap.set(key, {
        fromEffId,
        toEffId,
        fromCX: fromRaw.x + NODE_W / 2,
        fromCY: fromRaw.y + NODE_H / 2,
        toCX:   toRaw.x   + NODE_W / 2,
        toCY:   toRaw.y   + NODE_H / 2,
      });
    }

    // Group edge keys by their effective source and target connector IDs.
    const fromGroups = new Map<string, string[]>();
    const toGroups   = new Map<string, string[]>();
    for (const [key, d] of dataMap) {
      if (!fromGroups.has(d.fromEffId)) fromGroups.set(d.fromEffId, []);
      fromGroups.get(d.fromEffId)!.push(key);
      if (!toGroups.has(d.toEffId)) toGroups.set(d.toEffId, []);
      toGroups.get(d.toEffId)!.push(key);
    }

    // Sort each group to minimise crossings using the full edge angle (X + Y).
    // Both fans sort by atan2(dy, dx) of the edge vector, which is in (-90°, 90°)
    // for forward edges (dx > 0) and continuous — avoiding the ±180° discontinuity
    // that a T→S angle would have for sources to the left of the target.
    //
    // Source fan (ascending): upper port → edge angling most upward (negative angle,
    // target above-right); lower port → edge angling most downward (positive angle).
    //
    // Target fan (descending): upper port → edge whose source is most above the target
    // (large positive angle = edge travels downward); lower port → source most below
    // (negative angle = edge travels upward to reach target).
    for (const keys of fromGroups.values()) {
      keys.sort((a, b) => {
        const da = dataMap.get(a)!;
        const db = dataMap.get(b)!;
        return Math.atan2(da.toCY - da.fromCY, da.toCX - da.fromCX)
             - Math.atan2(db.toCY - db.fromCY, db.toCX - db.fromCX);
      });
    }
    for (const keys of toGroups.values()) {
      keys.sort((a, b) => {
        const da = dataMap.get(a)!;
        const db = dataMap.get(b)!;
        return Math.atan2(db.toCY - db.fromCY, db.toCX - db.fromCX)
             - Math.atan2(da.toCY - da.fromCY, da.toCX - da.fromCX);
      });
    }

    // Compute per-edge vertical offset within its group.
    const MAX_SPREAD = NODE_H * 1.1;  // total spread range — can extend slightly beyond node face
    const MAX_STEP   = 36;            // cap per-edge gap so sparse multi-edges don't over-spread
    function offset(index: number, total: number): number {
      if (total <= 1) return 0;
      const step = Math.min(MAX_SPREAD / (total - 1), MAX_STEP);
      return (index - (total - 1) / 2) * step;
    }

    const startDyMap = new Map<string, number>();
    const endDyMap   = new Map<string, number>();
    for (const keys of fromGroups.values()) {
      keys.forEach((k, i) => startDyMap.set(k, offset(i, keys.length)));
    }
    for (const keys of toGroups.values()) {
      keys.forEach((k, i) => endDyMap.set(k, offset(i, keys.length)));
    }

    const result = new Map<string, { startDy: number; endDy: number }>();
    for (const key of dataMap.keys()) {
      result.set(key, { startDy: startDyMap.get(key) ?? 0, endDy: endDyMap.get(key) ?? 0 });
    }
    return result;
  }, [edges, positions, groups]);

  return (
    <g ref={containerRef}>
      {edges.map((edge) => {
        const fromPos = effectiveFromPos(edge.from);
        const toPos = effectiveToPos(edge.to);
        if (!fromPos || !toPos) return null; // Skip edges with missing position data

        // Skip self-edges that result when both endpoints are in the same collapsed group
        const fromGroup = getCollapsedGroupForNode(edge.from, groups);
        const toGroup = getCollapsedGroupForNode(edge.to, groups);
        if (fromGroup && toGroup && fromGroup.id === toGroup.id) return null;

        const edgeKey = `${edge.from}:${edge.to}`;
        const { startDy = 0, endDy = 0 } = edgeOffsetMap.get(edgeKey) ?? {};
        const pathD = computeEdgePath(fromPos, toPos, startDy, endDy);

        // Determine if this edge is "cross-lane" (connects nodes in different owner lanes)
        // Cross-lane edges are rendered dashed and dimmed in LANES view
        const isCrossLane = viewMode === 'lanes' && nodeOwnerMap[edge.from] !== nodeOwnerMap[edge.to];

        // isHoverHighlighted — edge touches the currently hovered node/group (laser animation)
        // isHighlighted      — edge touches hover OR selection (color/width boost, no laser)
        const state = useGraphStore.getState();

        function edgeTouchesId(id: string): boolean {
          const grp = state.groups ? state.groups.find((g) => g.id === id) : null;
          if (grp) {
            const descendantIds = new Set(getAllDescendantNodeIds(grp.id, state.groups));
            const fromIn = descendantIds.has(edge.from);
            const toIn   = descendantIds.has(edge.to);
            return fromIn !== toIn; // boundary-crossing only
          }
          const node = state.allNodes.find((n) => n.id === id);
          const directParents = new Set(node?.dependencies ?? []);
          const directChildren = new Set(
            state.visibleEdges.filter((e) => e.from === id).map((e) => e.to)
          );
          return (
            (edge.to === id && directParents.has(edge.from)) ||
            (edge.from === id && directChildren.has(edge.to))
          );
        }

        const isHoverHighlighted = !!hoveredNodeId && edgeTouchesId(hoveredNodeId);

        // For downstream edges from the hovered node/group, color by the destination's owner.
        let isDownstreamFromHovered = false;
        if (hoveredNodeId && isHoverHighlighted) {
          const hoveredGrp = state.groups?.find((g) => g.id === hoveredNodeId);
          if (hoveredGrp) {
            const desc = new Set(getAllDescendantNodeIds(hoveredGrp.id, state.groups));
            isDownstreamFromHovered = desc.has(edge.from) && !desc.has(edge.to);
          } else {
            isDownstreamFromHovered = edge.from === hoveredNodeId;
          }
        }

        let isHighlighted = isHoverHighlighted;
        if (!isHighlighted && multiSelectIds.length > 0) {
          isHighlighted = multiSelectIds.some(edgeTouchesId);
        }
        if (!isHighlighted && selectedNodeId) {
          isHighlighted = edgeTouchesId(selectedNodeId);
        }
        if (!isHighlighted && selectedGroupId) {
          isHighlighted = edgeTouchesId(selectedGroupId);
        }

        // Downstream edges from the hovered node use the destination's owner color;
        // all other highlighted edges use the source's owner color.
        const highlightColor = (isHoverHighlighted && isDownstreamFromHovered)
          ? (ownerColors[nodeOwnerMap[edge.to]] ?? 'var(--accent)')
          : (ownerColors[nodeOwnerMap[edge.from]] ?? 'var(--accent)');

        // V-Groove tier — always applied; defaults to 'standard' when pathType absent
        const pathType = edge.pathType ?? 'standard';
        const tier = VGROOVE_TIERS[pathType] ?? VGROOVE_TIERS.standard;

        // Rim highlight offset — perpendicular to the edge direction so the 1px highlight
        // falls on the inner lower/left side regardless of path orientation.
        // Uses the actual offset endpoints (including port-spread) for an accurate angle.
        const _rimAngle = Math.atan2(
          (toPos.y + NODE_H / 2 + endDy) - (fromPos.y + NODE_H / 2 + startDy),
          (toPos.x - 10) - (fromPos.x + NODE_W),
        );
        const _rimHalf = (tier.grooveW - 1) / 2;
        const rimDx = -Math.sin(_rimAngle) * _rimHalf;
        const rimDy =  Math.cos(_rimAngle) * _rimHalf;

        let strokeColor = '#070a10';
        let strokeWidth = tier.grooveW;
        let opacity = 1;
        let markerEnd = 'url(#arrow)';
        let isGhostMode = false;

        if (isHighlighted) {
          // Positive-only: boost connected edges via color, never dim non-connected ones.
          strokeColor = highlightColor;
          markerEnd = 'url(#arrow-dyn)';
        }

        // Cinema narration: highlight edges touching focus/danger/lit nodes; ghost everything else.
        if (discoveryActive && discoveryPhase === 'cinema') {
          const fromRole = discoveryRoleMap[edge.from] ?? (fromGroup ? discoveryRoleMap[fromGroup.id] : undefined) ?? 'ghost';
          const toRole   = discoveryRoleMap[edge.to]   ?? (toGroup   ? discoveryRoleMap[toGroup.id]   : undefined) ?? 'ghost';

          const isFocusEdge = toRole === 'focus' || toRole === 'danger';
          const isLitEdge   = !isFocusEdge && (fromRole === 'lit' || toRole === 'lit');

          if (isFocusEdge) {
            strokeColor = highlightColor;
            opacity = 1;
            markerEnd = 'url(#arrow-dyn)';
          } else if (isLitEdge) {
            strokeColor = highlightColor;
            opacity = 0.45;
            markerEnd = 'url(#arrow-dyn)';
          } else {
            strokeColor = 'var(--border2)';
            opacity = 0.07;
            markerEnd = 'url(#arrow)';
            isGhostMode = true;
          }
        }

        // Owner focus mode: color upstream→owned edges blue, owned→downstream edges amber,
        // and ghost all other edges to near-invisible.
        if (ownerFocusSets && focusedOwner && !isHighlighted) {
          const fromOwned = ownerFocusSets.ownedIds.has(edge.from);
          const toOwned = ownerFocusSets.ownedIds.has(edge.to);
          const fromUpstream = ownerFocusSets.upstreamIds.has(edge.from);
          const toDownstream = ownerFocusSets.downstreamIds.has(edge.to);

          if (fromOwned && toOwned) {
            opacity = 1;
          } else if (fromUpstream && toOwned) {
            strokeColor = '#4f9eff';
            opacity = 1;
            markerEnd = 'url(#arrow-dyn)';
          } else if (fromOwned && toDownstream) {
            strokeColor = '#f5a623';
            opacity = 1;
            markerEnd = 'url(#arrow-dyn)';
          } else {
            opacity = 0.05;
            isGhostMode = true;
          }
        }

        // Critical Path Explorer: color edges in selected chains; ghost everything else.
        // Precedence: cinema > owner focus > hover > critical path > base.
        // Hover takes precedence: edges touching the hovered node already have hover styling.
        if (criticalPathActive && criticalSelectedIds.size > 0 && !discoveryActive && !criticalFocusActive && !isHoverHighlighted) {
          const edgeKey = `${edge.from}:${edge.to}`;
          const matchingChain = criticalChains.find(
            c => criticalSelectedIds.has(c.id) && c.edgeKeys.has(edgeKey)
          );
          if (matchingChain) {
            strokeColor = matchingChain.color;
            strokeWidth = Math.max(tier.grooveW, 3);
            opacity = 1;
            markerEnd = 'url(#arrow-dyn)';
          } else if (!isHighlighted) {
            opacity = 0.04;
            isGhostMode = true;
          }
        }

        // Trace Path highlighting: overlay when this edge is in the active traced path
        const tracedPath = tracePathResults[tracePathSelectedIndex];
        const isTraced = !!tracedPath?.some((e) => e.from === edge.from && e.to === edge.to);

        function handleEdgeMouseEnter(e: React.MouseEvent) {
          if (!designMode || designTool !== 'connect') return;
          const tip = document.getElementById('edge-delete-tip');
          if (tip) {
            tip.style.display = 'block';
            tip.style.left = `${e.clientX + 14}px`;
            tip.style.top = `${e.clientY - 10}px`;
          }
          const pathEl = document.querySelector(`[data-edge-from="${edge.from}"][data-edge-to="${edge.to}"] .edge-groove`);
          if (pathEl) (pathEl as SVGPathElement).style.stroke = '#f87171';
        }

        function handleEdgeMouseMove(e: React.MouseEvent) {
          if (!designMode || designTool !== 'connect') return;
          const tip = document.getElementById('edge-delete-tip');
          if (tip) {
            tip.style.left = `${e.clientX + 14}px`;
            tip.style.top = `${e.clientY - 10}px`;
          }
        }

        function handleEdgeMouseLeave() {
          if (!designMode || designTool !== 'connect') return;
          const tip = document.getElementById('edge-delete-tip');
          if (tip) tip.style.display = 'none';
          const pathEl = document.querySelector(`[data-edge-from="${edge.from}"][data-edge-to="${edge.to}"] .edge-groove`);
          if (pathEl) (pathEl as SVGPathElement).style.stroke = '';
        }

        function handleEdgeClick(e: React.MouseEvent) {
          if (!designMode) return;
          if (designTool === 'connect') {
            e.stopPropagation();
            const tip = document.getElementById('edge-delete-tip');
            if (tip) tip.style.display = 'none';
            deleteEdge(edge.from, edge.to);
          } else if (designTool === 'select' && onEdgeSelectPathType) {
            e.stopPropagation();
            onEdgeSelectPathType(edge, e.clientX, e.clientY);
          }
        }

        return (
          <g
            key={`${edge.from}-${edge.to}`}
            data-edge-from={edge.from}
            data-edge-to={edge.to}
          >
            {/* Invisible wide hit area for mouse interaction */}
            <path
              className="edge-hit"
              d={pathD}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              style={{ cursor: designMode ? 'pointer' : 'inherit' }}
              onMouseEnter={handleEdgeMouseEnter}
              onMouseMove={handleEdgeMouseMove}
              onMouseLeave={handleEdgeMouseLeave}
              onClick={handleEdgeClick}
            />
            {/* Etch body — dark etch channel at rest; switches to owner color on highlight */}
            <path
              className="edge-groove"
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              opacity={opacity}
              style={{
                color: strokeColor,
                ['--edge-owner-color' as string]: highlightColor,
                transition: 'stroke .15s, opacity .15s',
                pointerEvents: 'none',
              }}
            />
            {/* Bottom-rim highlight — 1px faint white at the inner edge of the groove,
                offset perpendicular to the edge direction (down for horizontal, left for vertical) */}
            <path
              className="edge-rim"
              d={pathD}
              fill="none"
              stroke={`rgba(220,225,235,${tier.hlOpacity})`}
              strokeWidth={1}
              opacity={isGhostMode ? 0 : opacity}
              transform={`translate(${rimDx}, ${rimDy})`}
              style={{ pointerEvents: 'none' }}
            />
            {/* Laser sweep overlay — tier class drives energy level (speed, beam count, glow).
                Critical gets a second phase-offset arc for an electrical crackling effect. */}
            {isHoverHighlighted && !rm && (
              <>
                <path
                  className={`edge-laser edge-laser--${pathType}`}
                  d={pathD}
                  fill="none"
                  stroke={highlightColor}
                  strokeWidth={LASER_STROKE_W[pathType] ?? 2}
                  style={{ color: highlightColor, pointerEvents: 'none' }}
                />
                {pathType === 'critical' && (
                  <path
                    className="edge-laser edge-laser--critical"
                    d={pathD}
                    fill="none"
                    stroke={highlightColor}
                    strokeWidth={(LASER_STROKE_W.critical) * 0.6}
                    style={{ color: highlightColor, pointerEvents: 'none', animationDelay: '-0.14s', opacity: 0.65 }}
                  />
                )}
              </>
            )}
            {/* Trace Path overlay — drawn on top of the edge when it's part of the active trace */}
            {isTraced && (
              <path
                d={pathD}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={3}
                opacity={0.8}
                strokeDasharray="8 4"
                style={{ pointerEvents: 'none' }}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * components/Canvas/LaneLayer.tsx — Renders swim lane background bands.
 *
 * Only visible in LANES view mode. Each owner gets a horizontal band
 * with a subtle alternating background color and a label on the left.
 */

import type { LaneMetrics } from '../../types/graph';
import type { ViewMode } from '../../types/graph';

interface LaneLayerProps {
  nodes: GraphNode[];
  laneMetrics: Record<string, LaneMetrics>;
  ownerColors: Record<string, string>;
  viewMode: ViewMode;
}

export function LaneLayer({ nodes, laneMetrics, ownerColors, viewMode }: LaneLayerProps) {
  if (viewMode !== 'lanes' || nodes.length === 0) return null;

  // Get ordered unique owners as they appear in the node list
  const ownerOrder: string[] = [];
  nodes.forEach((node) => {
    if (!ownerOrder.includes(node.owner)) ownerOrder.push(node.owner);
  });

  // Compute the total width of the lane bands (max X of any node + some padding)
  const nodeXs = nodes.map((n) => {
    // Rough estimate — exact positions aren't passed here
    return 800; // Fixed wide enough; lanes always span the graph
  });
  const totalWidth = Math.max(1200, ...nodeXs);

  return (
    <>
      {ownerOrder.map((owner, index) => {
        const metrics = laneMetrics[owner];
        if (!metrics) return null;
        const color = ownerColors[owner] ?? '#4f9eff';
        const isEven = index % 2 === 0;

        return (
          <g key={owner} style={{ pointerEvents: 'none' }}>
            {/* Lane background band */}
            <rect
              x={0}
              y={metrics.y}
              width={totalWidth + 200}
              height={metrics.height}
              fill={isEven ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.1)'}
            />
            {/* Lane left border accent */}
            <rect
              x={0}
              y={metrics.y}
              width={3}
              height={metrics.height}
              fill={color}
              opacity={0.6}
            />
            {/* Lane divider line at bottom */}
            <line
              x1={0} y1={metrics.y + metrics.height}
              x2={totalWidth + 200} y2={metrics.y + metrics.height}
              stroke="var(--border)"
              strokeWidth={1}
            />
            {/* Lane label pill */}
            <text
              x={16}
              y={metrics.y + metrics.height / 2 + 4}
              fontFamily="var(--font-display)"
              fontSize={11}
              fontWeight={700}
              fill={color}
              opacity={0.8}
              style={{ pointerEvents: 'auto', cursor: 'pointer' }}
            >
              {owner}
            </text>
          </g>
        );
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * components/Canvas/GhostEdge.tsx — The dashed preview edge shown while
 * drawing a connection in design mode.
 *
 * Appears when the user has clicked a source node in Connect mode.
 * Follows the mouse cursor until a target node is clicked.
 */

interface GhostEdgeProps {
  sourcePosition: Position | undefined;
  targetPoint: Position;
}

export function GhostEdge({ sourcePosition, targetPoint }: GhostEdgeProps) {
  if (!sourcePosition) return null;

  const startX = sourcePosition.x + NODE_W;
  const startY = sourcePosition.y + NODE_H / 2;
  const endX = targetPoint.x;
  const endY = targetPoint.y;
  const cx1 = startX + (endX - startX) * 0.45;
  const cx2 = startX + (endX - startX) * 0.55;

  return (
    <path
      d={`M ${startX} ${startY} C ${cx1} ${startY}, ${cx2} ${endY}, ${endX} ${endY}`}
      fill="none"
      stroke="#a78bfa"
      strokeWidth={1.5}
      strokeDasharray="6 4"
      opacity={0.8}
      style={{ pointerEvents: 'none' }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * components/Canvas/MiniMap.tsx — Small overview map in the bottom-right corner.
 *
 * Shows the entire graph at a reduced scale, with a rectangle indicating
 * the current viewport. Click anywhere on the minimap to jump there.
 */

interface MiniMapProps {
  nodes: GraphNode[];
  positions: Record<string, Position>;
  transform: import('../../types/graph').Transform;
  ownerColors: Record<string, string>;
  canvasRef: React.RefObject<HTMLDivElement>;
}

export function MiniMap({ nodes, positions, transform, ownerColors, canvasRef }: MiniMapProps) {
  const { setTransform } = useGraphStore();

  const MINI_W = 180;
  const MINI_H = 110;

  if (nodes.length === 0) return null;

  // Compute graph bounding box
  const posValues = Object.values(positions);
  if (posValues.length === 0) return null;

  const minX = Math.min(...posValues.map((p) => p.x));
  const maxX = Math.max(...posValues.map((p) => p.x)) + NODE_W;
  const minY = Math.min(...posValues.map((p) => p.y));
  const maxY = Math.max(...posValues.map((p) => p.y)) + NODE_H;
  const graphW = maxX - minX || 1;
  const graphH = maxY - minY || 1;

  // Scale the minimap to fit the graph bounding box
  const scaleX = MINI_W / graphW;
  const scaleY = MINI_H / graphH;
  const miniScale = Math.min(scaleX, scaleY) * 0.9;

  const offsetX = (MINI_W - graphW * miniScale) / 2 - minX * miniScale;
  const offsetY = (MINI_H - graphH * miniScale) / 2 - minY * miniScale;

  // Compute viewport indicator rectangle
  const canvas = canvasRef.current;
  const canvasW = canvas?.clientWidth ?? 800;
  const canvasH = canvas?.clientHeight ?? 600;

  const vpX = (-transform.x / transform.k) * miniScale + offsetX;
  const vpY = (-transform.y / transform.k) * miniScale + offsetY;
  const vpW = (canvasW / transform.k) * miniScale;
  const vpH = (canvasH / transform.k) * miniScale;

  function handleMinimapClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    // Convert minimap click to canvas transform
    const graphX = (clickX - offsetX) / miniScale;
    const graphY = (clickY - offsetY) / miniScale;
    setTransform({
      ...transform,
      x: canvasW / 2 - graphX * transform.k,
      y: canvasH / 2 - graphY * transform.k,
    });
  }

  return (
    <div style={{
      position: 'absolute', bottom: 16, right: 16,
      width: MINI_W, height: MINI_H,
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 6, overflow: 'hidden', opacity: 0.85,
      zIndex: 50,
    }}>
      <svg
        width={MINI_W} height={MINI_H}
        style={{ cursor: 'pointer' }}
        onClick={handleMinimapClick}
      >
        {/* Minimap node rects */}
        {nodes.map((node) => {
          const pos = positions[node.id];
          if (!pos) return null;
          const mx = pos.x * miniScale + offsetX;
          const my = pos.y * miniScale + offsetY;
          const mw = NODE_W * miniScale;
          const mh = NODE_H * miniScale;
          return (
            <rect
              key={node.id}
              x={mx} y={my}
              width={Math.max(mw, 2)} height={Math.max(mh, 2)}
              rx={1}
              fill={ownerColors[node.owner] ?? 'var(--accent)'}
              opacity={0.6}
            />
          );
        })}
        {/* Viewport indicator */}
        <rect
          x={vpX} y={vpY}
          width={Math.max(vpW, 10)} height={Math.max(vpH, 10)}
          fill="rgba(79,158,255,0.1)"
          stroke="var(--accent)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
