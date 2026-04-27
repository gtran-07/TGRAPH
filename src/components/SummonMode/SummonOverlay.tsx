import React, { useLayoutEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useGraphStore } from '../../store/graphStore';
import { NODE_W, NODE_H } from '../../utils/layout';

const RING_PAD = 10;
const HW = NODE_W / 2 + RING_PAD;
const HH = NODE_H / 2 + RING_PAD;

export function SummonOverlay(): React.ReactElement {
  const summonSourceIds = useGraphStore(s => s.summonSourceIds);
  const positions = useGraphStore(s => s.positions);
  const transform = useGraphStore(s => s.transform);
  const ownerColors = useGraphStore(s => s.ownerColors);
  const allNodes = useGraphStore(s => s.allNodes);

  const groupRefs = useRef<(SVGGElement | null)[]>([]);

  useLayoutEffect(() => {
    if (summonSourceIds.length === 0) return;
    const { x: tx, y: ty, k } = transform;

    summonSourceIds.forEach((id, i) => {
      const pos = positions[id];
      const g = groupRefs.current[i];
      if (!pos || !g) return;
      // Coordinates relative to canvas-wrap — no viewport offset needed
      const cx = (pos.x + NODE_W / 2) * k + tx;
      const cy = (pos.y + NODE_H / 2) * k + ty;
      g.setAttribute('transform', `translate(${cx}, ${cy}) scale(${k})`);
    });
  }, [summonSourceIds, positions, transform]);

  const canvasWrap = document.getElementById('canvas-wrap');
  if (!canvasWrap) return <></>;

  return (
    <>
      {/* Canvas-only glass dim — portalled into #canvas-wrap, stays behind header/sidebar */}
      {ReactDOM.createPortal(
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(8,10,16,0.62)',
            backdropFilter: 'blur(1px)',
            zIndex: 120,
            pointerEvents: 'none',
          }}
        />,
        canvasWrap
      )}

      {/* Source node spotlight rings — portalled into #canvas-wrap */}
      {summonSourceIds.length > 0 && ReactDOM.createPortal(
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            zIndex: 121,
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          {summonSourceIds.map((id, i) => {
            const node = allNodes.find(n => n.id === id);
            const color = node ? (ownerColors[node.owner] ?? 'rgba(79,158,255,0.9)') : 'rgba(79,158,255,0.9)';
            const rawLabel = node?.name ?? '';
            const truncated = rawLabel.length > 22 ? rawLabel.slice(0, 21) + '…' : rawLabel;
            return (
              <g key={id} ref={el => { groupRefs.current[i] = el; }}>
                {/* Wide soft bloom */}
                <rect
                  x={-HW - 20} y={-HH - 20}
                  width={(HW + 20) * 2} height={(HH + 20) * 2}
                  rx={18}
                  fill={color}
                  fillOpacity={0.25}
                  style={{ filter: 'blur(18px)' }}
                />
                {/* Mid glow halo */}
                <rect
                  x={-HW - 6} y={-HH - 6}
                  width={(HW + 6) * 2} height={(HH + 6) * 2}
                  rx={12}
                  fill={color}
                  fillOpacity={0.18}
                  style={{ filter: 'blur(8px)' }}
                />
                {/* Node card replica — rendered above the dim so the origin is readable */}
                <rect
                  x={-NODE_W / 2} y={-NODE_H / 2}
                  width={NODE_W} height={NODE_H}
                  rx={6}
                  fill="var(--summon-ghost-bg)"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={0.5}
                />
                {/* Color accent bar */}
                <rect
                  x={-NODE_W / 2} y={-NODE_H / 2}
                  width={4} height={NODE_H}
                  rx={2}
                  fill={color}
                />
                {/* Node label */}
                <text
                  x={-NODE_W / 2 + 14}
                  y={5}
                  fontSize={13}
                  fontWeight={500}
                  fill="#e8e8e8"
                >{truncated}</text>
                {/* ORIGIN badge below the card */}
                <text
                  x={0}
                  y={NODE_H / 2 + 18}
                  fontSize={10}
                  fontWeight={700}
                  fill={color}
                  textAnchor="middle"
                  letterSpacing={1.5}
                  fillOpacity={0.85}
                >ORIGIN</text>
                {/* Solid glowing border */}
                <rect
                  x={-HW} y={-HH}
                  width={HW * 2} height={HH * 2}
                  rx={9}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.5}
                  style={{ filter: `drop-shadow(0 0 14px ${color}) drop-shadow(0 0 6px ${color})` }}
                />
                {/* Outer slow pulse ring */}
                <rect
                  x={-HW} y={-HH}
                  width={HW * 2} height={HH * 2}
                  rx={9}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeOpacity={0.6}
                  style={{
                    transformBox: 'fill-box',
                    transformOrigin: 'center',
                    animation: 'summon-source-pulse 1.6s ease-out infinite',
                  }}
                />
                {/* Inner tight shimmer ring */}
                <rect
                  x={-HW + 4} y={-HH + 4}
                  width={(HW - 4) * 2} height={(HH - 4) * 2}
                  rx={6}
                  fill="none"
                  stroke={color}
                  strokeWidth={1}
                  strokeOpacity={0.4}
                  style={{
                    transformBox: 'fill-box',
                    transformOrigin: 'center',
                    animation: 'summon-source-pulse 1.6s ease-out infinite 0.4s',
                  }}
                />
              </g>
            );
          })}
        </svg>,
        canvasWrap
      )}
    </>
  );
}
