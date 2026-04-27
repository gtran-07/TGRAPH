import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useGraphStore } from '../../store/graphStore';
import { useSummonMode, type FilteredNode } from './useSummonMode';
import styles from './SummonDock.module.css';

const BADGE_LABEL: Record<NonNullable<FilteredNode['badge']>, string> = {
  likely: '✦',
  upstream: '↑',
  downstream: '↓',
};

export function SummonDock(): React.ReactElement | null {
  const summonActive = useGraphStore(s => s.summonActive);
  const summonFilter = useGraphStore(s => s.summonFilter);
  const setSummonFilter = useGraphStore(s => s.setSummonFilter);
  const deactivateSummon = useGraphStore(s => s.deactivateSummon);
  const toggleSummonRing = useGraphStore(s => s.toggleSummonRing);

  const { ownerGroups, totalCount, filteredCount, showRingButton, connectToSource } = useSummonMode();

  const dockRef = useRef<HTMLDivElement>(null);
  const [expandedOwners, setExpandedOwners] = useState<Set<string>>(new Set());

  // Entry animation: double rAF to guarantee layout before adding .visible
  useEffect(() => {
    if (!summonActive || !dockRef.current) return;
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        dockRef.current?.classList.add(styles.visible);
      });
    });
    return () => cancelAnimationFrame(outer);
  }, [summonActive]);

  // Expand all owner groups at the start of each summon session
  useEffect(() => {
    if (summonActive) {
      setExpandedOwners(new Set(ownerGroups.map(g => g.owner)));
    }
  }, [summonActive]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!summonActive) return null;

  const toggleOwner = (owner: string) => {
    setExpandedOwners(prev => {
      const next = new Set(prev);
      if (next.has(owner)) next.delete(owner);
      else next.add(owner);
      return next;
    });
  };

  const content = (
    <div ref={dockRef} className={styles.dock}>
      <div className={styles.header}>
        <span>⚡ SUMMON</span>
        <span style={{ fontSize: 12, color: '#888', fontWeight: 400 }}>{filteredCount} / {totalCount}</span>
      </div>

      <div className={styles.searchWrap}>
        <input
          className={styles.searchInput}
          autoFocus
          placeholder="Search nodes…"
          value={summonFilter}
          onChange={e => setSummonFilter(e.target.value)}
        />
      </div>

      <div className={styles.list}>
        {ownerGroups.map(group => {
          const isOpen = expandedOwners.has(group.owner);
          return (
            <React.Fragment key={group.owner}>
              <div className={styles.ownerHeader} onClick={() => toggleOwner(group.owner)}>
                <span className={`${styles.chevron}${isOpen ? ` ${styles.chevronOpen}` : ''}`}>▶</span>
                <span className={styles.colorDot} style={{ background: group.color }} />
                <span>{group.owner}</span>
                <span className={styles.countBadge}>{group.nodes.length}</span>
              </div>
              {isOpen && group.nodes.map(node => (
                <div
                  key={node.id}
                  className={styles.nodeRow}
                  style={{ borderLeftColor: group.color }}
                  onClick={() => connectToSource(node.id)}
                >
                  {node.connected && <span className={styles.connectedCheck}>✓</span>}
                  <span className={styles.nodeLabel}>{node.label}</span>
                  {node.badge && <span className={styles.badge}>{BADGE_LABEL[node.badge]}</span>}
                </div>
              ))}
            </React.Fragment>
          );
        })}
      </div>

      <div className={styles.footer}>
        {showRingButton && (
          <button className={styles.ringButton} onClick={toggleSummonRing}>
            Show on ring ✨
          </button>
        )}
        <button className={styles.doneButton} onClick={deactivateSummon}>
          Done ✓
        </button>
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
