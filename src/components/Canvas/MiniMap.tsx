/**
 * components/Canvas/MiniMap.tsx — Overview map in the bottom-right corner.
 */
import React from 'react';
import { useGraphStore } from '../../store/graphStore';
import { NODE_W, NODE_H } from '../../utils/layout';
import type { GraphNode, Position, Transform } from '../../types/graph';

interface MiniMapProps {
  nodes: GraphNode[];
  positions: Record<string, Position>;
  transform: Transform;
  ownerColors: Record<string, string>;
  canvasRef: React.RefObject<HTMLDivElement>;
}

export function MiniMap({ nodes, positions, transform, ownerColors, canvasRef }: MiniMapProps) {
  const { setTransform, allEdges } = useGraphStore();

  // Precompute degree map for density hint
  const degreeMap = new Map<string, number>();
  for (const edge of allEdges) {
    degreeMap.set(edge.from, (degreeMap.get(edge.from) ?? 0) + 1);
    degreeMap.set(edge.to, (degreeMap.get(edge.to) ?? 0) + 1);
  }
  const MINI_W = 180, MINI_H = 110;
  if (nodes.length === 0) return null;

  const posValues = Object.values(positions);
  if (posValues.length === 0) return null;

  const minX = Math.min(...posValues.map((p) => p.x));
  const maxX = Math.max(...posValues.map((p) => p.x)) + NODE_W;
  const minY = Math.min(...posValues.map((p) => p.y));
  const maxY = Math.max(...posValues.map((p) => p.y)) + NODE_H;
  const graphW = maxX - minX || 1;
  const graphH = maxY - minY || 1;

  const miniScale = Math.min(MINI_W / graphW, MINI_H / graphH) * 0.9;
  const offsetX = (MINI_W - graphW * miniScale) / 2 - minX * miniScale;
  const offsetY = (MINI_H - graphH * miniScale) / 2 - minY * miniScale;

  const canvasW = canvasRef.current?.clientWidth ?? 800;
  const canvasH = canvasRef.current?.clientHeight ?? 600;
  const vpX = (-transform.x / transform.k) * miniScale + offsetX;
  const vpY = (-transform.y / transform.k) * miniScale + offsetY;
  const vpW = (canvasW / transform.k) * miniScale;
  const vpH = (canvasH / transform.k) * miniScale;

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const graphX = (e.clientX - rect.left - offsetX) / miniScale;
    const graphY = (e.clientY - rect.top - offsetY) / miniScale;
    setTransform({ ...transform, x: canvasW / 2 - graphX * transform.k, y: canvasH / 2 - graphY * transform.k });
  }

  return (
    <div style={{ position:'absolute', bottom:16, right:16, width:MINI_W, height:MINI_H,
      background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:6, overflow:'hidden', opacity:0.85, zIndex:50 }}>
      <svg width={MINI_W} height={MINI_H} style={{ cursor:'pointer' }} onClick={handleClick}>
        {nodes.map((node) => {
          const pos = positions[node.id];
          if (!pos) return null;
          const degree = degreeMap.get(node.id) ?? 0;
          const opacity = 0.3 + Math.min(degree / 10, 1) * 0.5;
          return <rect key={node.id} x={pos.x * miniScale + offsetX} y={pos.y * miniScale + offsetY}
            width={Math.max(NODE_W * miniScale, 2)} height={Math.max(NODE_H * miniScale, 2)}
            rx={1} fill={ownerColors[node.owner] ?? 'var(--accent)'} opacity={opacity} />;
        })}
        <rect x={vpX} y={vpY} width={Math.max(vpW, 10)} height={Math.max(vpH, 10)}
          fill="rgba(79,158,255,0.1)" stroke="var(--accent)" strokeWidth={1} />
      </svg>
    </div>
  );
}
