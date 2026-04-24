/**
 * PathTypePopover — small floating panel for assigning a path type to a clicked edge.
 *
 * Appears at cursor position when the user clicks an edge in 'select' design tool mode.
 * Renders via a React portal into document.body to escape SVG overflow clipping.
 *
 * Each row: colored thickness chip (SVG preview) + path type label + checkmark if current.
 * Click outside or ESC closes without changing the edge.
 */

import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import type { GraphEdge, PathType } from '../../types/graph';
import styles from './PathTypePopover.module.css';

interface PathTypePopoverProps {
  edge: GraphEdge;
  position: { x: number; y: number }; // client coordinates (mouse position)
  currentType: PathType;
  onSelect: (type: PathType) => void;
  onClose: () => void;
}

const PATH_TYPE_OPTIONS: Array<{
  type: PathType;
  label: string;
  grooveW: number;
  hlW: number;
  hlOpacity: number;
}> = [
  { type: 'critical', label: 'Critical', grooveW: 7,   hlW: 3,   hlOpacity: 0.25 },
  { type: 'priority', label: 'Priority', grooveW: 4.5, hlW: 2,   hlOpacity: 0.22 },
  { type: 'standard', label: 'Standard', grooveW: 3.5, hlW: 1.5, hlOpacity: 0.18 },
  { type: 'optional', label: 'Optional', grooveW: 2.5, hlW: 1,   hlOpacity: 0.15 },
];

export function PathTypePopover({ edge, position, currentType, onSelect, onClose }: PathTypePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleOutside);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [onClose]);

  // Adjust position so the popover stays within the viewport
  const popoverWidth = 200;
  const popoverHeight = 180;
  const safeX = Math.min(position.x + 12, window.innerWidth - popoverWidth - 8);
  const safeY = Math.min(position.y, window.innerHeight - popoverHeight - 8);

  const content = (
    <div
      ref={ref}
      className={styles.popover}
      style={{ left: safeX, top: safeY }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.header}>Edge Path Type</div>
      {PATH_TYPE_OPTIONS.map(({ type, label, grooveW, hlW, hlOpacity }) => (
        <button
          key={type}
          className={`${styles.row} ${currentType === type ? styles.rowActive : ''}`}
          onClick={() => { onSelect(type); onClose(); }}
        >
          {/* V-Groove chip: groove + highlight preview */}
          <svg width={36} height={16} style={{ flexShrink: 0 }}>
            <line x1={4} y1={9} x2={32} y2={9} stroke="var(--accent)" strokeWidth={Math.min(grooveW, 7)} strokeLinecap="round" />
            <line x1={2.5} y1={10.5} x2={30.5} y2={10.5} stroke={`rgba(255,255,255,${hlOpacity})`} strokeWidth={hlW} strokeLinecap="round" />
          </svg>
          <span className={styles.label}>{label}</span>
          {currentType === type && <span className={styles.check}>✓</span>}
        </button>
      ))}
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
