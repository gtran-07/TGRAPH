/**
 * components/Panels/Sidebar.tsx — Tabbed left panel.
 *
 * Tabs:
 *   Owners    — owner filter checkboxes (original sidebar content)
 *   Inspector — selected node / group / phase details
 *   Tags      — global tag & owner colour management
 *
 * Behaviour:
 *   • Auto-expands (Owners tab) when first file is loaded.
 *   • When open + a node/group/phase is selected → auto-switches to Inspector tab.
 *   • When collapsed + a node/group/phase is selected → shows a floating glowing hint.
 *   • Right-edge drag handle lets the user resize the pane (min 220px, max 560px).
 *   • flowgraph:toggle-sidebar  → toggle collapsed
 *   • flowgraph:toggle-inspector → ensure open + switch to Inspector tab
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { InspectorContent } from './Inspector';
import { CinemaTabContent } from '../Cinema/CinemaOverlay';
import styles from './Sidebar.module.css';
import type { NodeTag } from '../../types/graph';

type LeftTab = 'owners' | 'inspector' | 'tags' | 'cinema';

const MIN_WIDTH = 220;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 280;

// ─── Tags panel ──────────────────────────────────────────────────────────────

function TagsPanel() {
  const {
    allNodes, tagRegistry, designMode,
    addTagToRegistry, removeTagFromRegistry, recolorTag, renameTag,
  } = useGraphStore();

  // Collect all unique tags across nodes + registry
  const tagMap = new Map<string, string>(); // label → color (latest wins)
  tagRegistry.forEach((t) => tagMap.set(t.label, t.color));
  allNodes.forEach((n) => n.tags?.forEach((t) => tagMap.set(t.label, t.color)));
  const allTags: NodeTag[] = Array.from(tagMap.entries()).map(([label, color]) => ({ label, color }));

  // Count how many nodes use each tag
  const tagCounts = new Map<string, number>();
  allNodes.forEach((n) => n.tags?.forEach((t) => tagCounts.set(t.label, (tagCounts.get(t.label) ?? 0) + 1)));

  // ── new tag form ──
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagColor, setNewTagColor] = useState('#4f9eff');

  // ── inline edit ──
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('');

  // ── remove error ──
  const [removeError, setRemoveError] = useState<string | null>(null);

  function handleAddTag() {
    const label = newTagLabel.trim();
    if (!label) return;
    addTagToRegistry({ label, color: newTagColor });
    setNewTagLabel('');
    setNewTagColor('#4f9eff');
  }

  function startEditTag(tag: NodeTag) {
    setEditingTag(tag.label);
    setEditLabel(tag.label);
    setEditColor(tag.color);
  }

  function handleRemoveTag(label: string) {
    const inUse = allNodes.some((n) => n.tags?.some((t) => t.label === label));
    if (inUse) {
      setRemoveError(label);
      return;
    }
    setRemoveError(null);
    removeTagFromRegistry(label);
  }

  function commitEditTag(oldLabel: string) {
    const newLabelTrimmed = editLabel.trim();
    if (newLabelTrimmed && newLabelTrimmed !== oldLabel) renameTag(oldLabel, newLabelTrimmed);
    if (editColor !== tagMap.get(oldLabel)) recolorTag(newLabelTrimmed || oldLabel, editColor);
    setEditingTag(null);
  }

  return (
    <div className={styles.tabContent}>
      {/* ── Tags section ─────────────────────────────────────── */}
      <div className={styles.sectionLabel}>Tags</div>

      {allTags.length === 0 && (
        <div className={styles.emptyHint}>
          {designMode ? 'No tags yet. Add one below.' : 'No tags defined.'}
        </div>
      )}

      {allTags.map((tag) => (
        designMode && editingTag === tag.label ? (
          <div key={tag.label} className={styles.tagRow}>
            <input
              className={styles.tagColorInput}
              type="color"
              value={editColor}
              onChange={(e) => setEditColor(e.target.value)}
              title="Tag color"
            />
            <input
              className={styles.tagLabelInput}
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEditTag(tag.label);
                if (e.key === 'Escape') setEditingTag(null);
              }}
              autoFocus
            />
            <button className={styles.tagActionBtn} onClick={() => commitEditTag(tag.label)} title="Save">✓</button>
            <button className={styles.tagActionBtn} onClick={() => setEditingTag(null)} title="Cancel">✕</button>
          </div>
        ) : (
          <React.Fragment key={tag.label}>
            <div className={styles.tagRow}>
              <span className={styles.tagSwatch} style={{ background: tag.color }} />
              <span className={styles.tagLabel}>{tag.label}</span>
              {designMode && (
                <>
                  <button className={styles.tagActionBtn} onClick={() => { setRemoveError(null); startEditTag(tag); }} title="Edit tag">✎</button>
                  <button className={styles.tagActionBtn} onClick={() => handleRemoveTag(tag.label)} title="Remove from registry">✕</button>
                </>
              )}
              <span className={styles.filterCount}>{tagCounts.get(tag.label) ?? 0}</span>
            </div>
            {removeError === tag.label && (
              <div className={styles.tagRemoveError}>
                Tag is in use — remove it from all nodes first.
              </div>
            )}
          </React.Fragment>
        )
      ))}

      {/* Add new tag — design mode only */}
      {designMode && (
        <div className={styles.addRow}>
          <input
            className={styles.tagColorInput}
            type="color"
            value={newTagColor}
            onChange={(e) => setNewTagColor(e.target.value)}
            title="Pick tag color"
          />
          <input
            className={styles.addInput}
            placeholder="New tag label…"
            value={newTagLabel}
            onChange={(e) => setNewTagLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag(); }}
          />
          <button className={styles.addBtn} onClick={handleAddTag} title="Add tag" disabled={!newTagLabel.trim()}>+</button>
        </div>
      )}

    </div>
  );
}

// ─── Owners panel ────────────────────────────────────────────────────────────

function OwnersPanel() {
  const {
    allNodes, activeOwners, ownerColors, toggleOwner, toggleAllOwners, fitToScreen,
    designMode, ownerRegistry, renameOwner, setOwnerColor, addOwnerToRegistry, removeOwnerFromRegistry,
    focusedOwner, enterOwnerFocus, exitOwnerFocus,
  } = useGraphStore();

  // Combined owner list: nodes + registry
  const ownerSet = new Set<string>(ownerRegistry);
  allNodes.forEach((n) => { if (n.owner) ownerSet.add(n.owner); });
  const owners = Array.from(ownerSet).filter(Boolean);

  const allActive = owners.length > 0 && owners.every((o) => activeOwners.has(o));

  // Inline edit state
  const [editingOwner, setEditingOwner] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  // Add owner form
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newOwnerColor, setNewOwnerColor] = useState('#4f9eff');

  // Remove error
  const [removeError, setRemoveError] = useState<string | null>(null);

  // ── Owner Focus Mode: compute upstream/downstream maps ────────────────────
  const { upstreamByOwner, downstreamByOwner } = useMemo(() => {
    if (!focusedOwner) return { upstreamByOwner: new Map<string, number>(), downstreamByOwner: new Map<string, number>() };
    const ownedIds = new Set(allNodes.filter((n) => n.owner === focusedOwner).map((n) => n.id));
    const upMap = new Map<string, number>();
    allNodes.forEach((n) => {
      if (n.owner === focusedOwner) {
        n.dependencies.forEach((dep) => {
          const d = allNodes.find((x) => x.id === dep);
          if (d && d.owner !== focusedOwner) upMap.set(d.owner, (upMap.get(d.owner) ?? 0) + 1);
        });
      }
    });
    const downMap = new Map<string, number>();
    allNodes.forEach((n) => {
      if (n.owner !== focusedOwner && n.dependencies.some((dep) => ownedIds.has(dep))) {
        downMap.set(n.owner, (downMap.get(n.owner) ?? 0) + 1);
      }
    });
    return { upstreamByOwner: upMap, downstreamByOwner: downMap };
  }, [focusedOwner, allNodes]);

  function handleToggleOwner(owner: string) {
    toggleOwner(owner);
    setTimeout(() => fitToScreen(), 60);
  }

  function handleToggleAll() {
    toggleAllOwners();
    setTimeout(() => fitToScreen(), 60);
  }

  function startEdit(owner: string) {
    setEditingOwner(owner);
    setEditName(owner);
    setEditColor(ownerColors[owner] ?? '#4f9eff');
  }

  function commitEdit(oldName: string) {
    const trimmed = editName.trim();
    const currentColor = ownerColors[oldName] ?? '#4f9eff';
    if (editColor !== currentColor) setOwnerColor(oldName, editColor);
    if (trimmed && trimmed !== oldName) renameOwner(oldName, trimmed);
    setEditingOwner(null);
  }

  function handleAddOwner() {
    const name = newOwnerName.trim();
    if (!name) return;
    addOwnerToRegistry(name);
    setOwnerColor(name, newOwnerColor);
    setNewOwnerName('');
    setNewOwnerColor('#4f9eff');
  }

  function handleRemoveOwner(name: string) {
    const inUse = allNodes.some((n) => n.owner === name);
    if (inUse) {
      setRemoveError(name);
      return;
    }
    setRemoveError(null);
    removeOwnerFromRegistry(name);
  }

  return (
    <div className={styles.tabContent}>
      {/* Select All row */}
      {owners.length > 0 && (
        <>
          <div
            className={`${styles.filterItem} ${allActive ? styles.checked : ''}`}
            onClick={handleToggleAll}
          >
            <div className={styles.checkBox} />
            <span className={`${styles.checkLabel} ${styles.checkLabelBold}`}>Select All</span>
            <span className={styles.filterCount}>{owners.length}</span>
          </div>
          <div className={styles.sep} />
        </>
      )}

      {owners.length === 0 ? (
        <div className={styles.emptyHint}>
          {designMode ? 'No owners yet. Add one below.' : 'Load a JSON file to see owners'}
        </div>
      ) : (
        owners.map((owner) => {
          const count = allNodes.filter((n) => n.owner === owner).length;
          const isActive = activeOwners.has(owner);
          const color = ownerColors[owner] ?? '#4f9eff';

          // ── Edit row (design mode, this owner being edited) ──────────────
          if (designMode && editingOwner === owner) {
            return (
              <div key={owner} className={`${styles.filterItem} ${isActive ? styles.checked : ''}`}>
                <div
                  className={styles.checkBox}
                  onClick={(e) => { e.stopPropagation(); handleToggleOwner(owner); }}
                />
                <input
                  className={styles.tagColorInput}
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  title="Owner color"
                />
                <input
                  className={`${styles.tagLabelInput} ${styles.ownerNameInput}`}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit(owner);
                    if (e.key === 'Escape') setEditingOwner(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
                <button
                  className={styles.tagActionBtn}
                  onClick={(e) => { e.stopPropagation(); commitEdit(owner); }}
                  title="Save"
                >✓</button>
                <button
                  className={styles.tagActionBtn}
                  onClick={(e) => { e.stopPropagation(); setEditingOwner(null); }}
                  title="Cancel"
                >✕</button>
              </div>
            );
          }

          // ── Normal row ────────────────────────────────────────────────────
          const isFocusedOwner = focusedOwner === owner;
          const isUpstream = !!focusedOwner && upstreamByOwner.has(owner);
          const isDownstream = !!focusedOwner && downstreamByOwner.has(owner);
          const isIsolated = !!focusedOwner && !isFocusedOwner && !isUpstream && !isDownstream;
          const rowFocusClass = isFocusedOwner ? styles.focusedRow
            : isUpstream ? styles.upstreamRow
            : isDownstream ? styles.downstreamRow
            : isIsolated ? styles.isolatedRow
            : '';

          return (
            <React.Fragment key={owner}>
              <div
                className={`${styles.filterItem} ${isActive ? styles.checked : ''} ${rowFocusClass}`}
                onClick={() => handleToggleOwner(owner)}
              >
                <div className={styles.checkBox} />
                {designMode ? (
                  <input
                    className={styles.tagColorInput}
                    type="color"
                    value={color}
                    onChange={(e) => { setOwnerColor(owner, e.target.value); }}
                    onClick={(e) => e.stopPropagation()}
                    title={`Color for ${owner}`}
                  />
                ) : (
                  <span className={styles.ownerDot} style={{ background: color }} />
                )}
                <span className={styles.checkLabel}>{owner}</span>
                {designMode && (
                  <>
                    <button
                      className={styles.tagActionBtn}
                      onClick={(e) => { e.stopPropagation(); setRemoveError(null); startEdit(owner); }}
                      title="Rename owner"
                    >✎</button>
                    <button
                      className={styles.tagActionBtn}
                      onClick={(e) => { e.stopPropagation(); handleRemoveOwner(owner); }}
                      title="Remove owner"
                    >✕</button>
                  </>
                )}
                <button
                  className={`${styles.tagActionBtn} ${focusedOwner === owner ? styles.focusBtnActive : ''}`}
                  title={focusedOwner === owner ? `Exit Lane Focus` : `Focus on ${owner} lane`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (focusedOwner === owner) exitOwnerFocus();
                    else enterOwnerFocus(owner);
                  }}
                >◎</button>
                {isUpstream && (
                  <span className={`${styles.dirBadge} ${styles.upBadge}`}>⬆ {upstreamByOwner.get(owner)}</span>
                )}
                {isDownstream && (
                  <span className={`${styles.dirBadge} ${styles.downBadge}`}>⬇ {downstreamByOwner.get(owner)}</span>
                )}
                <span className={styles.filterCount}>{count}</span>
              </div>
              {removeError === owner && (
                <div className={styles.tagRemoveError}>
                  Owner is in use — reassign all nodes first.
                </div>
              )}
            </React.Fragment>
          );
        })
      )}

      {/* Add new owner — design mode only */}
      {designMode && (
        <>
          <div className={styles.sep} style={{ marginTop: 8 }} />
          <div className={styles.addRow}>
            <input
              className={styles.tagColorInput}
              type="color"
              value={newOwnerColor}
              onChange={(e) => setNewOwnerColor(e.target.value)}
              title="New owner color"
            />
            <input
              className={styles.addInput}
              placeholder="New owner name…"
              value={newOwnerName}
              onChange={(e) => setNewOwnerName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddOwner(); }}
            />
            <button
              className={styles.addBtn}
              onClick={handleAddOwner}
              title="Add owner"
              disabled={!newOwnerName.trim()}
            >+</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main LeftPane ────────────────────────────────────────────────────────────

export function Sidebar() {
  const {
    allNodes, groups, phases, ownerColors,
    selectedNodeId, selectedGroupId, selectedPhaseId,
    multiSelectIds,
    discoveryActive, designMode,
  } = useGraphStore();

  const [collapsed, setCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState<LeftTab>('owners');
  const [paneWidth, setPaneWidth] = useState(DEFAULT_WIDTH);
  const [showHint, setShowHint] = useState(false);

  const hasAutoOpened = useRef(false);
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const prevDiscoveryActive = useRef(false);

  const hasSelection =
    (!!selectedNodeId || !!selectedGroupId || !!selectedPhaseId) &&
    multiSelectIds.length <= 1;

  // ── Auto-expand sidebar + switch to Cinema tab when cinema starts ─────────
  useEffect(() => {
    if (discoveryActive && !prevDiscoveryActive.current) {
      setCollapsed(false);
      setActiveTab('cinema');
    }
    // When cinema exits while on cinema tab, fall back to owners
    if (!discoveryActive && prevDiscoveryActive.current && activeTab === 'cinema') {
      setActiveTab('owners');
    }
    prevDiscoveryActive.current = discoveryActive;
  // activeTab intentionally omitted — we only care about the transition edge
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryActive]);

  // ── Auto-expand on first data load ───────────────────────────────────────
  useEffect(() => {
    if (allNodes.length > 0 && !hasAutoOpened.current) {
      hasAutoOpened.current = true;
      setCollapsed(false);
      setActiveTab('owners');
    }
    if (allNodes.length === 0) hasAutoOpened.current = false;
  }, [allNodes.length]);

  // ── Auto-switch to Inspector tab when a selection is made ────────────────
  const prevNodeId = useRef<string | null>(null);
  const prevGroupId = useRef<string | null>(null);
  const prevPhaseId = useRef<string | null>(null);

  useEffect(() => {
    if (selectedNodeId && selectedNodeId !== prevNodeId.current) {
      if (!collapsed) { setActiveTab('inspector'); setShowHint(false); }
      else setShowHint(true);
    }
    // Return to Cinema tab when node is deselected during a tour
    if (!selectedNodeId && prevNodeId.current && !collapsed && discoveryActive) {
      setActiveTab('cinema');
    }
    prevNodeId.current = selectedNodeId;
  }, [selectedNodeId, collapsed, discoveryActive]);

  useEffect(() => {
    if (selectedGroupId && selectedGroupId !== prevGroupId.current) {
      if (!collapsed) { setActiveTab('inspector'); setShowHint(false); }
      else setShowHint(true);
    }
    if (!selectedGroupId && prevGroupId.current && !collapsed && discoveryActive) {
      setActiveTab('cinema');
    }
    prevGroupId.current = selectedGroupId;
  }, [selectedGroupId, collapsed, discoveryActive]);

  useEffect(() => {
    if (selectedPhaseId && selectedPhaseId !== prevPhaseId.current) {
      if (!collapsed) { setActiveTab('inspector'); setShowHint(false); }
      else setShowHint(true);
    }
    if (!selectedPhaseId && prevPhaseId.current && !collapsed && discoveryActive) {
      setActiveTab('cinema');
    }
    prevPhaseId.current = selectedPhaseId;
  }, [selectedPhaseId, collapsed, discoveryActive]);

  // Fall back from Tags tab when leaving design mode
  useEffect(() => {
    if (!designMode && activeTab === 'tags') setActiveTab('owners');
  }, [designMode, activeTab]);

  // Hide hint when pane opens or selection is cleared
  useEffect(() => {
    if (!collapsed) setShowHint(false);
  }, [collapsed]);

  useEffect(() => {
    if (!hasSelection) setShowHint(false);
  }, [hasSelection]);

  // ── Custom event listeners ────────────────────────────────────────────────
  useEffect(() => {
    function handleToggleSidebar() { setCollapsed((c) => !c); }
    function handleToggleInspector() {
      setCollapsed(false);
      setActiveTab('inspector');
    }
    document.addEventListener('flowgraph:toggle-sidebar', handleToggleSidebar);
    document.addEventListener('flowgraph:toggle-inspector', handleToggleInspector);
    return () => {
      document.removeEventListener('flowgraph:toggle-sidebar', handleToggleSidebar);
      document.removeEventListener('flowgraph:toggle-inspector', handleToggleInspector);
    };
  }, []);

  // ── Resize logic ──────────────────────────────────────────────────────────
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = paneWidth;
    e.preventDefault();
  }, [paneWidth]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return;
      const delta = e.clientX - resizeStartX.current;
      const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartW.current + delta));
      setPaneWidth(newW);
    }
    function onMouseUp() { isResizing.current = false; }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // ── Open pane and switch to Inspector from hint ───────────────────────────
  function handleHintClick() {
    setCollapsed(false);
    setActiveTab('inspector');
    setShowHint(false);
  }

  // ── Derive floating hint content from current selection ───────────────────
  const hintContent: { name: string; sub: string; color?: string } | null = (() => {
    if (selectedNodeId) {
      const node = allNodes.find((n) => n.id === selectedNodeId);
      if (!node) return null;
      return {
        name: node.name,
        sub: node.owner,
        color: ownerColors[node.owner],
      };
    }
    if (selectedGroupId) {
      const group = groups.find((g) => g.id === selectedGroupId);
      if (!group) return null;
      return {
        name: group.name,
        sub: 'Group',
      };
    }
    if (selectedPhaseId) {
      const phase = phases.find((p) => p.id === selectedPhaseId);
      if (!phase) return null;
      return {
        name: phase.name,
        sub: `Phase ${phase.sequence + 1}`,
        color: phase.color,
      };
    }
    return null;
  })();

  return (
    <>
      {/* ── Main panel ────────────────────────────────────────────────────── */}
      <div
        className={`${styles.pane} ${collapsed ? styles.collapsed : ''}`}
        style={collapsed ? undefined : { width: paneWidth }}
      >
        {/* Tab bar */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tab} ${activeTab === 'owners' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('owners')}
            title="Owner filters"
          >Owners</button>
          <button
            className={`${styles.tab} ${activeTab === 'inspector' ? styles.tabActive : ''} ${hasSelection && activeTab !== 'inspector' ? styles.tabPing : ''}`}
            onClick={() => setActiveTab('inspector')}
            title="Inspector — selected item details"
          >Inspector</button>
          {designMode && (
            <button
              className={`${styles.tab} ${activeTab === 'tags' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('tags')}
              title="Tags & owner colour management"
            >Tags</button>
          )}
          {discoveryActive && (
            <button
              className={`${styles.tab} ${styles.tabCinema} ${activeTab === 'cinema' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('cinema')}
              title="Process Cinema — guided tour"
            >Cinema</button>
          )}
          <button
            className={styles.collapseBtn}
            onClick={() => setCollapsed(true)}
            title="Collapse panel"
          >«</button>
        </div>

        {/* Tab content */}
        <div className={`${styles.body} ${activeTab === 'cinema' ? styles.bodycinema : ''}`}>
          {activeTab === 'owners' && <OwnersPanel />}
          {activeTab === 'inspector' && (
            <div className={styles.inspectorWrap}>
              <InspectorContent />
            </div>
          )}
          {activeTab === 'tags' && <TagsPanel />}
          {discoveryActive && (
            <div style={activeTab !== 'cinema' ? { display: 'none' } : { height: '100%' }}>
              <CinemaTabContent />
            </div>
          )}
        </div>

        {/* Resize handle */}
        <div
          className={styles.resizeHandle}
          onMouseDown={onResizeMouseDown}
          title="Drag to resize panel"
        />
      </div>

      {/* ── Collapsed peek button ─────────────────────────────────────────── */}
      {collapsed && (
        <button
          className={styles.peekBtn}
          onClick={() => setCollapsed(false)}
          title="Show panel"
        >
          ☰
        </button>
      )}

      {/* ── Cinema hint when collapsed + discovery active ─────────────────── */}
      {collapsed && discoveryActive && (
        <div
          className={`${styles.collapsedHint} ${styles.collapsedHintCinema}`}
          style={{ top: 56 }}
          onClick={() => { setCollapsed(false); setActiveTab('cinema'); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setCollapsed(false); setActiveTab('cinema'); } }}
        >
          <span className={styles.hintIcon}>▶</span>
          <div className={styles.hintBody}>
            <span className={styles.hintName}>Cinema Tour Active</span>
            <span className={styles.hintCta}>↗ Click to open Cinema tab</span>
          </div>
        </div>
      )}

      {/* ── Floating hint when collapsed + item selected ──────────────────── */}
      {collapsed && (
        <div
          className={`${styles.collapsedHint} ${!showHint ? styles.collapsedHintHidden : ''}`}
          style={discoveryActive ? { top: 116 } : undefined}
          onClick={handleHintClick}
          role="button"
          tabIndex={showHint ? 0 : -1}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleHintClick(); }}
        >
          <span
            className={styles.hintIcon}
            style={hintContent?.color ? { color: hintContent.color } : undefined}
          >▣</span>
          {hintContent ? (
            <div key={selectedNodeId ?? selectedGroupId ?? selectedPhaseId} className={styles.hintBody}>
              <span className={styles.hintName}>{hintContent.name}</span>
              <span className={styles.hintSub}>{hintContent.sub}</span>
              <span className={styles.hintCta}>↗ Click to open inspector</span>
            </div>
          ) : (
            <div key="empty" className={styles.hintBody}>
              <span className={styles.hintName}>Item selected</span>
              <span className={styles.hintCta}>↗ Click to view details</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
