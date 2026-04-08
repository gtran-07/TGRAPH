/**
 * components/Canvas/PhaseCrowns.tsx — Sticky phase context bars at the canvas top edge.
 *
 * Appears only when a phase band's header strip has scrolled above the viewport top.
 * Each crown is a DOM overlay (not SVG) pinned to the top of #canvas-wrap, horizontally
 * aligned to match the visible portion of the phase band on screen.
 *
 * Read-only / informational — no click interaction.
 */

import React from 'react';
import type { GraphPhase, Position } from '../../types/graph';
import type { Transform } from '../../types/graph';
import { NODE_W } from '../../utils/layout';

const PHASE_PAD_X = 30; // must match PhaseLayer
const HEADER_H = 32;    // must match PhaseLayer
const BADGE_R = 10;
const CROWN_H = 24;

interface CrownBand {
  phase: GraphPhase;
  idx: number;   // 1-based sequence index for badge label
  minX: number;  // SVG-space left edge of band
  maxX: number;  // SVG-space right edge of band
}

interface PhaseCrownsProps {
  bands: CrownBand[];
  transform: Transform;
  canvasWidth: number;
}

export type { CrownBand };

export function PhaseCrowns({ bands, transform, canvasWidth }: PhaseCrownsProps) {
  if (bands.length === 0) return null;

  // Header strip bottom in pixel space: transform.y + HEADER_H * k
  // Crown shows when the header has fully scrolled above the top (< 0)
  const headerPixelBottom = transform.y + HEADER_H * transform.k;
  const headerOutOfView = headerPixelBottom < 0;

  if (!headerOutOfView) return null;

  const crowns: React.ReactElement[] = [];

  for (const { phase, idx, minX, maxX } of bands) {
    const pixelLeft  = transform.x + minX * transform.k;
    const pixelRight = transform.x + maxX * transform.k;

    // Clamp to canvas bounds
    const clampedLeft  = Math.max(0, pixelLeft);
    const clampedRight = Math.min(canvasWidth, pixelRight);

    // Skip if entirely off screen horizontally
    if (clampedRight <= clampedLeft) continue;

    const width = clampedRight - clampedLeft;

    crowns.push(
      <div
        key={phase.id}
        style={{
          position: 'absolute',
          top: 0,
          left: clampedLeft,
          width,
          height: CROWN_H,
          background: phase.color,
          opacity: 0.82,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          paddingLeft: 8,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 15,
          borderBottom: `1.5px solid ${phase.color}`,
          boxSizing: 'border-box',
        }}
      >
        {/* Badge circle */}
        <svg
          width={BADGE_R * 2}
          height={BADGE_R * 2}
          style={{ flexShrink: 0 }}
        >
          <circle
            cx={BADGE_R}
            cy={BADGE_R}
            r={BADGE_R - 1}
            fill="rgba(255,255,255,0.25)"
          />
          <text
            x={BADGE_R}
            y={BADGE_R + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={8}
            fontWeight={700}
            fill="#fff"
          >
            {idx}
          </text>
        </svg>

        {/* Phase name */}
        <span
          style={{
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.03em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {phase.name}
        </span>
      </div>
    );
  }

  if (crowns.length === 0) return null;

  return <>{crowns}</>;
}
