import React, { useLayoutEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useGraphStore } from '../../store/graphStore';
import { useSummonMode } from './useSummonMode';
import { NODE_W, NODE_H } from '../../utils/layout';
import styles from './GhostRing.module.css';

const RING_RADIUS_MIN = 250; // SVG user-space — minimum when few nodes

/** Compute ring radius so adjacent cards never overlap regardless of node count. */
function ringRadius(n: number): number {
  // Each card occupies NODE_W user-space units along the arc; 1.4× padding between centers.
  const minBySpacing = (NODE_W * 1.4 * n) / (2 * Math.PI);
  return Math.max(RING_RADIUS_MIN, minBySpacing);
}

export function GhostRing(): React.ReactElement | null {
  const summonSourceId = useGraphStore(s => s.summonSourceId);
  const positions = useGraphStore(s => s.positions);
  const transform = useGraphStore(s => s.transform);
  const summonConnected = useGraphStore(s => s.summonConnected);
  const { ghostRingNodes, connectToSource } = useSummonMode();

  // posRefs: outer <g> — receives imperative SVG transform (translate + scale)
  // animRefs: inner <g> — CSS entrance animation only (no SVG transform, avoids CSS/SVG conflict)
  const posRefs = useRef<(SVGGElement | null)[]>([]);
  const animRefs = useRef<(SVGGElement | null)[]>([]);
  const tetherRefs = useRef<(SVGLineElement | null)[]>([]);
  const orbitRef = useRef<SVGCircleElement | null>(null);

  useLayoutEffect(() => {
    if (!summonSourceId) return;
    const sourcePos = positions[summonSourceId];
    if (!sourcePos) return;

    const { x: tx, y: ty, k } = transform;

    // Coordinates relative to canvas-wrap — no viewport offset needed
    const srcCx = (sourcePos.x + NODE_W / 2) * k + tx;
    const srcCy = (sourcePos.y + NODE_H / 2) * k + ty;
    const n = ghostRingNodes.length;
    const ringR = ringRadius(n) * k;

    if (orbitRef.current) {
      orbitRef.current.setAttribute('cx', String(srcCx));
      orbitRef.current.setAttribute('cy', String(srcCy));
      orbitRef.current.setAttribute('r', String(ringR));
    }

    ghostRingNodes.forEach((_, i) => {
      const angle = (2 * Math.PI / n) * i - Math.PI / 2;
      const gx = srcCx + ringR * Math.cos(angle);
      const gy = srcCy + ringR * Math.sin(angle);

      const tether = tetherRefs.current[i];
      if (tether) {
        tether.setAttribute('x1', String(srcCx));
        tether.setAttribute('y1', String(srcCy));
        tether.setAttribute('x2', String(gx));
        tether.setAttribute('y2', String(gy));
      }

      // Cards are authored in user-space (NODE_W × NODE_H) then scaled by k so they
      // match the exact screen footprint of a real node at the current zoom level.
      const pos = posRefs.current[i];
      if (pos) {
        pos.setAttribute(
          'transform',
          `translate(${gx - (NODE_W / 2) * k}, ${gy - (NODE_H / 2) * k}) scale(${k})`
        );
      }
    });
  }, [summonSourceId, positions, transform, ghostRingNodes.length]);

  // Entrance stagger on inner animated <g> elements
  useLayoutEffect(() => {
    const rafs: number[] = [];
    animRefs.current.forEach((el, i) => {
      if (!el) return;
      el.style.setProperty('--stagger', `${i * 55}ms`);
      el.classList.remove(styles.ghostVisible);
      const outer = requestAnimationFrame(() => {
        const inner = requestAnimationFrame(() => {
          el.classList.add(styles.ghostVisible);
        });
        rafs.push(inner);
      });
      rafs.push(outer);
    });
    return () => rafs.forEach(cancelAnimationFrame);
  }, [ghostRingNodes.length]);

  if (!summonSourceId || !ghostRingNodes.length) return null;
  if (!positions[summonSourceId]) return null;

  const canvasWrap = document.getElementById('canvas-wrap');
  if (!canvasWrap) return null;

  return ReactDOM.createPortal(
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 122,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      {/* Faint orbit guide */}
      <circle
        ref={orbitRef}
        cx={0} cy={0} r={0}
        fill="none"
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={1}
        strokeDasharray="6 10"
      />

      {/* Tethers */}
      {ghostRingNodes.map((node, i) => (
        <line
          key={`tether-${node.id}`}
          ref={el => { tetherRefs.current[i] = el; }}
          x1={0} y1={0} x2={0} y2={0}
          stroke={node.color}
          strokeOpacity={0.45}
          strokeWidth={1.5}
        />
      ))}

      {/* Ghost cards — outer <g> positions in screen-space, inner <g> animates */}
      {ghostRingNodes.map((node, i) => {
        const isConnected = summonConnected.has(node.id);
        const truncated = node.label.length > 20 ? node.label.slice(0, 19) + '…' : node.label;

        const handleClick = () => {
          connectToSource(node.id);
          const tether = tetherRefs.current[i];
          if (tether) {
            tether.classList.add(styles.tetherFlash);
            setTimeout(() => tether?.classList.remove(styles.tetherFlash), 300);
          }
        };

        return (
          <g
            key={node.id}
            ref={el => { posRefs.current[i] = el; }}
          >
            <g
              ref={el => { animRefs.current[i] = el; }}
              className={styles.ghost}
              style={{ '--card-color': node.color, pointerEvents: 'all', cursor: 'pointer' } as React.CSSProperties}
              onClick={handleClick}
            >
              {/* Glow halo — slightly larger than card, pulses */}
              <rect
                x={-6} y={-5}
                width={NODE_W + 12} height={NODE_H + 10}
                rx={10}
                fill={node.color}
                fillOpacity={0.07}
                className={styles.cardHalo}
              />
              {/* Card body — exactly NODE_W × NODE_H, matching canvas nodes */}
              <rect width={NODE_W} height={NODE_H} rx={6} fill="var(--summon-ghost-bg)" />
              {/* Color accent bar */}
              <rect width={4} height={NODE_H} rx={2} fill={node.color} />
              <text x={14} y={NODE_H / 2 + 5} fontSize={13} fontWeight={500} fill="#d8d8d8">{truncated}</text>
              {isConnected && (
                <text
                  x={NODE_W - 22}
                  y={NODE_H / 2 + 5}
                  fontSize={15}
                  fill="#4caf50"
                  style={{ animation: 'summon-check-bounce 200ms ease-out' }}
                >✓</text>
              )}
            </g>
          </g>
        );
      })}
    </svg>,
    canvasWrap
  );
}
