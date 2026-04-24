import React, { useLayoutEffect, useRef } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useSummonMode } from './useSummonMode';
import { NODE_W, NODE_H } from '../../utils/layout';
import styles from './GhostRing.module.css';

const RING_RADIUS = 250;
const CARD_W = 140;
const CARD_H = 36;

export function GhostRing(): React.ReactElement | null {
  const summonSourceId = useGraphStore(s => s.summonSourceId);
  const positions = useGraphStore(s => s.positions);
  const summonConnected = useGraphStore(s => s.summonConnected);
  const { ghostRingNodes, connectToSource } = useSummonMode();

  const ghostRefs = useRef<(SVGGElement | null)[]>([]);
  const tetherRefs = useRef<(SVGLineElement | null)[]>([]);

  useLayoutEffect(() => {
    const rafs: number[] = [];
    ghostRefs.current.forEach((el, i) => {
      if (!el) return;
      el.style.setProperty('--stagger', `${i * 50}ms`);
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
  const sourcePos = positions[summonSourceId];
  if (!sourcePos) return null;

  const srcCx = sourcePos.x + NODE_W / 2;
  const srcCy = sourcePos.y + NODE_H / 2;
  const n = ghostRingNodes.length;

  return (
    <>
      {ghostRingNodes.map((node, i) => {
        const angle = (2 * Math.PI / n) * i - Math.PI / 2;
        const gx = srcCx + RING_RADIUS * Math.cos(angle);
        const gy = srcCy + RING_RADIUS * Math.sin(angle);
        const tx = gx - CARD_W / 2;
        const ty = gy - CARD_H / 2;
        // Tether endpoints in local space (origin = tx, ty)
        const lx1 = srcCx - tx;
        const ly1 = srcCy - ty;
        const isConnected = summonConnected.has(node.id);
        const truncated = node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label;

        const handleClick = () => {
          connectToSource(node.id);
          const tether = tetherRefs.current[i];
          if (tether) {
            tether.classList.add(styles.tetherFlash);
            setTimeout(() => tether?.classList.remove(styles.tetherFlash), 300);
          }
        };

        const handleMouseEnter = () => {
          const el = ghostRefs.current[i];
          if (el) el.style.transform = 'scale(1.05)';
          const tether = tetherRefs.current[i];
          if (tether) tether.style.strokeOpacity = '0.6';
        };

        const handleMouseLeave = () => {
          const el = ghostRefs.current[i];
          if (el) el.style.transform = '';
          const tether = tetherRefs.current[i];
          if (tether) tether.style.strokeOpacity = '';
        };

        return (
          <g key={node.id} transform={`translate(${tx}, ${ty})`}>
            <line
              ref={el => { tetherRefs.current[i] = el; }}
              x1={lx1} y1={ly1}
              x2={CARD_W / 2} y2={CARD_H / 2}
              stroke={node.color}
              strokeOpacity={0.3}
              strokeWidth={1}
            />
            <g
              ref={el => { ghostRefs.current[i] = el; }}
              className={styles.ghost}
              onClick={handleClick}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <rect width={CARD_W} height={CARD_H} rx={8} fill="var(--summon-ghost-bg)" />
              <rect width={3} height={CARD_H} rx={2} fill={node.color} />
              <text x={10} y={22} fontSize={12} fill="#d0d0d0">{truncated}</text>
              {isConnected && (
                <text
                  x={CARD_W - 18}
                  y={22}
                  fontSize={14}
                  fill="#4caf50"
                  style={{ animation: 'summon-check-bounce 200ms ease-out' }}
                >✓</text>
              )}
            </g>
          </g>
        );
      })}
    </>
  );
}
