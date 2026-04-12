/**
 * components/Canvas/PhaseHoverCard.tsx — Hover card for collapsed phase strips.
 *
 * DOM overlay that appears when the user hovers over a collapsed phase strip.
 * Shows a quick bird's-eye summary: name, node + group counts, owner breakdown,
 * and the first few node names. No click needed — info is immediate on hover.
 */

import React, { useMemo } from 'react';
import type { GraphPhase, GraphNode, GraphGroup } from '../../types/graph';

const CARD_W = 220;
const MAX_NODES_SHOWN = 5;

interface PhaseHoverCardProps {
  phase: GraphPhase;
  allNodes: GraphNode[];
  groups: GraphGroup[];
  /** Client-space coordinates of the mouse when hovering started */
  clientX: number;
  clientY: number;
  /** Bounding rect of #canvas-wrap so we can compute relative position */
  canvasRect: DOMRect;
  /** True while the card is animating out before unmount */
  isHiding: boolean;
  onExpand: () => void;
}

export function PhaseHoverCard({
  phase,
  allNodes,
  groups,
  clientX,
  clientY,
  canvasRect,
  isHiding,
  onExpand,
}: PhaseHoverCardProps) {
  // Build owner breakdown from node IDs
  const { ownerCounts, listedNodes, extraCount } = useMemo(() => {
    const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
    const counts: Record<string, number> = {};
    const listed: { id: string; name: string }[] = [];

    phase.nodeIds.forEach((nid) => {
      const node = nodeMap.get(nid);
      if (!node) return;
      counts[node.owner] = (counts[node.owner] ?? 0) + 1;
      if (listed.length < MAX_NODES_SHOWN) listed.push({ id: nid, name: node.name });
    });

    return {
      ownerCounts: Object.entries(counts).sort((a, b) => b[1] - a[1]),
      listedNodes: listed,
      extraCount: Math.max(0, phase.nodeIds.length - MAX_NODES_SHOWN),
    };
  }, [phase, allNodes]);

  const groupCount = (phase.groupIds ?? []).length;
  const nodeCount = phase.nodeIds.length;

  // Position relative to canvas-wrap, anchored below+right of cursor.
  // Flip left if too close to right edge; flip up if too close to bottom.
  let left = clientX - canvasRect.left + 14;
  let top  = clientY - canvasRect.top  + 14;

  if (left + CARD_W > canvasRect.width - 8)  left = clientX - canvasRect.left - CARD_W - 14;
  if (left < 4) left = 4;
  // Rough card height estimate for bottom-flip (header 32 + counts 20 + owners + nodes)
  const estH = 80 + ownerCounts.length * 20 + listedNodes.length * 18 + 10;
  if (top + estH > canvasRect.height - 8) top = clientY - canvasRect.top - estH - 14;
  if (top < 4) top = 4;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: CARD_W,
        background: '#1a2035',
        border: `1.5px solid ${phase.color}`,
        borderRadius: 8,
        boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
        zIndex: 200,
        overflow: 'hidden',
        pointerEvents: 'none',
        fontFamily: 'var(--font-mono)',
        animation: isHiding
          ? 'phaseCardOut 0.15s ease-in forwards'
          : 'phaseCardIn 0.18s ease-out forwards',
        transformOrigin: 'top left',
      }}
    >
      {/* Header strip */}
      <div
        style={{
          background: phase.color,
          padding: '7px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: '#fff',
            letterSpacing: '0.04em',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {phase.name}
        </span>
        {/* Expand hint — not interactive (pointerEvents: none on card) */}
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', flexShrink: 0 }}>
          dbl-click ▶
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Counts row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 600 }}>
            <span style={{ color: phase.color }}>{nodeCount}</span> node{nodeCount !== 1 ? 's' : ''}
          </span>
          {groupCount > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 600 }}>
              <span style={{ color: phase.color }}>{groupCount}</span> group{groupCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Owner breakdown */}
        {ownerCounts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {ownerCounts.map(([owner, count]) => (
              <div key={owner} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: phase.color,
                    opacity: 0.7,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text2)',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {owner}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Node list */}
        {listedNodes.length > 0 && (
          <div style={{ borderTop: '1px solid #252d3e', marginTop: 2, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {listedNodes.map(({ id, name }) => (
              <div
                key={id}
                style={{
                  fontSize: 10,
                  color: 'var(--text3)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ color: 'var(--text3)', opacity: 0.6, marginRight: 4 }}>{id}</span>
                {name}
              </div>
            ))}
            {extraCount > 0 && (
              <div style={{ fontSize: 10, color: 'var(--text3)', opacity: 0.6 }}>
                +{extraCount} more
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
