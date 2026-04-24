/**
 * components/DesignMode/DesignToolbar.tsx — Purple banner toolbar shown when design mode is active.
 */

import React, { useEffect, useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import type { DesignTool, PathType } from '../../types/graph';
import { pathToEdgeKeys } from '../../utils/pathTracing';
import styles from './DesignToolbar.module.css';

const TOOL_HINTS: Record<DesignTool, string> = {
  select: 'Click to select. Shift+click to multi-select. Enable Marquee to drag-select a region.',
  add: 'Click empty canvas to add a node at that position.',
  connect: 'Click source node → click target node to draw an edge.',
  tracePath: 'Click a source node, then a target node to find all paths between them.',
};

export function DesignToolbar() {
  const {
    designTool, setDesignTool, setDesignMode,
    selectedNodeId, selectedGroupId,
    undoStack, redoStack, undo, redo,
    multiSelectIds, clearMultiSelect, groups,
    phases, assignNodesToPhase, assignGroupsToPhase,
    tracePathSource, tracePathResults, tracePathSelectedIndex,
    nextTracePath, prevTracePath, clearTracePath, setEdgePathTypeBatch,
    allNodes, marqueeMode, toggleMarqueeMode,
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

  function handleEditGroupClick() {
    if (!selectedGroupId) return;
    document.dispatchEvent(
      new CustomEvent('flowgraph:edit-group', { detail: { groupId: selectedGroupId } })
    );
  }

  function getSelectedNodeIds() {
    const groupIdSet = new Set(groups.map((g) => g.id));
    if (multiSelectIds.length > 0) {
      return multiSelectIds.filter((id) => !groupIdSet.has(id));
    }
    return selectedNodeId ? [selectedNodeId] : [];
  }

  function getSelectedGroupIds() {
    const groupIdSet = new Set(groups.map((g) => g.id));
    if (multiSelectIds.length > 0) {
      return multiSelectIds.filter((id) => groupIdSet.has(id));
    }
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
    // Split multiSelectIds into nodes and groups
    const groupIds = new Set(groups.map((g) => g.id));
    const nodeIds = multiSelectIds.filter((id) => !groupIds.has(id));
    const childGroupIds = multiSelectIds.filter((id) => groupIds.has(id));
    document.dispatchEvent(
      new CustomEvent('flowgraph:create-group', { detail: { nodeIds, groupIds: childGroupIds } })
    );
  }

  const canCreateGroup = multiSelectIds.length >= 2 && designTool === 'select';
  const hasGroupSelected = !!selectedGroupId;

  return (
    <div className={styles.banner}>
      <strong className={styles.label}>✏️ Design Mode</strong>
      <div className={styles.sep} />

      <button
        className={`${styles.toolBtn} ${designTool === 'select' ? styles.active : ''}`}
        onClick={() => setDesignTool('select')}
        title="Select / move nodes"
      >Select</button>

      {/* Marquee selection toggle — only shown when Select tool is active */}
      {designTool === 'select' && (
        <button
          className={styles.toolBtn}
          onClick={() => toggleMarqueeMode()}
          title={marqueeMode ? 'Marquee select: ON — drag to select nodes (click to disable)' : 'Marquee select: drag to select multiple nodes'}
          style={marqueeMode ? { borderColor: '#3b82f6', color: '#3b82f6', background: 'rgba(59,130,246,0.12)' } : {}}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" style={{ verticalAlign: 'middle', marginRight: 4 }}>
            <rect x="1" y="1" width="12" height="12" rx="1"/>
          </svg>
          Marquee
        </button>
      )}

      <button
        className={`${styles.toolBtn} ${designTool === 'add' ? styles.active : ''}`}
        onClick={() => setDesignTool('add')}
        title="Click canvas to add a node"
      >Add Node</button>

      <button
        className={`${styles.toolBtn} ${designTool === 'connect' ? styles.active : ''}`}
        onClick={() => setDesignTool('connect')}
        title="Click source then target to draw a connection"
      >Connect</button>

      <button
        className={`${styles.toolBtn} ${designTool === 'tracePath' ? styles.active : ''}`}
        onClick={() => setDesignTool('tracePath')}
        title="Find paths between two nodes and assign a path type"
        style={designTool === 'tracePath' ? { borderColor: '#22d3ee', color: '#22d3ee', background: 'rgba(34,211,238,0.12)' } : {}}
      >⇢ Trace</button>

      {/* Trace path assignment UI — shown when paths are found */}
      {designTool === 'tracePath' && tracePathResults.length > 0 && (() => {
        const currentPath = tracePathResults[tracePathSelectedIndex] ?? [];
        const edgeKeys = pathToEdgeKeys(currentPath);
        const sourceNode = allNodes.find((n) => n.id === tracePathSource);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
              {tracePathResults.length > 1 ? `${tracePathSelectedIndex + 1}/${tracePathResults.length} paths` : '1 path'} ({edgeKeys.length} edges{sourceNode ? ` from ${sourceNode.name}` : ''})
            </span>
            {tracePathResults.length > 1 && (
              <>
                <button className={styles.toolBtn} onClick={prevTracePath} title="Previous path" style={{ padding: '2px 6px' }}>‹</button>
                <button className={styles.toolBtn} onClick={nextTracePath} title="Next path" style={{ padding: '2px 6px' }}>›</button>
              </>
            )}
            {(['critical', 'required', 'optional', 'alternative'] as PathType[]).map((pt) => (
              <button
                key={pt}
                className={styles.toolBtn}
                onClick={() => { setEdgePathTypeBatch(edgeKeys, pt); clearTracePath(); setDesignTool('select'); }}
                title={`Assign ${pt} to all ${edgeKeys.length} edges`}
                style={{ fontSize: 10, padding: '2px 7px', textTransform: 'capitalize' }}
              >
                {pt.charAt(0).toUpperCase() + pt.slice(1)}
              </button>
            ))}
            <button
              className={styles.toolBtn}
              onClick={() => { clearTracePath(); setDesignTool('select'); }}
              title="Cancel trace"
              style={{ color: '#f87171', border: '1px solid #f87171', background: 'rgba(248,113,113,0.08)' }}
            >✕</button>
          </div>
        );
      })()}

      <div className={styles.sep} />

      {/* Edit selected group */}
      {hasGroupSelected && (
        <button
          className={styles.toolBtn}
          onClick={handleEditGroupClick}
          title="Edit selected group"
        >Edit Group</button>
      )}

      {/* Create group from multi-select */}
      {canCreateGroup && (
        <>
          <div className={styles.sep} />
          <button
            className={styles.toolBtn}
            onClick={handleCreateGroup}
            title={`Create group from ${multiSelectIds.length} selected items`}
            style={{ background: 'rgba(167,139,250,0.15)', borderColor: '#a78bfa', color: '#a78bfa' }}
          >
            ⬡ Group ({multiSelectIds.length})
          </button>
          <button
            className={styles.toolBtn}
            onClick={clearMultiSelect}
            title="Clear selection"
            style={{ opacity: 0.6 }}
          >✕ Clear</button>
        </>
      )}

      <div className={styles.sep} />

      {/* Assign selected nodes/groups to a phase */}
      {(multiSelectIds.length >= 1 || !!selectedNodeId || !!selectedGroupId) && designTool === 'select' && (
        <div style={{ position: 'relative' }}>
          <button
            className={styles.toolBtn}
            onClick={() => setPhasePickerOpen((o) => !o)}
            title="Assign selected nodes to a phase"
            style={{ background: 'rgba(74,144,217,0.12)', borderColor: '#4A90D9', color: '#4A90D9' }}
          >
            ◈ Phase
          </button>
          {phasePickerOpen && (
            <div style={{
              position: 'absolute',
              top: '110%',
              left: 0,
              background: 'var(--surface1)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              minWidth: 180,
              zIndex: 100,
              padding: '6px 0',
            }}>
              {phases.length === 0 ? null : phases.map((p) => (
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
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                  {p.name}
                </button>
              ))}
              <button
                onClick={handleAssignNewPhase}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '6px 14px',
                  background: 'none', border: 'none', borderTop: phases.length > 0 ? '1px solid var(--border)' : 'none',
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
        </div>
      )}

      <div className={styles.sep} />

      <button
        className={styles.toolBtn}
        onClick={undo}
        disabled={undoStack.length === 0}
        title="Undo (Ctrl+Z)"
        style={{ opacity: undoStack.length === 0 ? 0.4 : 1 }}
      >↩ Undo</button>

      <button
        className={styles.toolBtn}
        onClick={redo}
        disabled={redoStack.length === 0}
        title="Redo (Ctrl+Y)"
        style={{ opacity: redoStack.length === 0 ? 0.4 : 1 }}
      >↪ Redo</button>

      <span className={styles.hint}>
        {multiSelectIds.length > 0 && designTool === 'select'
          ? `${multiSelectIds.length} item${multiSelectIds.length !== 1 ? 's' : ''} selected — Shift+click to add more, then click ⬡ Group`
          : TOOL_HINTS[designTool]}
      </span>

      <div style={{ flex: 1 }} />

      <button
        className={styles.toolBtn}
        onClick={() => setDesignMode(false)}
        title="Exit Design Mode"
        style={{ border: 'none', background: 'none', color: '#f87171' }}
      >✕</button>
    </div>
  );
}
