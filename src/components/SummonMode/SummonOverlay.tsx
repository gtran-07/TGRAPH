import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

export function SummonOverlay(): React.ReactElement {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let inner: number;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (divRef.current) divRef.current.style.opacity = '1';
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  return ReactDOM.createPortal(
    <div
      ref={divRef}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--summon-overlay)',
        zIndex: 100,
        pointerEvents: 'none',
        opacity: 0,
        transition: 'opacity 200ms ease-out',
      }}
    />,
    document.body
  );
}
