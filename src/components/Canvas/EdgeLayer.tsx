/**
 * components/Canvas/EdgeLayer.tsx — Renders all directed edges as SVG paths.
 *
 * Each edge is rendered as a group containing:
 *   1. A wide invisible "hit area" path (12px stroke-width) for easy mouse targeting
 *   2. A visible styled path with the actual edge appearance
 *
 * Why the hit area? SVG paths are mathematically thin — a 1.5px stroke is
 * nearly impossible to click precisely. The 12px transparent hit area makes
 * edges easy to hover/click for deletion in design mode.
 *
 * In design mode, hovering an edge turns it red and shows a delete tooltip.
 */

import React from 'react';
import { computeEdgePath, NODE_W, NODE_H } from '../../utils/layout';
import type { GraphEdge, GraphGroup, Position, GraphNode } from '../../types/graph';
import { useGraphStore } from '../../store/graphStore';
import { getCollapsedGroupForNode, getAllDescendantNodeIds } from '../../utils/grouping';

interface EdgeLayerProps {
  edges: GraphEdge[];
  positions: Record<string, Position>;
  designMode: boolean;
  ownerColors: Record<string, string>;
  nodes: GraphNode[];
  groups: GraphGroup[];
  ownerFocusSets?: { ownedIds: Set<string>; upstreamIds: Set<string>; downstreamIds: Set<string> } | null;
  focusedOwner?: string | null;
}

export function EdgeLayer({ edges, positions, designMode, ownerColors, nodes, groups, ownerFocusSets, focusedOwner }: EdgeLayerProps) {
  const { hoveredNodeId, deleteEdge, viewMode, designTool, multiSelectIds, selectedNodeId, selectedGroupId, discoveryActive, discoveryPhase, discoveryRoleMap } = useGraphStore();

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

  return (
    <>
      {edges.map((edge) => {
        const fromPos = effectiveFromPos(edge.from);
        const toPos = effectiveToPos(edge.to);
        if (!fromPos || !toPos) return null; // Skip edges with missing position data

        // Skip self-edges that result when both endpoints are in the same collapsed group
        const fromGroup = getCollapsedGroupForNode(edge.from, groups);
        const toGroup = getCollapsedGroupForNode(edge.to, groups);
        if (fromGroup && toGroup && fromGroup.id === toGroup.id) return null;

        const pathD = computeEdgePath(fromPos, toPos);

        // Determine if this edge is "cross-lane" (connects nodes in different owner lanes)
        // Cross-lane edges are rendered dashed and dimmed in LANES view
        const isCrossLane = viewMode === 'lanes' && nodeOwnerMap[edge.from] !== nodeOwnerMap[edge.to];

        // Determine edge highlight state based on hovered node or group,
        // OR any node/group in the current multi-selection.
        // When hovering/selecting a group, any edge crossing the group boundary is highlighted.
        let isHighlighted = false;

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

        if (hoveredNodeId) {
          isHighlighted = edgeTouchesId(hoveredNodeId);
        }

        if (!isHighlighted && multiSelectIds.length > 0) {
          isHighlighted = multiSelectIds.some(edgeTouchesId);
        }

        if (!isHighlighted && selectedNodeId) {
          isHighlighted = edgeTouchesId(selectedNodeId);
        }

        if (!isHighlighted && selectedGroupId) {
          isHighlighted = edgeTouchesId(selectedGroupId);
        }

        // Highlighted edges use the source node's owner color so they're visually distinct
        const highlightColor = ownerColors[nodeOwnerMap[edge.from]] ?? 'var(--accent)';

        let strokeColor = 'var(--border2)';
        let strokeWidth = 1.5;
        let opacity = 1;
        let strokeDasharray: string | undefined;
        let markerEnd = 'url(#arrow)';

        if (isHighlighted) {
          // Positive-only: boost connected edges, never dim non-connected ones.
          // Dimming non-connected edges changes opacity on 20-30 long paths simultaneously;
          // at high zoom each path spans many paint tiles → tile invalidation → flicker boxes.
          strokeColor = highlightColor;
          strokeWidth = 2.5;
          markerEnd = 'url(#arrow-dyn)';
        }

        if (isCrossLane && !isHighlighted) {
          strokeDasharray = '5 4';
          opacity = 0.45; // static — does not change on hover, no tile repaint triggered
        }

        // Cinema narration: highlight edges touching focus/danger/lit nodes; ghost everything else.
        // Only during 'cinema' phase — heatmap/free/reconstruction use normal edge rendering.
        if (discoveryActive && discoveryPhase === 'cinema') {
          // Check both the actual node ID and the collapsed group ID (groups can appear in scenes)
          const fromRole = discoveryRoleMap[edge.from] ?? (fromGroup ? discoveryRoleMap[fromGroup.id] : undefined) ?? 'ghost';
          const toRole   = discoveryRoleMap[edge.to]   ?? (toGroup   ? discoveryRoleMap[toGroup.id]   : undefined) ?? 'ghost';

          const isFocusEdge = toRole === 'focus' || toRole === 'danger';
          const isLitEdge   = !isFocusEdge && (fromRole === 'lit' || toRole === 'lit');

          if (isFocusEdge) {
            strokeColor = highlightColor;
            strokeWidth = 2.5;
            opacity = 1;
            strokeDasharray = undefined;
            markerEnd = 'url(#arrow-dyn)';
          } else if (isLitEdge) {
            strokeColor = highlightColor;
            strokeWidth = 1.8;
            opacity = 0.45;
            strokeDasharray = undefined;
            markerEnd = 'url(#arrow-dyn)';
          } else {
            strokeColor = 'var(--border2)';
            strokeWidth = 1.5;
            opacity = 0.07;
            strokeDasharray = undefined;
            markerEnd = 'url(#arrow)';
          }
        }

        // Owner focus mode: color upstream→owned edges blue, owned→downstream edges amber,
        // and ghost all other edges to near-invisible. Overrides cross-lane dimming.
        if (ownerFocusSets && focusedOwner && !isHighlighted) {
          const fromOwned = ownerFocusSets.ownedIds.has(edge.from);
          const toOwned = ownerFocusSets.ownedIds.has(edge.to);
          const fromUpstream = ownerFocusSets.upstreamIds.has(edge.from);
          const toDownstream = ownerFocusSets.downstreamIds.has(edge.to);

          if (fromOwned && toOwned) {
            // owned → owned: full opacity, neutral color
            opacity = 1;
            strokeDasharray = undefined;
          } else if (fromUpstream && toOwned) {
            // upstream → owned: blue
            strokeColor = '#4f9eff';
            strokeWidth = 2;
            opacity = 1;
            strokeDasharray = undefined;
            markerEnd = 'url(#arrow-dyn)';
          } else if (fromOwned && toDownstream) {
            // owned → downstream: amber
            strokeColor = '#f5a623';
            strokeWidth = 2;
            opacity = 1;
            strokeDasharray = undefined;
            markerEnd = 'url(#arrow-dyn)';
          } else {
            // unrelated edge: ghost
            opacity = 0.05;
            strokeDasharray = undefined;
          }
        }

        function handleEdgeMouseEnter(e: React.MouseEvent) {
          if (!designMode || designTool !== 'connect') return;
          // Show the delete tooltip near the cursor
          const tip = document.getElementById('edge-delete-tip');
          if (tip) {
            tip.style.display = 'block';
            tip.style.left = `${e.clientX + 14}px`;
            tip.style.top = `${e.clientY - 10}px`;
          }
          // Make the visible path red
          const pathEl = document.querySelector(`[data-edge-from="${edge.from}"][data-edge-to="${edge.to}"] .edge-vis`);
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
          const pathEl = document.querySelector(`[data-edge-from="${edge.from}"][data-edge-to="${edge.to}"] .edge-vis`);
          if (pathEl) (pathEl as SVGPathElement).style.stroke = '';
        }

        function handleEdgeClick(e: React.MouseEvent) {
          if (!designMode || designTool !== 'connect') return;
          e.stopPropagation();
          const tip = document.getElementById('edge-delete-tip');
          if (tip) tip.style.display = 'none';
          deleteEdge(edge.from, edge.to);
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
              style={{ cursor: designMode ? 'pointer' : 'default' }}
              onMouseEnter={handleEdgeMouseEnter}
              onMouseMove={handleEdgeMouseMove}
              onMouseLeave={handleEdgeMouseLeave}
              onClick={handleEdgeClick}
            />
            {/* Visible styled edge */}
            <path
              className="edge-vis"
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              opacity={opacity}
              strokeDasharray={strokeDasharray}
              markerEnd={markerEnd}
              style={{
                color: strokeColor, // Used by arrow-dyn marker via currentColor (covers owner focus colors)
                transition: 'stroke .15s',
                pointerEvents: 'none', // Hit area handles events, not this path
              }}
            />
          </g>
        );
      })}
    </>
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
      markerEnd="url(#arrow-ghost)"
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
