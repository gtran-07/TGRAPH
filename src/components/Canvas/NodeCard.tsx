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
import { NODE_W, NODE_H, truncateText } from '../../utils/layout';
import { getAllDescendantNodeIds, GROUP_R } from '../../utils/grouping';
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
    saveLayoutToCache, multiSelectIds, toggleMultiSelect,
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
    dragRef.current = {
      startSvgX: svgPt.x,
      startSvgY: svgPt.y,
      startNodeX: position.x,
      startNodeY: position.y,
      moved: false,
    };

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
        const state = useGraphStore.getState();
        let newY = dragRef.current.startNodeY + dy;

        // Clamp to the node's own swim lane in LANES view
        if (state.viewMode === 'lanes') {
          const lane = state.laneMetrics[node.owner];
          if (lane) {
            const margin = 6;
            newY = Math.max(
              lane.y + margin,
              Math.min(lane.y + lane.height - NODE_H - margin, newY)
            );
          }
        }

        useGraphStore.setState((s) => ({
          positions: {
            ...s.positions,
            [node.id]: { x: dragRef.current!.startNodeX + dx, y: newY },
          },
        }));
      }
    }

    function onMouseUp() {
      if (dragRef.current?.moved) {
        const startX = dragRef.current.startNodeX;
        const startY = dragRef.current.startNodeY;

        const state = useGraphStore.getState();
        const { phases, positions } = state;
        const PHASE_PAD_X = 30;
        const newX = positions[node.id]?.x ?? startX;

        // Find which phase this node belongs to (if any)
        const myPhase = phases.find((ph) => ph.nodeIds.includes(node.id));

        // Check if the dropped position overlaps a foreign phase band
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
          // Valid drop — push any non-member nodes/groups out of the expanded phase band
          if (myPhase) {
            const freshState = useGraphStore.getState();
            const freshPositions = freshState.positions;
            const freshGroups = freshState.groups;
            const PUSH_GAP = 20;

            // Recompute band bounds from all nodes in myPhase at their current positions
            const myPhasePositions = myPhase.nodeIds
              .map((nid) => freshPositions[nid])
              .filter((p): p is { x: number; y: number } => !!p);

            if (myPhasePositions.length > 0) {
              const newBandMinX = Math.min(...myPhasePositions.map((p) => p.x)) - PHASE_PAD_X;
              const newBandMaxX = Math.max(...myPhasePositions.map((p) => p.x + NODE_W)) + PHASE_PAD_X;
              const bandCenterX = (newBandMinX + newBandMaxX) / 2;
              const myPhaseNodeSet = new Set(myPhase.nodeIds);
              const pushedPositions: Record<string, { x: number; y: number }> = {};

              // Push non-member nodes
              for (const n of freshState.allNodes) {
                if (myPhaseNodeSet.has(n.id)) continue;
                const pos = freshPositions[n.id];
                if (!pos) continue;
                if (pos.x + NODE_W > newBandMinX && pos.x < newBandMaxX) {
                  const nudgeLeft = pos.x + NODE_W / 2 < bandCenterX;
                  pushedPositions[n.id] = {
                    x: nudgeLeft ? newBandMinX - NODE_W - PUSH_GAP : newBandMaxX + PUSH_GAP,
                    y: pos.y,
                  };
                }
              }

              // Push non-member collapsed groups
              for (const g of freshGroups) {
                if (!g.collapsed) continue;
                const pos = freshPositions[g.id];
                if (!pos) continue;
                const descendantIds = new Set(getAllDescendantNodeIds(g.id, freshGroups));
                if (myPhase.nodeIds.some((nid) => descendantIds.has(nid))) continue;
                if (pos.x + GROUP_R > newBandMinX && pos.x - GROUP_R < newBandMaxX) {
                  const nudgeLeft = pos.x < bandCenterX;
                  pushedPositions[g.id] = {
                    x: nudgeLeft ? newBandMinX - GROUP_R - PUSH_GAP : newBandMaxX + GROUP_R + PUSH_GAP,
                    y: pos.y,
                  };
                }
              }

              if (Object.keys(pushedPositions).length > 0) {
                useGraphStore.setState((s) => ({
                  positions: { ...s.positions, ...pushedPositions },
                }));
              }
            }
          }
          saveLayoutToCache();
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

    // Shift+click in select mode: toggle multi-select for grouping.
    // If this is the first shift-click, auto-include whichever item was already
    // selected (node OR group) so it isn't silently dropped from the new group.
    if (designMode && designTool === 'select' && e.shiftKey) {
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

      {/* Selection glow — red ring for selected or multi-selected items in design mode */}
      {(isSelected || isMultiSelected) && designMode && (
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
    </g>
  );
});
