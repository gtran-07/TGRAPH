/**
 * components/Canvas/PhaseNavigator.tsx — Floating pill bar at the bottom of the canvas.
 *
 * Shows "All" + one pill per phase. Clicking a pill spotlights that phase on the canvas
 * (other bands ghost to near-invisible). Clicking "All" removes the spotlight.
 *
 * Auto-hides when no phases exist. Design-mode only: shows a "+" quick-create pill.
 */

import React from 'react';
import type { GraphPhase } from '../../types/graph';
import styles from './PhaseNavigator.module.css';

interface PhaseNavigatorProps {
  phases: GraphPhase[];
  focusedPhaseId: string | null;
  designMode: boolean;
  inViewportPhaseIds: Set<string>;
  collapsedPhaseIds: string[];
  onFocusPhase: (id: string | null) => void;
  onCreatePhase: () => void;
  onToggleCollapse: (id: string) => void;
}

export function PhaseNavigator({
  phases,
  focusedPhaseId,
  designMode,
  inViewportPhaseIds,
  collapsedPhaseIds,
  onFocusPhase,
  onCreatePhase,
  onToggleCollapse,
}: PhaseNavigatorProps) {
  if (phases.length === 0 && !designMode) return null;
  if (phases.length === 0 && designMode) {
    // Show only the "+" pill so the user can create the first phase
    return (
      <div className={styles.navigator}>
        <button
          className={styles.pillAdd}
          onClick={onCreatePhase}
          title="Create a new phase"
        >
          + Phase
        </button>
      </div>
    );
  }

  const sorted = [...phases].sort((a, b) => a.sequence - b.sequence);
  const collapsedSet = new Set(collapsedPhaseIds);

  return (
    <div className={styles.navigator}>
      {/* "All" pill */}
      <button
        className={`${styles.pill} ${focusedPhaseId === null ? styles.pillActive : ''}`}
        onClick={() => onFocusPhase(null)}
        title="Show all phases"
      >
        All
      </button>

      {/* One pill per phase */}
      {sorted.map((phase) => {
        const isActive = focusedPhaseId === phase.id;
        const isCollapsed = collapsedSet.has(phase.id);
        const nodeCount = phase.nodeIds.length;
        const isLive = inViewportPhaseIds.has(phase.id);
        return (
          <button
            key={phase.id}
            className={`${styles.pill} ${isActive ? styles.pillActive : ''}`}
            onClick={() => onFocusPhase(isActive ? null : phase.id)}
            title={`${phase.name} — ${nodeCount} node${nodeCount !== 1 ? 's' : ''}${isCollapsed ? ' (collapsed)' : ''}`}
            style={isActive
              ? { background: phase.color, borderColor: phase.color, color: '#fff', opacity: isCollapsed ? 0.65 : 1 }
              : { borderColor: phase.color, color: phase.color, opacity: isCollapsed ? 0.65 : 1 }}
          >
            <span
              className={styles.dot}
              style={{ background: isActive ? 'rgba(255,255,255,0.7)' : phase.color }}
            />
            {isCollapsed && <span style={{ marginRight: 3, fontSize: 9 }}>⟨</span>}
            {phase.name}
            {isLive && (
              <span
                className={styles.liveDot}
                style={{ background: isActive ? 'rgba(255,255,255,0.8)' : phase.color }}
              />
            )}
            {/* Collapse toggle — stops propagation so it doesn't trigger spotlight */}
            <span
              title={isCollapsed ? 'Expand phase' : 'Collapse phase'}
              style={{
                marginLeft: 4,
                fontSize: 9,
                opacity: 0.7,
                cursor: 'pointer',
                lineHeight: 1,
              }}
              onClick={(e) => { e.stopPropagation(); onToggleCollapse(phase.id); }}
            >
              {isCollapsed ? '▶' : '◀'}
            </span>
          </button>
        );
      })}

      {/* "+" quick-create (design mode only) */}
      {designMode && (
        <button
          className={styles.pillAdd}
          onClick={onCreatePhase}
          title="Create a new phase"
        >
          +
        </button>
      )}
    </div>
  );
}
