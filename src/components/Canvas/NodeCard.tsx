/**
 * components/Canvas/NodeCard.tsx — Renders a single node as an SVG group.
 *
 * Fix notes:
 *  - Uses CSS `style.transform` (not SVG `transform` attribute) so node positions
 *    can be CSS-transitioned during view/focus-mode switches.
 *  - Uses `wasDraggedRef` to prevent the click handler from firing after a drag
 *    (the SVG `click` event fires after `mouseup`, at which point dragRef is null).
 *  - In LANES view, node Y position is clamped to its owner's lane bounds on drag.
 *  - Hover dim/highlight is entirely CSS-driven (no Zustand subscription).
 */

import React, { memo, useRef, useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { NODE_W, NODE_H, LANE_LABEL_W, truncateText, clampXOutOfPhaseBands } from '../../utils/layout';
import { GROUP_R } from '../../utils/grouping';
import type { GraphNode, Position } from '../../types/graph';

interface NodeCardProps {
  node: GraphNode;
  position: Position;
  color: string;
  screenToSvg: (clientX: number, clientY: number) => Position;
  onFocusRequest: (id: string) => void;
}

export const NodeCard = memo(function NodeCard({ node, position, color, screenToSvg, onFocusRequest }: NodeCardProps) {
  const {
    selectedNodeId, lastJumpedNodeId,
    designMode, designTool, connectSourceId,
    setSelectedNode, setHoveredNode, setConnectSource, addEdge,
    saveLayoutToCache, settleAndResolve, multiSelectIds, toggleMultiSelect,
  } = useGraphStore();

  const groupRef = useRef<SVGGElement>(null);

  const dragRef = useRef<{
    startSvgX: number; startSvgY: number;
    startNodeX: number; startNodeY: number;
    moved: boolean;
  } | null>(null);

  // Separate flag: set true during drag, consumed by handleClick to block selection.
  // Necessary because onMouseUp nulls dragRef BEFORE the browser fires the click event.
  const wasDraggedRef = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isLocalHovered, setIsLocalHovered] = useState(false);

  const isSelected = selectedNodeId === node.id;
  const isJumped = lastJumpedNodeId === node.id;
  const isConnectSource = connectSourceId === node.id;
  const isMultiSelected = multiSelectIds.includes(node.id);

  let strokeColor = 'var(--border2)';
  let strokeWidth = 1.5;
  if (isConnectSource)                      { strokeColor = '#a78bfa'; strokeWidth = 2.5; }
  else if (isMultiSelected || (isSelected && designMode)) { strokeColor = '#ef4444'; strokeWidth = 2.5; }
  else if (isSelected)                      { strokeColor = 'var(--accent)'; strokeWidth = 2; }
  else if (isLocalHovered)                  { strokeColor = 'var(--accent)'; strokeWidth = 2; }

  // ── Drag handling ─────────────────────────────────────────────────────
  function handleMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    if (designMode && designTool === 'connect') return;

    const svgPt = screenToSvg(e.clientX, e.clientY);
    wasDraggedRef.current = false;
    // Read actual store positions (not phase-adjusted visual positions) so the drag
    // delta is applied in the same coordinate space the store uses. If we used the
    // adjusted `position` prop here, the phase offset would be double-counted on
    // every frame — causing nodes to teleport when any phase is collapsed.
    const storePos = useGraphStore.getState().positions[node.id] ?? position;
    dragRef.current = {
      startSvgX: svgPt.x,
      startSvgY: svgPt.y,
      startNodeX: storePos.x,
      startNodeY: storePos.y,
      moved: false,
    };

    // Co-drag: if this node is part of a multi-select, move all selected items together
    const initState = useGraphStore.getState();
    const isInMultiSelect = initState.multiSelectIds.includes(node.id) && initState.multiSelectIds.length > 1;
    const multiStartPositions: Record<string, { x: number; y: number }> = {};
    if (isInMultiSelect) {
      initState.multiSelectIds.forEach((id) => {
        const pos = initState.positions[id];
        if (pos) multiStartPositions[id] = { x: pos.x, y: pos.y };
      });
    }

    function onMouseMove(me: MouseEvent) {
      if (!dragRef.current) return;
      const currentSvgPt = screenToSvg(me.clientX, me.clientY);
      const dx = currentSvgPt.x - dragRef.current.startSvgX;
      const dy = currentSvgPt.y - dragRef.current.startSvgY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        dragRef.current.moved = true;
        wasDraggedRef.current = true; // persists past mouseup so click handler can see it
      }
      if (dragRef.current.moved) {
        groupRef.current?.classList.add('node-dragging');

        if (isInMultiSelect) {
          // Move all selected items, clamping each to its own lane in LANES view
          const state = useGraphStore.getState();
          const updates: Record<string, { x: number; y: number }> = {};
          Object.entries(multiStartPositions).forEach(([id, pos]) => {
            let newY = pos.y + dy;
            if (state.viewMode === 'lanes') {
              const n = state.allNodes.find((nd) => nd.id === id);
              const g = state.groups.find((gr) => gr.id === id);
              if (n) {
                const lane = state.laneMetrics[n.owner];
                if (lane) {
                  const margin = 6;
                  newY = Math.max(lane.y + margin, Math.min(lane.y + lane.height - NODE_H - margin, newY));
                }
              } else if (g) {
                const relevantLanes = g.owners.map((o) => state.laneMetrics[o]).filter(Boolean);
                if (relevantLanes.length > 0) {
                  const topY = Math.min(...relevantLanes.map((l) => l.y));
                  const bottomY = Math.max(...relevantLanes.map((l) => l.y + l.height));
                  newY = Math.max(topY + GROUP_R, Math.min(bottomY - GROUP_R, newY));
                }
              }
            }
            // DAG view: live X-wall per item, excluding all co-dragged items from band calc
            let newX = pos.x + dx;
            if (state.viewMode === 'dag' && state.phases.length > 0) {
              const coMovedIds = new Set(Object.keys(multiStartPositions));
              newX = clampXOutOfPhaseBands(newX, id, state.phases, state.positions, NODE_W, coMovedIds);
            }
            updates[id] = { x: newX, y: newY };
          });
          useGraphStore.setState((s) => ({ positions: { ...s.positions, ...updates } }));
        } else {
          const state = useGraphStore.getState();
          let newY = dragRef.current.startNodeY + dy;

          // Clamp to the node's own swim lane in LANES view
          let newX = dragRef.current.startNodeX + dx;
          if (state.viewMode === 'lanes') {
            newX = Math.max(LANE_LABEL_W, newX);
            const lane = state.laneMetrics[node.owner];
            if (lane) {
              const margin = 6;
              newY = Math.max(
                lane.y + margin,
                Math.min(lane.y + lane.height - NODE_H - margin, newY)
              );
            }
          }

          // DAG view: live X-wall — deflect out of any phase band we don't belong to
          if (state.viewMode === 'dag' && state.phases.length > 0) {
            newX = clampXOutOfPhaseBands(newX, node.id, state.phases, state.positions, NODE_W);
          }

          useGraphStore.setState((s) => ({
            positions: {
              ...s.positions,
              [node.id]: { x: newX, y: newY },
            },
          }));
        }
      }
    }

    function onMouseUp() {
      if (dragRef.current?.moved) {
        const startX = dragRef.current.startNodeX;
        const startY = dragRef.current.startNodeY;
        const state = useGraphStore.getState();
        const { phases, positions } = state;
        const PHASE_PAD_X = 30;

        if (state.viewMode === 'dag') {
          // DAG view: live X-wall already prevents band violations.
          // settleAndResolve handles any cascade edge-cases and removes overlaps.
          // Anchor the dragged item(s) so they stay where they were dropped.
          const anchorIds = new Set(isInMultiSelect ? Object.keys(multiStartPositions) : [node.id]);
          settleAndResolve(anchorIds);
          saveLayoutToCache();
        } else if (isInMultiSelect) {
          // LANE view multi-select: snap back any item that landed in a foreign phase band
          const snapBackUpdates: Record<string, { x: number; y: number }> = {};
          Object.entries(multiStartPositions).forEach(([id, startPos]) => {
            if (!state.allNodes.find((nd) => nd.id === id)) return; // skip groups
            const newX = positions[id]?.x ?? startPos.x;
            const myPhase = phases.find((ph) => ph.nodeIds.includes(id));
            for (const phase of phases) {
              if (myPhase && phase.id === myPhase.id) continue;
              const assignedPos = phase.nodeIds
                .filter((nid) => nid !== id)
                .map((nid) => positions[nid])
                .filter((p): p is { x: number; y: number } => !!p);
              if (assignedPos.length === 0) continue;
              const bandMinX = Math.min(...assignedPos.map((p) => p.x)) - PHASE_PAD_X;
              const bandMaxX = Math.max(...assignedPos.map((p) => p.x + NODE_W)) + PHASE_PAD_X;
              if (newX + NODE_W > bandMinX && newX < bandMaxX) {
                snapBackUpdates[id] = startPos;
                break;
              }
            }
          });
          if (Object.keys(snapBackUpdates).length > 0) {
            useGraphStore.setState((s) => ({ positions: { ...s.positions, ...snapBackUpdates } }));
          }
          // All dragged items (including any that snapped back) are anchors
          const anchorIds = new Set(Object.keys(multiStartPositions));
          settleAndResolve(anchorIds);
          saveLayoutToCache();
        } else {
          // LANE view single-node: snap back if landed in a foreign phase band
          const newX = positions[node.id]?.x ?? startX;
          const myPhase = phases.find((ph) => ph.nodeIds.includes(node.id));
          let shouldSnapBack = false;
          for (const phase of phases) {
            if (myPhase && phase.id === myPhase.id) continue;
            const assignedPositions = phase.nodeIds
              .filter((nid) => nid !== node.id)
              .map((nid) => positions[nid])
              .filter((p): p is { x: number; y: number } => !!p);
            if (assignedPositions.length === 0) continue;
            const bandMinX = Math.min(...assignedPositions.map((p) => p.x)) - PHASE_PAD_X;
            const bandMaxX = Math.max(...assignedPositions.map((p) => p.x + NODE_W)) + PHASE_PAD_X;
            if (newX + NODE_W > bandMinX && newX < bandMaxX) {
              shouldSnapBack = true;
              break;
            }
          }

          if (shouldSnapBack) {
            const el = groupRef.current;
            el?.classList.add('node-snapping');
            useGraphStore.setState((s) => ({
              positions: { ...s.positions, [node.id]: { x: startX, y: startY } },
            }));
            setTimeout(() => el?.classList.remove('node-snapping'), 300);
          } else {
            // Valid drop — anchor this node, resolve all other overlaps around it
            settleAndResolve(new Set([node.id]));
            saveLayoutToCache();
          }
        }
      }
      groupRef.current?.classList.remove('node-dragging');
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // ── Click: select node or complete connection ─────────────────────────
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    // Block click if this mousedown-mouseup was actually a drag
    if (wasDraggedRef.current) {
      wasDraggedRef.current = false;
      return;
    }

    if (designMode && designTool === 'connect') {
      if (!connectSourceId) {
        setConnectSource(node.id);
      } else if (connectSourceId !== node.id) {
        addEdge(connectSourceId, node.id);
        setConnectSource(null);
      }
      return;
    }

    // Shift+click: toggle multi-select.
    // In design/select mode: for group creation. In view mode: for co-drag.
    if (e.shiftKey && (!designMode || designTool === 'select')) {
      const state = useGraphStore.getState();
      if (state.multiSelectIds.length === 0) {
        const prev = state.selectedNodeId !== node.id ? state.selectedNodeId : null;
        if (prev) toggleMultiSelect(prev);
        else if (state.selectedGroupId) toggleMultiSelect(state.selectedGroupId);
      }
      toggleMultiSelect(node.id);
      return;
    }

    setSelectedNode(node.id);
  }

  // ── Double-click: focus mode (view) or edit (design) ─────────────────
  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);

    if (designMode) {
      document.dispatchEvent(new CustomEvent('flowgraph:edit-node', { detail: { nodeId: node.id } }));
    } else {
      onFocusRequest(node.id);
    }
  }

  return (
    <g
      ref={groupRef}
      className={`node-group${isJumped ? ' node-jumped' : ''}${(isSelected || isMultiSelected) && designMode ? ' node-selected' : ''}`}
      data-id={node.id}
      // CSS transform (not SVG attribute) enables CSS transitions for view/focus switches
      style={{ cursor: 'grab', transform: `translate(${position.x}px,${position.y}px)` }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => { setIsLocalHovered(true); setHoveredNode(node.id); }}
      onMouseLeave={() => { setIsLocalHovered(false); setHoveredNode(null); }}
    >
      {/* Drop shadow — plain rect, no blur filter (blur triggers GPU recomposition on opacity transitions, causing flicker) */}
      <rect x={3} y={5} width={NODE_W} height={NODE_H} rx={6}
        fill="rgba(0,0,0,0.22)" />

      {/* Selection glow — red ring for multi-selected items (any mode) or selected in design mode */}
      {(isMultiSelected || (isSelected && designMode)) && (
        <rect
          className="node-selected-glow"
          x={-4} y={-4} width={NODE_W + 8} height={NODE_H + 8} rx={9}
          fill="none" stroke="#ef4444" strokeWidth={2} strokeDasharray="6 3"
        />
      )}

      {/* Main rectangle */}
      <rect
        className="node-main-rect"
        width={NODE_W} height={NODE_H} rx={6}
        fill={isLocalHovered || isSelected ? 'var(--surface2)' : 'var(--surface)'}
        stroke={strokeColor} strokeWidth={strokeWidth}
        style={{ transition: 'fill .15s, stroke .15s' }}
      />

      {/* Left accent bar */}
      <rect x={0} y={0} width={4} height={NODE_H} rx={3} fill={color} />

      {/* Node ID */}
      <text x={14} y={20} fontFamily="var(--font-mono)" fontSize={9}
        fill="var(--text3)" style={{ pointerEvents: 'none' }}>
        #{node.id}
      </text>

      {/* Node name */}
      <text x={14} y={38} fontFamily="var(--font-mono)" fontSize={11.5} fontWeight={600}
        fill="var(--text)" style={{ pointerEvents: 'none' }}>
        {truncateText(node.name, 20)}
      </text>

      {/* Owner */}
      <text x={14} y={56} fontFamily="var(--font-mono)" fontSize={9}
        fill={color} style={{ pointerEvents: 'none' }}>
        {truncateText(node.owner, 24)}
      </text>

      {/* Tag pills — stacked in the right column, up to 4 slots */}
      {node.tags && node.tags.length > 0 && (() => {
        const MAX_VISIBLE = 4;
        const visible = node.tags!.slice(0, node.tags!.length > MAX_VISIBLE ? MAX_VISIBLE - 1 : MAX_VISIBLE);
        const overflow = node.tags!.length - visible.length;
        const PILL_H = 13;
        const PILL_GAP = 15;
        const PILL_X = 108;
        const PILL_MAX_W = 66;
        const CHAR_W = 5.2; // approx px per char at 7.5px monospace
        const PAD_X = 6;

        return (
          <g style={{ pointerEvents: 'none' }}>
            {visible.map((tag, i) => {
              const label = tag.label.length > 10 ? tag.label.slice(0, 9) + '…' : tag.label;
              const pillW = Math.min(PILL_MAX_W, Math.max(28, label.length * CHAR_W + PAD_X * 2));
              const y = 8 + i * PILL_GAP;
              return (
                <g key={i}>
                  <rect
                    x={PILL_X} y={y}
                    width={pillW} height={PILL_H} rx={5}
                    fill={tag.color}
                    opacity={0.92}
                  />
                  <text
                    x={PILL_X + pillW / 2} y={y + 9}
                    fontFamily="var(--font-mono)" fontSize={7.5} fontWeight={700}
                    fill="#fff" textAnchor="middle"
                    style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
            {overflow > 0 && (() => {
              const y = 8 + visible.length * PILL_GAP;
              const label = `+${overflow}`;
              const pillW = Math.max(24, label.length * CHAR_W + PAD_X * 2);
              return (
                <g>
                  <rect x={PILL_X} y={y} width={pillW} height={PILL_H} rx={5} fill="var(--border2)" opacity={0.9} />
                  <text
                    x={PILL_X + pillW / 2} y={y + 9}
                    fontFamily="var(--font-mono)" fontSize={7.5} fontWeight={700}
                    fill="var(--text)" textAnchor="middle"
                  >
                    {label}
                  </text>
                </g>
              );
            })()}
          </g>
        );
      })()}
    </g>
  );
});
