import React, { useEffect, useRef } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { NODE_W, NODE_H } from '../../utils/layout';

function animateCircle(circle: SVGCircleElement, delayMs: number): void {
  // Animates r (10→60) and opacity (0.8→0) via rAF — more reliable than CSS @keyframes
  // for SVG geometry attributes across browsers (SVG r is not a CSS property in SVG 1.1).
  const startTime = performance.now() + delayMs;
  const duration = 500;
  const rStart = 10;
  const rEnd = 60;

  function step(now: number) {
    const elapsed = now - startTime;
    if (elapsed < 0) {
      requestAnimationFrame(step);
      return;
    }
    const t = Math.min(elapsed / duration, 1);
    circle.setAttribute('r', String(rStart + (rEnd - rStart) * t));
    circle.setAttribute('opacity', String(0.8 * (1 - t)));
    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

export function CanvasPing(): React.ReactElement | null {
  const target = useGraphStore(s => s.summonPingTarget);
  const setSummonPingTarget = useGraphStore(s => s.setSummonPingTarget);
  const circle1Ref = useRef<SVGCircleElement>(null);
  const circle2Ref = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (!target) return;
    if (circle1Ref.current) animateCircle(circle1Ref.current, 0);
    if (circle2Ref.current) animateCircle(circle2Ref.current, 150);
    const timer = setTimeout(() => setSummonPingTarget(null), 650);
    return () => clearTimeout(timer);
  }, [target, setSummonPingTarget]);

  if (!target) return null;

  const cx = target.x + NODE_W / 2;
  const cy = target.y + NODE_H / 2;

  return (
    <>
      <circle ref={circle1Ref} cx={cx} cy={cy} r={10} stroke={target.color} strokeWidth={2} fill="none" opacity={0.8} />
      <circle ref={circle2Ref} cx={cx} cy={cy} r={10} stroke={target.color} strokeWidth={2} fill="none" opacity={0.8} />
    </>
  );
}
