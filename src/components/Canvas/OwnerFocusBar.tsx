/**
 * components/Canvas/OwnerFocusBar.tsx — Floating status bar for Owner Focus Mode.
 *
 * Appears above the PhaseNavigator pill bar when an owner lane is focused.
 * Shows the focused owner name, upstream/downstream node counts, hidden lane count,
 * and an Exit button to leave focus mode.
 */

import React from 'react';
import styles from './OwnerFocusBar.module.css';

interface OwnerFocusBarProps {
  focusedOwner: string;
  ownerColor: string;
  upstreamCount: number;
  downstreamCount: number;
  hiddenLaneCount: number;
  onExit: () => void;
}

export function OwnerFocusBar({
  focusedOwner,
  ownerColor,
  upstreamCount,
  downstreamCount,
  hiddenLaneCount,
  onExit,
}: OwnerFocusBarProps) {
  return (
    <div className={styles.bar}>
      <span className={styles.dot} style={{ background: ownerColor }} />
      <span className={styles.modeLabel}>Owner Focus</span>
      <span className={styles.separator}>·</span>
      <span className={styles.ownerName}>{focusedOwner}</span>

      {upstreamCount > 0 && (
        <span className={styles.stat} style={{ color: '#4f9eff' }}>
          · {upstreamCount} upstream ⬆
        </span>
      )}
      {downstreamCount > 0 && (
        <span className={styles.stat} style={{ color: '#f5a623' }}>
          · {downstreamCount} downstream ⬇
        </span>
      )}
      {hiddenLaneCount > 0 && (
        <span className={styles.stat}>
          · {hiddenLaneCount} lane{hiddenLaneCount !== 1 ? 's' : ''} hidden
        </span>
      )}

      <button className={styles.exitBtn} onClick={onExit} title="Exit Lane Focus (Escape)">
        × Exit
      </button>
    </div>
  );
}
