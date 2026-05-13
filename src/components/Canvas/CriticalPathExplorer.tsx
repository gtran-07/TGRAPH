/**
 * CriticalPathExplorer.tsx — Side panel for exploring user-designated critical paths.
 *
 * Three views:
 *  Browse  — cards for each chain; radio (single) or checkbox (compare) selection
 *  Walk    — step-by-step navigation through a single chain with auto-pan
 *  Compare — two or more chains overlaid; shared bottleneck nodes highlighted
 */

import React, { useCallback, useState } from 'react';
import ReactDOM from 'react-dom';
import type { CriticalChain, BottleneckNode, GraphNode, Position } from '../../types/graph';
import { useGraphStore } from '../../store/graphStore';
import { NODE_W, NODE_H } from '../../utils/layout';
import styles from './CriticalPathExplorer.module.css';

interface Props {
  chains: CriticalChain[];
  bottlenecks: BottleneckNode[];
  selectedIds: Set<string>;
  compareMode: boolean;
  walkChainId: string | null;
  walkCursor: number;
  nodes: GraphNode[];
  positions: Record<string, Position>;
  criticalFocusActive: boolean;
}

export function CriticalPathExplorer({
  chains,
  bottlenecks,
  selectedIds,
  compareMode,
  walkChainId,
  walkCursor,
  nodes,
  positions,
  criticalFocusActive,
}: Props) {
  const {
    toggleCriticalPath,
    setCriticalSelection,
    enterCriticalCompareMode,
    exitCriticalCompareMode,
    selectAllCriticalPaths,
    enterCriticalWalk,
    stepCriticalWalk,
    exitCriticalWalk,
    setCriticalWalkCursor,
    enterCriticalFocus,
    exitCriticalFocus,
    flyTo,
    transform,
  } = useGraphStore();

  const [minimized, setMinimized] = useState(false);

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Fly the canvas viewport to center on a given node.
  const flyToNode = useCallback((nodeId: string) => {
    const pos = positions[nodeId];
    if (!pos) return;
    const canvas = document.getElementById('canvas-wrap');
    if (!canvas) return;
    const { width: W, height: H } = canvas.getBoundingClientRect();
    const k = Math.max(transform.k, 0.5);
    const cx = pos.x + NODE_W / 2;
    const cy = pos.y + NODE_H / 2;
    flyTo({ x: W / 2 - cx * k, y: H / 2 - cy * k, k });
  }, [positions, flyTo, transform.k]);

  // ── Walk mode ──
  const walkChain = walkChainId ? chains.find(c => c.id === walkChainId) : null;

  if (walkChain) {
    const len = walkChain.nodeIds.length;
    const currentNodeId = walkChain.nodeIds[walkCursor] ?? '';
    const currentNode = nodeMap.get(currentNodeId);

    const handleStep = (dir: 1 | -1) => {
      stepCriticalWalk(dir);
      const next = ((walkCursor + dir) % len + len) % len;
      flyToNode(walkChain.nodeIds[next] ?? '');
    };

    const handleRowClick = (idx: number) => {
      setCriticalWalkCursor(idx);
      flyToNode(walkChain.nodeIds[idx] ?? '');
    };

    return ReactDOM.createPortal(
      <div className={`${styles.panel} ${minimized ? styles.panelMinimized : ''}`}>
        <div className={styles.walkHeader}>
          <button className={styles.backBtn} onClick={exitCriticalWalk}>
            ← Browse
          </button>
          <span className={styles.walkTitle} style={{ color: walkChain.color }}>
            {`Path ${parseInt(walkChain.id.replace('chain-', ''), 10) + 1}`}
          </span>
          <span className={styles.walkCounter}>{walkCursor + 1} / {len}</span>
          <button
            className={styles.collapseBtn}
            onClick={() => setMinimized(m => !m)}
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? '▸' : '▾'}
          </button>
          <button className={styles.closeBtn} onClick={toggleCriticalPath} title="Close">✕</button>
        </div>

        <div className={styles.walkList}>
          {walkChain.nodeIds.map((nodeId, idx) => {
            const node = nodeMap.get(nodeId);
            const isCurrent = idx === walkCursor;
            const isVisited = idx < walkCursor;
            return (
              <div
                key={nodeId}
                className={`${styles.walkRow} ${isCurrent ? styles.walkRowCurrent : ''} ${isVisited ? styles.walkRowVisited : ''}`}
                onClick={() => handleRowClick(idx)}
              >
                <span className={`${styles.walkRowPrefix} ${isCurrent ? styles.walkRowPrefixCurrent : ''}`}>
                  {isVisited ? '✓' : isCurrent ? '→' : `${idx + 1}`}
                </span>
                <span className={styles.walkRowName}>{node?.name ?? nodeId}</span>
                {node?.owner && (
                  <span
                    className={styles.walkRowOwner}
                    style={{
                      background: `color-mix(in srgb, ${walkChain.color} 18%, transparent)`,
                      color: walkChain.color,
                    }}
                  >
                    {node.owner}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className={styles.walkFooter}>
          <button className={styles.navBtn} onClick={() => handleStep(-1)}>←</button>
          <span className={styles.navLabel}>
            {currentNode?.name ?? currentNodeId}
          </span>
          <button className={styles.navBtn} onClick={() => handleStep(1)}>→</button>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Browse / Compare mode ──
  const visibleBottlenecks = compareMode
    ? bottlenecks.filter(b => b.chainIds.some(id => selectedIds.has(id)))
    : [];

  const allOwners = new Set<string>();
  for (const chain of chains) {
    if (selectedIds.has(chain.id)) chain.ownerSet.forEach(o => allOwners.add(o));
  }

  return ReactDOM.createPortal(
    <div className={`${styles.panel} ${minimized ? styles.panelMinimized : ''}`}>
      {/* Header */}
      <div className={styles.header}>
        <svg className={styles.headerIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="3" cy="19" r="2" fill="currentColor" stroke="none"/>
          <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>
          <circle cx="21" cy="5" r="2" fill="currentColor" stroke="none"/>
          <path d="M3 19 C 18 19 18 12 12 12 C 6 12 6 5 21 5"/>
        </svg>
        <span className={styles.headerTitle}>Critical Paths</span>
        <button
          className={styles.collapseBtn}
          onClick={() => setMinimized(m => !m)}
          title={minimized ? 'Expand' : 'Minimize'}
        >
          {minimized ? '▸' : '▾'}
        </button>
        <button className={styles.closeBtn} onClick={toggleCriticalPath} title="Close">✕</button>
      </div>

      <div className={styles.body}>
        {/* Empty state */}
        {chains.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyLabel}>No critical paths found</div>
            <div className={styles.emptyHint}>
              In Design mode, click any edge and select&nbsp;<strong>Critical</strong>,
              or use the Trace Path tool to batch-assign a route.
            </div>
          </div>
        )}

        {/* Chain cards */}
        {chains.length > 0 && (
          <>
            <div className={styles.pathsRow}>
              <span className={styles.sectionLabel}>PATHS</span>
              <span className={styles.headerCount}>{criticalFocusActive ? '1 path (focus)' : `${chains.length} path${chains.length !== 1 ? 's' : ''}`}</span>
              {!criticalFocusActive && chains.length > 1 && (
                <button
                  className={`${styles.highlightAllBtn} ${selectedIds.size === chains.length ? styles.highlightAllBtnActive : ''}`}
                  onClick={() => {
                    if (selectedIds.size === chains.length) {
                      exitCriticalCompareMode();
                    } else {
                      selectAllCriticalPaths();
                    }
                  }}
                  title={selectedIds.size === chains.length ? 'Show only first path' : 'Highlight all paths'}
                >
                  {selectedIds.size === chains.length ? 'Clear' : 'All'}
                </button>
              )}
              <button
                className={`${styles.compareToggle} ${compareMode ? styles.compareToggleActive : ''}`}
                onClick={() => compareMode ? exitCriticalCompareMode() : enterCriticalCompareMode()}
                title={compareMode ? 'Exit compare mode' : 'Compare multiple paths'}
              >
                {compareMode ? 'Exit Compare' : 'Compare'}
              </button>
            </div>
            {chains.filter(chain => !criticalFocusActive || selectedIds.has(chain.id)).map((chain) => {
              const isSelected = selectedIds.has(chain.id);
              const chainNum = parseInt(chain.id.replace('chain-', ''), 10) + 1;

              return (
                <div
                  key={chain.id}
                  className={`${styles.chainCard} ${isSelected ? styles.chainCardSelected : ''}`}
                  style={{ ['--chain-color' as string]: chain.color }}
                  onClick={() => setCriticalSelection(chain.id, compareMode)}
                >
                  <div className={styles.chainCardHeader}>
                    {/* Selector (radio or checkbox) */}
                    <div className={`${styles.chainSelector} ${isSelected ? styles.chainSelectorFilled : ''}`} />
                    <span className={styles.chainDot} style={{ background: chain.color }} />
                    <span className={styles.chainName}>Path {chainNum}</span>
                    <span className={styles.chainStats}>
                      {chain.nodeIds.length} nodes · {chain.edgeKeys.size} edges
                    </span>
                  </div>
                  {!compareMode && (
                    <div className={styles.chainCardActions}>
                      <button
                        className={styles.walkBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          enterCriticalWalk(chain.id);
                          flyToNode(chain.nodeIds[0] ?? '');
                        }}
                        title="Walk through this path step by step"
                      >
                        {/* walking person */}
                        <svg width="12" height="13" viewBox="0 0 12 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="6.5" cy="1.5" r="1.2" fill="currentColor" stroke="none"/>
                          <path d="M5 4 Q6.5 3.2 8 4 L9 6.5"/>
                          <path d="M5 4 L4 7 L2.5 10"/>
                          <path d="M4 7 L6 9 L7.5 12"/>
                          <path d="M9 6.5 L10.5 8"/>
                        </svg>
                        Walk
                      </button>
                      <button
                        className={`${styles.focusBtn} ${criticalFocusActive && isSelected ? styles.focusBtnActive : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (criticalFocusActive && isSelected) {
                            exitCriticalFocus();
                          } else {
                            enterCriticalFocus(chain.id);
                          }
                        }}
                        title={criticalFocusActive && isSelected ? 'Exit focus view' : 'Isolate this path on canvas'}
                      >
                        {criticalFocusActive && isSelected ? '◎' : '◎'}
                        {criticalFocusActive && isSelected ? 'Exit Focus' : 'Focus'}
                      </button>
                    </div>
                  )}

                  {/* Mini-strip of node pills */}
                  <div className={styles.miniStrip}>
                    {chain.nodeIds.slice(0, 12).map((nodeId) => {
                      const node = nodeMap.get(nodeId);
                      return (
                        <span
                          key={nodeId}
                          className={styles.pill}
                          style={{
                            background: `color-mix(in srgb, ${chain.color} 18%, transparent)`,
                            color: chain.color,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            flyToNode(nodeId);
                          }}
                          title={node?.name ?? nodeId}
                        >
                          {node?.name ?? nodeId}
                        </span>
                      );
                    })}
                    {chain.nodeIds.length > 12 && (
                      <span className={styles.pill} style={{ opacity: 0.6, cursor: 'default' }}>
                        +{chain.nodeIds.length - 12}
                      </span>
                    )}
                  </div>

                  {/* Owner + phase chips */}
                  {(chain.ownerSet.size > 0 || chain.phaseSet.size > 0) && (
                    <div className={styles.chainMeta}>
                      {[...chain.ownerSet].map(owner => (
                        <span key={owner} className={styles.metaChip}>{owner}</span>
                      ))}
                      {[...chain.phaseSet].map(phase => (
                        <span key={phase} className={styles.metaChip} style={{ opacity: 0.7 }}>
                          {phase}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* Bottlenecks section — shown when multiple chains are selected */}
        {visibleBottlenecks.length > 0 && (
          <>
            <div className={styles.divider} />
            <div className={styles.sectionLabel}>
              SHARED NODES ({visibleBottlenecks.length} in 2+ paths)
            </div>
            {visibleBottlenecks.map(({ nodeId, chainIds }) => {
              const node = nodeMap.get(nodeId);
              const relevantChains = chains.filter(c => chainIds.includes(c.id) && selectedIds.has(c.id));
              return (
                <div key={nodeId} className={styles.bottleneckRow}>
                  <span className={styles.bottleneckIcon}>⚠</span>
                  <span
                    className={styles.bottleneckName}
                    onClick={() => flyToNode(nodeId)}
                    title="Click to navigate to this node"
                  >
                    {node?.name ?? nodeId}
                  </span>
                  <div className={styles.bottleneckChips}>
                    {relevantChains.map(c => (
                      <span
                        key={c.id}
                        className={styles.bottleneckChip}
                        style={{ background: c.color }}
                        title={`Path ${parseInt(c.id.replace('chain-', ''), 10) + 1}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Owners touched (when paths are selected) */}
        {allOwners.size > 0 && !compareMode && selectedIds.size > 0 && (
          <>
            <div className={styles.divider} />
            <div className={styles.sectionLabel}>OWNERS TOUCHED</div>
            <div className={styles.chainMeta} style={{ padding: '2px 14px 10px' }}>
              {[...allOwners].map(owner => (
                <span key={owner} className={styles.metaChip}>{owner}</span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
