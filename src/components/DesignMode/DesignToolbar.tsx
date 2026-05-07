/**
 * components/DesignMode/DesignToolbar.tsx — Vertical icon strip on the left canvas edge.
 * Tool buttons are icon-only; trace/phase flyouts appear to the right of the strip.
 */

import React, { useEffect, useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import type { DesignTool, PathType } from '../../types/graph';
import { pathToEdgeKeys } from '../../utils/pathTracing';
import styles from './DesignToolbar.module.css';

export function DesignToolbar() {
  const {
    designTool, setDesignTool, setDesignMode,
    selectedNodeId, selectedGroupId,
    undoStack, redoStack, undo, redo,
    multiSelectIds, clearMultiSelect, groups,
    phases, assignNodesToPhase, assignGroupsToPhase,
    tracePathSource, tracePathResults, tracePathSelectedIndex,
    nextTracePath, prevTracePath, clearTracePath, setEdgePathTypeBatch,
    allNodes,
  } = useGraphStore();

  const [phasePickerOpen, setPhasePickerOpen] = useState(false);

  // Ctrl+Z = undo, Ctrl+Y or Ctrl+Shift+Z = redo
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [undo, redo]);

  // Close phase picker when clicking outside
  useEffect(() => {
    if (!phasePickerOpen) return;
    function handleOutside() { setPhasePickerOpen(false); }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [phasePickerOpen]);

  function handleEditGroupClick() {
    if (!selectedGroupId) return;
    document.dispatchEvent(
      new CustomEvent('flowgraph:edit-group', { detail: { groupId: selectedGroupId } })
    );
  }

  function getSelectedNodeIds() {
    const groupIdSet = new Set(groups.map((g) => g.id));
    if (multiSelectIds.length > 0) return multiSelectIds.filter((id) => !groupIdSet.has(id));
    return selectedNodeId ? [selectedNodeId] : [];
  }

  function getSelectedGroupIds() {
    const groupIdSet = new Set(groups.map((g) => g.id));
    if (multiSelectIds.length > 0) return multiSelectIds.filter((id) => groupIdSet.has(id));
    return selectedGroupId ? [selectedGroupId] : [];
  }

  function handleAssignToPhase(phaseId: string) {
    const nodeIds = getSelectedNodeIds();
    const groupIds = getSelectedGroupIds();
    if (nodeIds.length > 0) assignNodesToPhase(nodeIds, phaseId);
    if (groupIds.length > 0) assignGroupsToPhase(groupIds, phaseId);
    setPhasePickerOpen(false);
  }

  function handleAssignNewPhase() {
    const nodeIds = getSelectedNodeIds();
    const groupIds = getSelectedGroupIds();
    document.dispatchEvent(new CustomEvent('flowgraph:create-phase', { detail: { nodeIds, groupIds } }));
    setPhasePickerOpen(false);
  }

  function handleCreateGroup() {
    const groupIds = new Set(groups.map((g) => g.id));
    const nodeIds = multiSelectIds.filter((id) => !groupIds.has(id));
    const childGroupIds = multiSelectIds.filter((id) => groupIds.has(id));
    document.dispatchEvent(
      new CustomEvent('flowgraph:create-group', { detail: { nodeIds, groupIds: childGroupIds } })
    );
  }

  const canCreateGroup = multiSelectIds.length >= 2 && designTool === 'select';
  const hasGroupSelected = !!selectedGroupId;

  const groupIdSet = new Set(groups.map((g) => g.id));
  const selectedNodeOwners = new Set(
    multiSelectIds
      .filter((id) => !groupIdSet.has(id))
      .map((id) => allNodes.find((n) => n.id === id)?.owner)
      .filter((o): o is string => o !== undefined)
  );
  const mixedOwners = canCreateGroup && selectedNodeOwners.size > 1;

  const hasSelection = designTool === 'select' && (multiSelectIds.length >= 1 || !!selectedNodeId || !!selectedGroupId);
  const hasContextItems = hasGroupSelected || canCreateGroup || hasSelection;

  return (
    <div className={styles.banner}>
      {/* Mode indicator */}
      <span className={styles.label} title="Design Mode">✏</span>
      <div className={styles.sep} />

      {/* Core tools */}
      <button
        className={`${styles.toolBtn} ${designTool === 'select' ? styles.active : ''}`}
        onClick={() => setDesignTool('select')}
        title="Select — click or Shift+click to multi-select"
      >↖</button>

      <button
        className={`${styles.toolBtn} ${designTool === 'add' ? styles.active : ''}`}
        onClick={() => setDesignTool('add')}
        title="Add node — click canvas to place"
      >⊕</button>

      <button
        className={`${styles.toolBtn} ${designTool === 'connect' ? styles.active : ''}`}
        onClick={() => setDesignTool('connect')}
        title="Connect — click source then target node"
      >→</button>

      <button
        className={`${styles.toolBtn} ${designTool === 'tracePath' ? styles.active : ''}`}
        onClick={() => setDesignTool('tracePath')}
        title="Trace path — find paths between two nodes and assign type"
        style={designTool === 'tracePath' ? { borderColor: '#22d3ee', color: '#22d3ee', background: 'rgba(34,211,238,0.12)' } : {}}
      >⇢</button>

      {/* Trace panel — floats to the right when paths are found */}
      {designTool === 'tracePath' && tracePathResults.length > 0 && (() => {
        const currentPath = tracePathResults[tracePathSelectedIndex] ?? [];
        const edgeKeys = pathToEdgeKeys(currentPath);
        const sourceNode = allNodes.find((n) => n.id === tracePathSource);
        return (
          <div className={styles.tracePanel}>
            <span className={styles.traceMeta}>
              {tracePathResults.length > 1
                ? `${tracePathSelectedIndex + 1}/${tracePathResults.length} paths`
                : '1 path'} · {edgeKeys.length} edges
              {sourceNode ? ` · ${sourceNode.name}` : ''}
            </span>
            {tracePathResults.length > 1 && (
              <div className={styles.traceNav}>
                <button className={styles.toolBtn} onClick={prevTracePath} title="Previous path">‹</button>
                <button className={styles.toolBtn} onClick={nextTracePath} title="Next path">›</button>
              </div>
            )}
            <div className={styles.traceAssign}>
              {(['critical', 'required', 'optional', 'alternative'] as PathType[]).map((pt) => (
                <button
                  key={pt}
                  className={styles.traceAssignBtn}
                  onClick={() => { setEdgePathTypeBatch(edgeKeys, pt); clearTracePath(); setDesignTool('select'); }}
                  title={`Assign ${pt} to all ${edgeKeys.length} edges`}
                >
                  {pt.charAt(0).toUpperCase() + pt.slice(1)}
                </button>
              ))}
            </div>
            <button
              className={styles.toolBtn}
              onClick={() => { clearTracePath(); setDesignTool('select'); }}
              title="Cancel trace"
              style={{ color: '#f87171', borderColor: '#f87171', background: 'rgba(248,113,113,0.08)', width: '100%' }}
            >✕</button>
          </div>
        );
      })()}

      {/* Context section separator */}
      {hasContextItems && <div className={styles.sep} />}

      {/* Edit selected group */}
      {hasGroupSelected && (
        <button
          className={styles.toolBtn}
          onClick={handleEditGroupClick}
          title="Edit selected group"
        >⚙</button>
      )}

      {/* Phase assign — when any selection exists in select mode */}
      {hasSelection && (
        <>
          <button
            className={styles.toolBtn}
            onClick={(e) => { e.stopPropagation(); setPhasePickerOpen((o) => !o); }}
            title="Assign selection to a phase"
            style={{ borderColor: '#4A90D9', color: '#4A90D9' }}
          >◈</button>
          {phasePickerOpen && (
            <div className={styles.phasePicker} onMouseDown={(e) => e.stopPropagation()}>
              {phases.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleAssignToPhase(p.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '6px 14px',
                    background: 'none', border: 'none',
                    cursor: 'pointer', fontSize: 12, color: 'var(--text1)',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                  {p.name}
                </button>
              ))}
              <button
                onClick={handleAssignNewPhase}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '6px 14px',
                  background: 'none', border: 'none',
                  borderTop: phases.length > 0 ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer', fontSize: 12, color: 'var(--accent)',
                  textAlign: 'left', marginTop: phases.length > 0 ? 4 : 0,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                + New Phase…
              </button>
            </div>
          )}
        </>
      )}

      {/* Create group from multi-select */}
      {canCreateGroup && (
        <>
          <button
            className={styles.toolBtn}
            onClick={handleCreateGroup}
            disabled={mixedOwners}
            title={
              mixedOwners
                ? `Cannot group: selected nodes belong to multiple owners (${[...selectedNodeOwners].join(', ')})`
                : `Create group from ${multiSelectIds.length} selected items`
            }
            style={
              mixedOwners
                ? { opacity: 0.4, cursor: 'not-allowed' }
                : { borderColor: '#a78bfa', color: '#a78bfa' }
            }
          >⬡</button>
          <button
            className={styles.toolBtn}
            onClick={clearMultiSelect}
            title="Clear selection"
            style={{ opacity: 0.6 }}
          >✕</button>
        </>
      )}

      <div className={styles.sep} />

      {/* Undo / Redo */}
      <button
        className={styles.toolBtn}
        onClick={undo}
        disabled={undoStack.length === 0}
        title="Undo (Ctrl+Z)"
        style={{ opacity: undoStack.length === 0 ? 0.4 : 1 }}
      >↩</button>

      <button
        className={styles.toolBtn}
        onClick={redo}
        disabled={redoStack.length === 0}
        title="Redo (Ctrl+Y)"
        style={{ opacity: redoStack.length === 0 ? 0.4 : 1 }}
      >↪</button>

      <div className={styles.sep} />

      {/* Exit design mode */}
      <button
        className={styles.toolBtn}
        onClick={() => setDesignMode(false)}
        title="Exit Design Mode"
        style={{ border: 'none', color: '#f87171' }}
      >✕</button>
    </div>
  );
}
