/**
 * components/Canvas/GroupCard.tsx — Renders a single group on the SVG canvas.
 *
 * COLLAPSED → regular N-sided polygon (N = 4 + nest depth).
 *   - Pentagon  (5) for a group that directly contains nodes.
 *   - Hexagon   (6) for a group that contains sub-groups.
 *   - etc.
 * EXPANDED → semi-transparent dashed bounding-box overlay drawn behind children.
 *
 * Animations:
 *   - Expand : overlay fades in from opacity-0 on mount (CSS transition via mount-effect).
 *   - Collapse: `imploding` prop drives opacity to 0 before the store actually collapses.
 */

import React, { memo, useRef, useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { computePolygonPoints, computeBoundingBox, GROUP_R, getAllDescendantNodeIds } from '../../utils/grouping';
import { NODE_W, NODE_H, LANE_LABEL_W, PHASE_PAD_X } from '../../utils/layout';
import type { GraphGroup, LaneMetrics, Position, ViewMode } from '../../types/graph';

interface GroupCardProps {
  group: GraphGroup;
  position: Position;
  color: string;
  childPositions: Position[];
  screenToSvg: (clientX: number, clientY: number) => Position;
  nestLevel: number;
  onToggleCollapse: (id: string) => void;
  laneMetrics: Record<string, LaneMetrics>;
  viewMode: ViewMode;
}

export const GroupCard = memo(function GroupCard({
  group,
  position,
  color,
  childPositions,
  screenToSvg,
  nestLevel,
  onToggleCollapse,
  laneMetrics,
  viewMode,
}: GroupCardProps) {
  const {
    selectedGroupId, multiSelectIds,
    designMode, designTool,
    setSelectedGroup,
    toggleMultiSelect,
    saveLayoutToCache, settleAndResolve, setHoveredNode,
  } = useGraphStore();

  const groupRef = useRef<SVGGElement>(null);

  const dragRef = useRef<{
    startSvgX: number; startSvgY: number;
    startNodeX: number; startNodeY: number;
    moved: boolean;
  } | null>(null);
  const wasDraggedRef = useRef(false);
  const [isLocalHovered, setIsLocalHovered] = useState(false);


  const isSelected    = selectedGroupId === group.id;
  const isMultiSel    = multiSelectIds.includes(group.id);
  const sides         = 4 + nestLevel;

  // Stroke style: red for selected or multi-selected (design mode), accent otherwise
  let strokeColor = color;
  let strokeWidth = 2;
  if ((isSelected || isMultiSel) && designMode) { strokeColor = '#ef4444'; strokeWidth = 2.5; }
  else if (isSelected)                          { strokeColor = 'var(--accent)'; strokeWidth = 2; }
  else if (isLocalHovered)                      { strokeColor = 'var(--accent)'; strokeWidth = 2.5; }

  // ── Drag (collapsed polygon only) ────────────────────────────────────
  function handleMouseDown(e: React.MouseEvent) {
    if (!group.collapsed) return;
    e.stopPropagation();

    const svgPt = screenToSvg(e.clientX, e.clientY);
    wasDraggedRef.current = false;
    // Read actual store positions (not phase-adjusted visual positions) so the drag
    // delta is applied in the same coordinate space the store uses.
    const storePos = useGraphStore.getState().positions[group.id] ?? position;
    dragRef.current = {
      startSvgX: svgPt.x, startSvgY: svgPt.y,
      startNodeX: storePos.x, startNodeY: storePos.y,
      moved: false,
    };

    // Co-drag: if this group is part of a multi-select, move all selected items together
    const initState = useGraphStore.getState();
    const isInMultiSelect = initState.multiSelectIds.includes(group.id) && initState.multiSelectIds.length > 1;
    const multiStartPositions: Record<string, { x: number; y: number }> = {};
    if (isInMultiSelect) {
      initState.multiSelectIds.forEach((id) => {
        const pos = initState.positions[id];
        if (pos) multiStartPositions[id] = { x: pos.x, y: pos.y };
      });
    }

    function onMove(me: MouseEvent) {
      if (!dragRef.current) return;
      const cur = screenToSvg(me.clientX, me.clientY);
      const dx = cur.x - dragRef.current.startSvgX;
      const dy = cur.y - dragRef.current.startSvgY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        dragRef.current.moved = true;
        wasDraggedRef.current = true;
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
            updates[id] = { x: pos.x + dx, y: newY };
          });
          useGraphStore.setState((s) => ({ positions: { ...s.positions, ...updates } }));
        } else {
          let newX = dragRef.current.startNodeX + dx;
          let newY = dragRef.current.startNodeY + dy;

          // In LANE view, clamp X so the group stays right of the lane label,
          // and clamp vertical movement so the polygon stays within the
          // vertical span of the lanes its nodes belong to.
          if (viewMode === 'lanes') {
            newX = Math.max(LANE_LABEL_W, newX);
            if (group.owners.length > 0) {
              const relevantLanes = group.owners
                .map((owner) => laneMetrics[owner])
                .filter((l): l is LaneMetrics => !!l);
              if (relevantLanes.length > 0) {
                const topY    = Math.min(...relevantLanes.map((l) => l.y));
                const bottomY = Math.max(...relevantLanes.map((l) => l.y + l.height));
                newY = Math.max(topY + GROUP_R, Math.min(bottomY - GROUP_R, newY));
              }
            }
          }

          useGraphStore.setState((s) => ({
            positions: {
              ...s.positions,
              [group.id]: { x: newX, y: newY },
            },
          }));
        }
      }
    }

    function onUp() {
      if (dragRef.current?.moved) {
        const startX = dragRef.current.startNodeX;
        const startY = dragRef.current.startNodeY;
        const state = useGraphStore.getState();
        const { phases, positions, groups: allGroups } = state;
        const PHASE_PAD_X = 30;

        if (isInMultiSelect) {
          // Per-item phase snap-back for co-dragged nodes and groups
          const snapBackUpdates: Record<string, { x: number; y: number }> = {};
          Object.entries(multiStartPositions).forEach(([id, startPos]) => {
            const newX = positions[id]?.x ?? startPos.x;
            const n = state.allNodes.find((nd) => nd.id === id);
            const g = state.groups.find((gr) => gr.id === id);
            if (n) {
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
            } else if (g) {
              const descIds = new Set(getAllDescendantNodeIds(id, allGroups));
              const myPhaseIds = new Set(phases.filter((ph) => ph.nodeIds.some((nid) => descIds.has(nid))).map((ph) => ph.id));
              for (const phase of phases) {
                if (myPhaseIds.has(phase.id)) continue;
                const assignedPos = phase.nodeIds.map((nid) => positions[nid]).filter((p): p is { x: number; y: number } => !!p);
                if (assignedPos.length === 0) continue;
                const bandMinX = Math.min(...assignedPos.map((p) => p.x)) - PHASE_PAD_X;
                const bandMaxX = Math.max(...assignedPos.map((p) => p.x + NODE_W)) + PHASE_PAD_X;
                if (newX + GROUP_R > bandMinX && newX - GROUP_R < bandMaxX) {
                  snapBackUpdates[id] = startPos;
                  break;
                }
              }
            }
          });
          if (Object.keys(snapBackUpdates).length > 0) {
            useGraphStore.setState((s) => ({ positions: { ...s.positions, ...snapBackUpdates } }));
          }
          // Anchor all dragged items; push any non-dragged bystanders out of the way
          settleAndResolve(new Set(Object.keys(multiStartPositions)));
          saveLayoutToCache();
        } else {
          // Single-group drop: check phase boundaries
          const newX = positions[group.id]?.x ?? startX;
          const descendantIds = new Set(getAllDescendantNodeIds(group.id, allGroups));
          const myPhaseIds = new Set(
            phases
              .filter((ph) =>
                ph.nodeIds.some((nid) => descendantIds.has(nid)) ||
                (ph.groupIds ?? []).includes(group.id)
              )
              .map((ph) => ph.id)
          );
          let shouldSnapBack = false;
          for (const phase of phases) {
            if (myPhaseIds.has(phase.id)) continue;
            const nodePos = phase.nodeIds.map((nid) => positions[nid]).filter((p): p is { x: number; y: number } => !!p);
            const grpPos = (phase.groupIds ?? []).map((gid) => positions[gid]).filter((p): p is { x: number; y: number } => !!p);
            if (nodePos.length === 0 && grpPos.length === 0) continue;
            const allXMins = [...nodePos.map((p) => p.x), ...grpPos.map((p) => p.x - GROUP_R)];
            const allXMaxes = [...nodePos.map((p) => p.x + NODE_W), ...grpPos.map((p) => p.x + GROUP_R)];
            const bandMinX = Math.min(...allXMins) - PHASE_PAD_X;
            const bandMaxX = Math.max(...allXMaxes) + PHASE_PAD_X;
            if (newX + GROUP_R > bandMinX && newX - GROUP_R < bandMaxX) {
              shouldSnapBack = true;
              break;
            }
          }

          if (shouldSnapBack) {
            const el = groupRef.current;
            el?.classList.add('node-snapping');
            useGraphStore.setState((s) => ({
              positions: { ...s.positions, [group.id]: { x: startX, y: startY } },
            }));
            setTimeout(() => el?.classList.remove('node-snapping'), 300);
          } else {
            // Valid drop — anchor this group, run full phase + overlap settlement
            settleAndResolve(new Set([group.id]));
            saveLayoutToCache();
          }
        }
      }
      groupRef.current?.classList.remove('node-dragging');
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Click: select or Shift+click for multi-select ────────────────────
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (wasDraggedRef.current) { wasDraggedRef.current = false; return; }

    // Shift+click: toggle multi-select.
    // In design/select mode: for group creation. In view mode: for co-drag.
    if (e.shiftKey && (!designMode || designTool === 'select')) {
      const state = useGraphStore.getState();
      if (state.multiSelectIds.length === 0) {
        const prev = state.selectedGroupId !== group.id ? state.selectedGroupId : null;
        if (prev) toggleMultiSelect(prev);
        else if (state.selectedNodeId) toggleMultiSelect(state.selectedNodeId);
      }
      toggleMultiSelect(group.id);
      return;
    }

    setSelectedGroup(group.id); // setSelectedGroup already clears selectedNodeId in the store
  }

  // ── Double-click: edit (design mode) or toggle collapse ───────────────
  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (designMode) {
      document.dispatchEvent(
        new CustomEvent('flowgraph:edit-group', { detail: { groupId: group.id } })
      );
    } else {
      onToggleCollapse(group.id);
    }
  }

  // ── EXPANDED overlay ──────────────────────────────────────────────────
  if (!group.collapsed) {
    if (childPositions.length === 0) return null;
    const bb = computeBoundingBox(childPositions, NODE_W, NODE_H, 32);
    // Header strip height — the only interactive region; background is pointer-events:none
    // so clicks on child nodes/groups fall through to their own handlers.
    const HEADER_H = 38;

    return (
      <g
        ref={groupRef}
        className="group-overlay"
        data-group-id={group.id}
        onMouseEnter={() => { setIsLocalHovered(true); setHoveredNode(group.id); }}
        onMouseLeave={() => { setIsLocalHovered(false); setHoveredNode(null); }}
        style={{ cursor: 'default' }}
      >
        {/* Selection glow — multi-selected (any mode) or selected in design mode */}
        {(isMultiSel || (isSelected && designMode)) && (
          <rect
            className="group-selected-glow"
            x={bb.x - 4} y={bb.y - 4} width={bb.w + 8} height={bb.h + 8}
            rx={14} ry={14}
            fill="none"
            stroke="#ef4444"
            strokeWidth={2}
            strokeDasharray="8 4"
            style={{ pointerEvents: 'none' }}
          />
        )}
        {/* Background fill — pointer-events:none so inner groups/nodes get their own clicks */}
        <rect
          x={bb.x} y={bb.y} width={bb.w} height={bb.h}
          rx={12} ry={12}
          fill={color}
          fillOpacity={isLocalHovered || isSelected ? 0.12 : 0.07}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray="8 4"
          style={{ transition: 'fill-opacity .15s, stroke .15s', pointerEvents: 'none' }}
        />
        {/* Clickable header strip — subtle colored title bar so users can see the click target.
            Fill is semi-transparent so it doesn't overpower the content below. */}
        <rect
          x={bb.x} y={bb.y} width={bb.w} height={HEADER_H}
          rx={12} ry={12}
          fill={color}
          fillOpacity={isLocalHovered || isSelected ? 0.22 : 0.13}
          style={{ cursor: 'pointer', transition: 'fill-opacity .15s' }}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        />
        {/* Group ID */}
        <text x={bb.x + 14} y={bb.y + 15}
          fontFamily="var(--font-mono)" fontSize={9} fill={color}
          style={{ pointerEvents: 'none' }}>
          {group.id}
        </text>
        {/* Group name */}
        <text x={bb.x + 14} y={bb.y + 29}
          fontFamily="var(--font-mono)" fontSize={11} fontWeight={600} fill="var(--text)"
          style={{ pointerEvents: 'none' }}>
          {group.name.length > 24 ? `${group.name.slice(0, 22)}…` : group.name}
        </text>
        {/* Collapse icon */}
        <text
          x={bb.x + bb.w - 18} y={bb.y + 18}
          fontFamily="var(--font-mono)" fontSize={13} fill={color}
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(group.id); }}
        >⊟</text>
      </g>
    );
  }

  // ── COLLAPSED polygon ─────────────────────────────────────────────────
  const polygonPts = computePolygonPoints(0, 0, GROUP_R, sides);
  const innerPts   = computePolygonPoints(0, 0, GROUP_R * 0.65, sides);
  const ownerLabel = group.owners.length === 0 ? '' :
    group.owners.length === 1 ? group.owners[0] :
    `${group.owners.length} owners`;

  return (
    <g
      ref={groupRef}
      // Use node-group class so CSS hover/dim effects work the same as nodes
      className={`node-group${isSelected ? ' node-selected-group' : ''}${isMultiSel ? ' node-jumped' : ''}`}
      data-group-id={group.id}
      style={{
        cursor: 'grab',
        transform: `translate(${position.x}px,${position.y}px)`,
      }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => { setIsLocalHovered(true); setHoveredNode(group.id); }}
      onMouseLeave={() => { setIsLocalHovered(false); setHoveredNode(null); }}
    >
      {/* Drop shadow — no blur filter (blur inside an opacity-animated group causes GPU flicker) */}
      <polygon
        points={computePolygonPoints(3, 5, GROUP_R + 2, sides)}
        fill="rgba(0,0,0,0.22)"
      />

      {/* Selection glow pulse — multi-selected (any mode) or selected in design mode */}
      {(isMultiSel || (isSelected && designMode)) && (
        <polygon
          className="group-selected-ring"
          points={computePolygonPoints(0, 0, GROUP_R + 8, sides)}
          fill="none"
          stroke="#ef4444"
          strokeWidth={2}
        />
      )}

      {/* Main polygon */}
      <polygon
        className="node-main-rect"
        points={polygonPts}
        fill={isLocalHovered || isSelected ? 'var(--surface2)' : 'var(--surface)'}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        style={{ transition: 'fill .15s, stroke .15s' }}
      />

      {/* Decorative inner ring */}
      <polygon
        points={innerPts}
        fill="none"
        stroke={color}
        strokeWidth={1}
        opacity={0.35}
        style={{ pointerEvents: 'none' }}
      />

      {/* Polygon-type label (e.g. "5-gon") */}
      <text x={0} y={-GROUP_R + 13}
        textAnchor="middle" fontFamily="var(--font-mono)" fontSize={8} fill="var(--text3)"
        style={{ pointerEvents: 'none' }}>
        {sides}-gon
      </text>

      {/* Group ID */}
      <text x={0} y={-12}
        textAnchor="middle" fontFamily="var(--font-mono)" fontSize={9} fill="var(--text3)"
        style={{ pointerEvents: 'none' }}>
        {group.id}
      </text>

      {/* Group name */}
      <text x={0} y={6}
        textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11} fontWeight={600} fill="var(--text)"
        style={{ pointerEvents: 'none' }}>
        {group.name.length > 14 ? `${group.name.slice(0, 12)}…` : group.name}
      </text>

      {/* Owner */}
      <text x={0} y={22}
        textAnchor="middle" fontFamily="var(--font-mono)" fontSize={9} fill={color}
        style={{ pointerEvents: 'none' }}>
        {ownerLabel.length > 18 ? `${ownerLabel.slice(0, 16)}…` : ownerLabel}
      </text>

      {/* Expand icon */}
      <text
        x={0} y={GROUP_R - 10}
        textAnchor="middle" fontFamily="var(--font-mono)" fontSize={13} fill={color} opacity={0.75}
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={(e) => { e.stopPropagation(); onToggleCollapse(group.id); }}
      >⊞</text>
    </g>
  );
});
