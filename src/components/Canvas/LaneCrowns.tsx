/**
 * components/Canvas/LaneCrowns.tsx — Sticky owner labels on the left canvas edge (LANES view).
 *
 * Mirrors PhaseCrowns: DOM overlay divs pinned to the left of #canvas-wrap whenever the
 * lane label column scrolls off-screen to the left (user pans right or zooms in past x=0).
 * Read-only / informational — no click interaction.
 */

import React from 'react';
import type { GraphNode, LaneMetrics, Transform } from '../../types/graph';

const LABEL_W = 118; // px — matches the visual feel of the SVG lane label column

interface LaneCrownsProps {
  nodes: GraphNode[];
  laneMetrics: Record<string, LaneMetrics>;
  ownerColors: Record<string, string>;
  transform: Transform;
  canvasHeight: number;
}

export function LaneCrowns({ nodes, laneMetrics, ownerColors, transform, canvasHeight }: LaneCrownsProps) {
  if (nodes.length === 0) return null;

  // Lane labels sit at x=0 in SVG-space. Once the canvas origin has scrolled past
  // the left edge (transform.x < 0) the labels are no longer visible — show crowns.
  if (transform.x >= 0) return null;

  // Derive owner order the same way LaneLayer does
  const ownerOrder: string[] = [];
  nodes.forEach((node) => {
    if (!ownerOrder.includes(node.owner)) ownerOrder.push(node.owner);
  });

  const crowns: React.ReactElement[] = [];

  for (let i = 0; i < ownerOrder.length; i++) {
    const owner = ownerOrder[i];
    const metrics = laneMetrics[owner];
    if (!metrics) continue;

    const color = ownerColors[owner] ?? '#4f9eff';
    const isEven = i % 2 === 0;

    // Convert SVG-space lane bounds to pixel-space
    const pixelTop    = transform.y + metrics.y * transform.k;
    const pixelBottom = transform.y + (metrics.y + metrics.height) * transform.k;

    // Clamp to visible canvas area
    const clampedTop    = Math.max(0, pixelTop);
    const clampedBottom = Math.min(canvasHeight, pixelBottom);
    if (clampedBottom <= clampedTop) continue;

    const height = clampedBottom - clampedTop;

    crowns.push(
      <div
        key={owner}
        style={{
          position: 'absolute',
          top: clampedTop,
          left: 0,
          width: LABEL_W,
          height,
          background: isEven ? 'rgba(20,24,36,0.90)' : 'rgba(12,16,28,0.93)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: 8,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 12,
          boxSizing: 'border-box',
          borderRight: '1px solid var(--border)',
        }}
      >
        {/* Colored accent bar — mirrors the 3px rect in LaneLayer */}
        <div
          style={{
            width: 3,
            height: Math.min(height - 8, 36),
            borderRadius: 2,
            background: color,
            opacity: 0.7,
            flexShrink: 0,
          }}
        />
        {/* Owner name */}
        <span
          style={{
            color,
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            opacity: 0.85,
          }}
        >
          {owner}
        </span>
      </div>
    );
  }

  if (crowns.length === 0) return null;

  return <>{crowns}</>;
}
