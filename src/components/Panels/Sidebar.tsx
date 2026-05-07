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
import { ColorSwatchPicker } from '../DesignMode/ColorSwatchPicker';
import styles from './Sidebar.module.css';
import type { NodeTag, GraphPhase } from '../../types/graph';
import { PHASE_PALETTE } from '../../types/graph';

type LeftTab = 'owners' | 'inspector' | 'tags' | 'phases' | 'cinema';

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
  const [newTagColor, setNewTagColor] = useState<string>(PHASE_PALETTE[0]);
  const [newTagError, setNewTagError] = useState<string | null>(null);

  // ── inline edit ──
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editTagError, setEditTagError] = useState<string | null>(null);

  // ── remove error ──
  const [removeError, setRemoveError] = useState<string | null>(null);

  function handleAddTag() {
    const label = newTagLabel.trim();
    if (!label) return;
    if (tagMap.has(label)) { setNewTagError('Tag already exists'); return; }
    addTagToRegistry({ label, color: newTagColor });
    setNewTagLabel('');
    setNewTagColor(PHASE_PALETTE[0]);
    setNewTagError(null);
  }

  function startEditTag(tag: NodeTag) {
    setEditingTag(tag.label);
    setEditLabel(tag.label);
    setEditColor(tag.color);
    setEditTagError(null);
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
    if (newLabelTrimmed && newLabelTrimmed !== oldLabel && tagMap.has(newLabelTrimmed)) {
      setEditTagError('Tag already exists');
      return;
    }
    if (newLabelTrimmed && newLabelTrimmed !== oldLabel) renameTag(oldLabel, newLabelTrimmed);
    if (editColor !== tagMap.get(oldLabel)) recolorTag(newLabelTrimmed || oldLabel, editColor);
    setEditingTag(null);
    setEditTagError(null);
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
          <React.Fragment key={tag.label}>
            <div className={styles.tagRow}>
              <span className={styles.tagSwatch} style={{ background: editColor }} />
              <input
                className={styles.tagLabelInput}
                value={editLabel}
                maxLength={20}
                onChange={(e) => { setEditLabel(e.target.value); setEditTagError(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEditTag(tag.label);
                  if (e.key === 'Escape') setEditingTag(null);
                }}
                autoFocus
              />
              <button className={styles.tagActionBtn} onClick={() => commitEditTag(tag.label)} title="Save">✓</button>
              <button className={styles.tagActionBtn} onClick={() => setEditingTag(null)} title="Cancel">
                <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 6.5A4.5 4.5 0 1 1 6.5 11"/>
                  <polyline points="2,3.5 2,6.5 5,6.5"/>
                </svg>
              </button>
            </div>
            <div style={{ padding: '4px 0 4px 0' }}>
              <ColorSwatchPicker value={editColor} onChange={setEditColor} />
            </div>
            {(editTagError || editLabel.length > 0) && (
              <div className={styles.tagValidationRow}>
                {editTagError && <span className={styles.tagValidationError}>{editTagError}</span>}
                <span className={editLabel.length === 20 ? `${styles.charCount} ${styles.charCountMax}` : styles.charCount}>
                  {editLabel.length}/20
                </span>
              </div>
            )}
          </React.Fragment>
        ) : (
          <React.Fragment key={tag.label}>
            <div className={styles.tagRow}>
              <span className={styles.tagSwatch} style={{ background: tag.color }} />
              <span className={styles.tagLabel}>{tag.label}</span>
              <span className={styles.filterCount}>{tagCounts.get(tag.label) ?? 0}</span>
              {designMode && (
                <>
                  <button className={styles.tagActionBtn} onClick={() => { setRemoveError(null); startEditTag(tag); }} title="Edit tag">✎</button>
                  <button className={styles.tagActionBtn} onClick={() => handleRemoveTag(tag.label)} title="Remove from registry">
                    <svg width="11" height="12" viewBox="0 0 12 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1,3 11,3"/>
                      <path d="M4,3V1.5h4V3"/>
                      <rect x="1.5" y="3" width="9" height="8.5" rx="1.2"/>
                      <line x1="4.5" y1="6" x2="4.5" y2="9.5"/>
                      <line x1="7.5" y1="6" x2="7.5" y2="9.5"/>
                    </svg>
                  </button>
                </>
              )}
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
        <>
          <div className={styles.addRow}>
            <span className={styles.tagSwatch} style={{ background: newTagColor }} />
            <input
              className={styles.addInput}
              placeholder="New tag label…"
              value={newTagLabel}
              maxLength={20}
              onChange={(e) => { setNewTagLabel(e.target.value); setNewTagError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag(); }}
            />
            <button className={styles.addBtn} onClick={handleAddTag} title="Add tag" disabled={!newTagLabel.trim()}>+</button>
          </div>
          <div style={{ padding: '4px 0 4px 0' }}>
            <ColorSwatchPicker value={newTagColor} onChange={setNewTagColor} />
          </div>
          {(newTagError || newTagLabel.length > 0) && (
            <div className={styles.tagValidationRow}>
              {newTagError && <span className={styles.tagValidationError}>{newTagError}</span>}
              <span className={newTagLabel.length === 20 ? `${styles.charCount} ${styles.charCountMax}` : styles.charCount}>
                {newTagLabel.length}/20
              </span>
            </div>
          )}
        </>
      )}

    </div>
  );
}

// ─── Phases panel ────────────────────────────────────────────────────────────

function PhasesPanel() {
  const {
    phases, allNodes, designMode,
    createPhase: _createPhase,
    updatePhase, deletePhase,
    selectedPhaseId, setSelectedPhaseId,
    focusedPhaseId, setFocusedPhaseId,
    collapsePhase, expandPhase, collapsedPhaseIds,
  } = useGraphStore();

  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit(phase: GraphPhase) {
    setEditingPhaseId(phase.id);
    setEditName(phase.name);
    setEditColor(phase.color);
    setEditError(null);
  }

  function commitEdit(phaseId: string) {
    const trimmed = editName.trim();
    if (!trimmed) { setEditError('Name required'); return; }
    updatePhase(phaseId, { name: trimmed, color: editColor });
    setEditingPhaseId(null);
    setEditError(null);
  }

  function handleDelete(phase: GraphPhase) {
    const count = phase.nodeIds.length + (phase.groupIds?.length ?? 0);
    const confirmed = window.confirm(
      `Delete phase "${phase.name}"?${count > 0 ? `\n\n${count} assigned item(s) will be unassigned.` : ''}`
    );
    if (!confirmed) return;
    deletePhase(phase.id);
    if (selectedPhaseId === phase.id) setSelectedPhaseId(null);
    if (focusedPhaseId === phase.id) setFocusedPhaseId(null);
  }

  function handleOpenModal(phaseId: string) {
    document.dispatchEvent(new CustomEvent('flowgraph:edit-phase', { detail: { phaseId } }));
  }

  function handleNewPhase() {
    document.dispatchEvent(new CustomEvent('flowgraph:create-phase', { detail: {} }));
  }

  const sorted = [...phases].sort((a, b) => a.sequence - b.sequence);

  return (
    <div className={styles.tabContent}>
      <div className={styles.sectionLabel}>Phases</div>

      {sorted.length === 0 && (
        <div className={styles.emptyHint}>
          {designMode ? 'No phases yet. Create one below.' : 'No phases defined.'}
        </div>
      )}

      {sorted.map((phase) => {
        const nodeCount = phase.nodeIds.length + (phase.groupIds?.length ?? 0);
        const isSelected = selectedPhaseId === phase.id;
        const isFocused = focusedPhaseId === phase.id;
        const isCollapsed = collapsedPhaseIds.includes(phase.id);

        if (designMode && editingPhaseId === phase.id) {
          return (
            <React.Fragment key={phase.id}>
              <div className={styles.tagRow}>
                <span className={styles.tagSwatch} style={{ background: editColor }} />
                <input
                  className={styles.tagLabelInput}
                  value={editName}
                  maxLength={60}
                  onChange={(e) => { setEditName(e.target.value); setEditError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit(phase.id);
                    if (e.key === 'Escape') setEditingPhaseId(null);
                  }}
                  autoFocus
                />
                <button className={styles.tagActionBtn} onClick={() => commitEdit(phase.id)} title="Save">✓</button>
                <button className={styles.tagActionBtn} onClick={() => setEditingPhaseId(null)} title="Cancel">
                  <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6.5A4.5 4.5 0 1 1 6.5 11"/>
                    <polyline points="2,3.5 2,6.5 5,6.5"/>
                  </svg>
                </button>
              </div>
              <div style={{ padding: '4px 0 4px 0' }}>
                <ColorSwatchPicker value={editColor} onChange={setEditColor} />
              </div>
              {editError && <div className={styles.tagRemoveError}>{editError}</div>}
            </React.Fragment>
          );
        }

        return (
          <div
            key={phase.id}
            className={`${styles.tagRow} ${isSelected ? styles.phaseRowSelected : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => setSelectedPhaseId(isSelected ? null : phase.id)}
          >
            <span className={styles.tagSwatch} style={{ background: phase.color }} />
            <span className={styles.tagLabel}>{phase.name}</span>
            <span className={styles.filterCount}>{nodeCount}</span>
            {designMode && (
              <>
                <button
                  className={styles.tagActionBtn}
                  onClick={(e) => { e.stopPropagation(); startEdit(phase); }}
                  title="Rename / recolor"
                >✎</button>
                <button
                  className={styles.tagActionBtn}
                  onClick={(e) => { e.stopPropagation(); handleOpenModal(phase.id); }}
                  title="Edit description in modal"
                >⚙</button>
                <button
                  className={`${styles.tagActionBtn} ${isFocused ? styles.focusBtnActive : ''}`}
                  onClick={(e) => { e.stopPropagation(); setFocusedPhaseId(isFocused ? null : phase.id); }}
                  title={isFocused ? 'Exit phase spotlight' : 'Spotlight this phase on canvas'}
                >◎</button>
                <button
                  className={styles.tagActionBtn}
                  onClick={(e) => { e.stopPropagation(); isCollapsed ? expandPhase(phase.id) : collapsePhase(phase.id); }}
                  title={isCollapsed ? 'Expand phase band' : 'Collapse phase band'}
                >{isCollapsed ? '▶' : '▼'}</button>
                <button
                  className={styles.tagActionBtn}
                  onClick={(e) => { e.stopPropagation(); handleDelete(phase); }}
                  title="Delete phase"
                >
                  <svg width="11" height="12" viewBox="0 0 12 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1,3 11,3"/>
                    <path d="M4,3V1.5h4V3"/>
                    <rect x="1.5" y="3" width="9" height="8.5" rx="1.2"/>
                    <line x1="4.5" y1="6" x2="4.5" y2="9.5"/>
                    <line x1="7.5" y1="6" x2="7.5" y2="9.5"/>
                  </svg>
                </button>
              </>
            )}
          </div>
        );
      })}

      {designMode && (
        <>
          <div className={styles.sep} style={{ marginTop: 8 }} />
          <div className={styles.addRow}>
            <button
              className={styles.addBtn}
              onClick={handleNewPhase}
              title="Create a new phase"
              style={{ width: '100%', borderRadius: 4, fontSize: 12, height: 28 }}
            >+ New Phase</button>
          </div>
        </>
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
  const [newOwnerColor, setNewOwnerColor] = useState<string>(PHASE_PALETTE[0]);

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
    setNewOwnerColor(PHASE_PALETTE[0]);
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
              <React.Fragment key={owner}>
                <div className={`${styles.filterItem} ${isActive ? styles.checked : ''}`}>
                  <div
                    className={styles.checkBox}
                    onClick={(e) => { e.stopPropagation(); handleToggleOwner(owner); }}
                  />
                  <span className={styles.ownerDot} style={{ background: editColor }} />
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
                  >
                    <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 6.5A4.5 4.5 0 1 1 6.5 11"/>
                      <polyline points="2,3.5 2,6.5 5,6.5"/>
                    </svg>
                  </button>
                </div>
                <div style={{ padding: '4px 0 4px 0' }} onClick={(e) => e.stopPropagation()}>
                  <ColorSwatchPicker value={editColor} onChange={setEditColor} />
                </div>
              </React.Fragment>
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
                <span className={styles.ownerDot} style={{ background: color }} />
                <span className={styles.checkLabel}>{owner}</span>
                <span className={styles.filterCount}>{count}</span>
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
                    >
                      <svg width="11" height="12" viewBox="0 0 12 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1,3 11,3"/>
                        <path d="M4,3V1.5h4V3"/>
                        <rect x="1.5" y="3" width="9" height="8.5" rx="1.2"/>
                        <line x1="4.5" y1="6" x2="4.5" y2="9.5"/>
                        <line x1="7.5" y1="6" x2="7.5" y2="9.5"/>
                      </svg>
                    </button>
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
            <span className={styles.ownerDot} style={{ background: newOwnerColor }} />
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
          <div style={{ padding: '4px 0 4px 0' }}>
            <ColorSwatchPicker value={newOwnerColor} onChange={setNewOwnerColor} />
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

  // Fall back from Tags / Phases tab when leaving design mode
  useEffect(() => {
    if (!designMode && (activeTab === 'tags' || activeTab === 'phases')) setActiveTab('owners');
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
          {designMode && (
            <button
              className={`${styles.tab} ${activeTab === 'phases' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('phases')}
              title="Phase management"
            >Phases</button>
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
          {activeTab === 'phases' && <PhasesPanel />}
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
