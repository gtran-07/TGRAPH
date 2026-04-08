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
import type { GraphPhase, GraphNode, Position } from '../../types/graph';
import { NODE_W, PHASE_PAD_X, COLLAPSED_W } from '../../utils/layout';
import { getAllDescendantNodeIds, GROUP_R } from '../../utils/grouping';

const HEADER_H = 32;
const BADGE_R = 10;

interface PhaseLayerProps {
  phases: GraphPhase[];
  nodes: GraphNode[];
  positions: Record<string, Position>;
  focusedPhaseId: string | null;
  selectedPhaseId: string | null;
  canvasHeight: number;
  collapsedPhaseIds: string[];
  screenToSvg: (clientX: number, clientY: number) => Position;
  onPhaseClick: (id: string) => void;
  onPhaseDoubleClick: (id: string) => void;
  onToggleCollapse: (id: string) => void;
}

interface BandData {
  phase: GraphPhase;
  idx: number;
  minX: number;
  maxX: number;
}

export function PhaseLayer({
  phases,
  nodes,
  positions,
  focusedPhaseId,
  selectedPhaseId,
  canvasHeight,
  collapsedPhaseIds,
  screenToSvg,
  onPhaseClick,
  onPhaseDoubleClick,
  onToggleCollapse,
}: PhaseLayerProps) {
  const { saveLayoutToCache } = useGraphStore();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

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

    // Snapshot start positions of all nodes assigned to this phase
    const startPositions: Record<string, { x: number; y: number }> = {};
    phase.nodeIds.forEach((nid) => {
      const pos = state.positions[nid];
      if (pos) startPositions[nid] = { x: pos.x, y: pos.y };
    });

    dragRef.current = { startSvgX: svgPt.x, startSvgY: svgPt.y, startPositions };
    setDraggingId(phase.id);

    function onMove(me: MouseEvent) {
      if (!dragRef.current) return;
      const cur = screenToSvg(me.clientX, me.clientY);
      const dx = cur.x - dragRef.current.startSvgX;
      const dy = cur.y - dragRef.current.startSvgY;
      const updates: Record<string, { x: number; y: number }> = {};
      Object.entries(dragRef.current.startPositions).forEach(([nid, pos]) => {
        updates[nid] = { x: pos.x + dx, y: pos.y + dy };
      });
      useGraphStore.setState((s) => ({ positions: { ...s.positions, ...updates } }));
    }

    function onUp() {
      if (dragRef.current) {
        const freshState = useGraphStore.getState();
        const freshPositions = freshState.positions;
        const freshGroups = freshState.groups;
        const PUSH_GAP = 20;
        const myPhaseNodeSet = new Set(phase.nodeIds);

        // Recompute band bounds from phase nodes at their new positions
        const myPhasePositions = phase.nodeIds
          .map((nid) => freshPositions[nid])
          .filter((p): p is { x: number; y: number } => !!p);

        if (myPhasePositions.length > 0) {
          const newBandMinX = Math.min(...myPhasePositions.map((p) => p.x)) - PHASE_PAD_X;
          const newBandMaxX = Math.max(...myPhasePositions.map((p) => p.x + NODE_W)) + PHASE_PAD_X;
          const bandCenterX = (newBandMinX + newBandMaxX) / 2;
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
            if (phase.nodeIds.some((nid) => descendantIds.has(nid))) continue;
            if (pos.x + GROUP_R > newBandMinX && pos.x - GROUP_R < newBandMaxX) {
              const nudgeLeft = pos.x < bandCenterX;
              pushedPositions[g.id] = {
                x: nudgeLeft ? newBandMinX - GROUP_R - PUSH_GAP : newBandMaxX + GROUP_R + PUSH_GAP,
                y: pos.y,
              };
            }
          }

          if (Object.keys(pushedPositions).length > 0) {
            useGraphStore.setState((s) => ({ positions: { ...s.positions, ...pushedPositions } }));
          }
        }

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

  // Build band data — skip phases with no positioned nodes
  const bands: BandData[] = [];
  sorted.forEach((phase, idx) => {
    const assignedPositions = phase.nodeIds
      .map((nid) => positions[nid])
      .filter((p): p is Position => !!p);
    if (assignedPositions.length === 0) return;

    const minX = Math.min(...assignedPositions.map((p) => p.x)) - PHASE_PAD_X;
    const maxX = Math.max(...assignedPositions.map((p) => p.x + NODE_W)) + PHASE_PAD_X;
    bands.push({ phase, idx, minX, maxX });
  });

  if (bands.length === 0) return null;

  return (
    <>
      {bands.map(({ phase, idx, minX, maxX }) => {
        const isCollapsed = collapsedSet.has(phase.id);
        const isHovered = hoveredId === phase.id;
        const isFocused = focusedPhaseId === phase.id;
        const isSelected = selectedPhaseId === phase.id;
        const isGhosted = hasFocus && !isFocused;

        const fillOpacity = isGhosted ? 0.01 : isHovered ? 0.08 : isFocused ? 0.12 : 0.04;
        const headerOpacity = isGhosted ? 0.01 : isFocused ? 0.30 : isHovered ? 0.22 : 0.16;
        const strokeOpacity = isGhosted ? 0.02 : isSelected ? 0.6 : 0.2;

        if (isCollapsed) {
          // ── Collapsed strip variant ────────────────────────────────────────
          const stripCenterX = minX + COLLAPSED_W / 2;
          const labelY = bandH / 2;
          return (
            <g
              key={phase.id}
              data-phase-id={phase.id}
              style={{ cursor: 'pointer' }}
              onDoubleClick={() => onToggleCollapse(phase.id)}
              onMouseEnter={() => setHoveredId(phase.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Strip fill */}
              <rect
                x={minX}
                y={0}
                width={COLLAPSED_W}
                height={bandH}
                fill={phase.color}
                fillOpacity={isGhosted ? 0.01 : isHovered ? 0.12 : 0.06}
                onClick={() => onPhaseClick(phase.id)}
              />
              {/* Right border */}
              <line
                x1={minX + COLLAPSED_W}
                y1={0}
                x2={minX + COLLAPSED_W}
                y2={bandH}
                stroke={phase.color}
                strokeOpacity={strokeOpacity}
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
              {/* Rotated phase name */}
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
                y={20}
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
            </g>
          );
        }

        // ── Expanded band variant ──────────────────────────────────────────
        const bandW = maxX - minX;
        const badgeX = minX + 14 + BADGE_R;
        const badgeY = HEADER_H / 2;

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
            {/* Main band fill */}
            <rect x={minX} y={0} width={bandW} height={bandH} fill={phase.color} fillOpacity={fillOpacity} />

            {/* Header strip — draggable to move all phase nodes together */}
            <rect
              x={minX} y={0} width={bandW} height={HEADER_H}
              fill={phase.color} fillOpacity={headerOpacity}
              style={{ cursor: draggingId === phase.id ? 'grabbing' : 'grab' }}
              onMouseDown={(e) => handleHeaderMouseDown(e, phase)}
            />

            {/* Right-side dashed separator */}
            <line
              x1={maxX} y1={0} x2={maxX} y2={bandH}
              stroke={phase.color} strokeOpacity={strokeOpacity} strokeWidth={1.5} strokeDasharray="6 4"
            />

            {/* Number badge */}
            <circle cx={badgeX} cy={badgeY} r={BADGE_R} fill={phase.color} fillOpacity={isGhosted ? 0.05 : 0.85} />
            <text
              x={badgeX} y={badgeY + 1}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={9} fontWeight={700} fill="#fff"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {idx + 1}
            </text>

            {/* Phase name */}
            <text
              x={badgeX + BADGE_R + 6} y={badgeY + 1}
              dominantBaseline="middle" fontSize={11} fontWeight={600}
              fill={phase.color} fillOpacity={isGhosted ? 0.1 : 0.9}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {phase.name}
            </text>

            {/* Collapse button (◀) */}
            <text
              x={maxX - 14} y={badgeY + 1}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={10} fill={phase.color} fillOpacity={isGhosted ? 0.1 : 0.7}
              style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={(e) => { e.stopPropagation(); onToggleCollapse(phase.id); }}
            >
              ◀
            </text>
          </g>
        );
      })}
    </>
  );
}
